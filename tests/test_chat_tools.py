"""离线协议与后台测试；所有数据写入临时目录，不调用真实模型或搜索服务。"""
import copy
import json
import os
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

import httpx

_data = tempfile.TemporaryDirectory(prefix="lazybot-tests-")
os.environ["DATA_DIR"] = _data.name

from app import context, crypto, db, llm, store, tools, web  # noqa: E402


MESSAGES = [{"role": "user", "parts": [{"type": "text", "text": "查一下今天的新闻"}]}]
PROVIDER = {"id": "p", "name": "test", "format": "openai", "base_url": "https://model.test/v1", "api_key": "test-key"}


def openai_response(message=None, stop="stop"):
    return {"choices": [{"message": message or {"role": "assistant", "content": "<reply>回答</reply>"},
                         "finish_reason": stop}],
            "usage": {"prompt_tokens": 100, "completion_tokens": 10,
                      "prompt_tokens_details": {"cached_tokens": 60}}}


def claude_response(blocks, stop="end_turn"):
    return {"content": blocks, "stop_reason": stop,
            "usage": {"input_tokens": 40, "output_tokens": 10,
                      "cache_read_input_tokens": 60, "cache_creation_input_tokens": 5}}


class ChatTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        await db.init()
        await db.execute("DELETE FROM settings")
        await db.execute("DELETE FROM usage")
        await db.execute("DELETE FROM scope_config")
        web._sessions.clear()
        self.original_client = llm._client
        self.clients = []
        self.requests = []

    async def asyncTearDown(self):
        for client in self.clients:
            await client.aclose()
        llm._client = self.original_client
        web._sessions.clear()
        await db.close()

    def responses(self, responses):
        queue = list(responses)

        def handle(request):
            self.requests.append(json.loads(request.content))
            item = queue.pop(0)
            return httpx.Response(item[0], json=item[1]) if isinstance(item, tuple) else httpx.Response(200, json=item)

        llm._client = httpx.AsyncClient(transport=httpx.MockTransport(handle))
        self.clients.append(llm._client)

    async def test_pure_chat_unchanged_for_both_formats(self):
        for fmt in ("openai", "claude"):
            self.responses([openai_response() if fmt == "openai" else claude_response([{"type": "text", "text": "回答"}])])
            await llm._request({**PROVIDER, "format": fmt}, "custom-name", "原始人设", MESSAGES, 1024, .9)
            request = self.requests[-1]
            self.assertNotIn("tools", request)
            self.assertNotIn("cache_control", request)
            if fmt == "claude":
                self.assertEqual(request["system"], "原始人设")
                self.assertEqual(request["messages"], llm._to_claude(MESSAGES))
            else:
                self.assertEqual(request["messages"], llm._to_openai("原始人设", MESSAGES))

    async def test_openai_parallel_calls_preserve_prefix_and_usage(self):
        raw = {"role": "assistant", "content": None, "reasoning_content": "opaque reasoning",
               "tool_calls": [{"id": f"call-{i}", "type": "function", "function": {
                   "name": "web_search", "arguments": json.dumps({"query": str(i)})}} for i in (1, 2)]}
        self.responses([openai_response(raw, "tool_calls"), openai_response()])
        before = copy.deepcopy(MESSAGES)
        usage_records = AsyncMock()
        with patch.object(tools, "search", AsyncMock(return_value={"results": []})) as search:
            text, usage = await llm._request(PROVIDER, "m", "原始人设", MESSAGES, 1024, .9,
                                             tool_mode="external", search_cfg={"backend": "tavily"}, on_usage=usage_records)
        self.assertEqual(search.await_count, 2)
        self.assertEqual(usage_records.await_count, 2)
        self.assertEqual(usage, {"input": 80, "output": 20, "cache_read": 120, "cache_write": 0})
        first, second = self.requests
        self.assertEqual(second["messages"][:len(first["messages"])], first["messages"])
        self.assertEqual(first["tools"], second["tools"])
        self.assertEqual(second["messages"][-3], raw)
        self.assertEqual([m["tool_call_id"] for m in second["messages"][-2:]], ["call-1", "call-2"])
        self.assertEqual(MESSAGES, before)
        self.assertIn("回答", text)

    async def test_claude_preserves_blocks_and_returns_error_for_bad_arguments(self):
        blocks = [{"type": "thinking", "thinking": "opaque", "signature": "signed"},
                  {"type": "tool_use", "id": "tool-1", "name": "web_search", "input": {"query": "新闻"}},
                  {"type": "tool_use", "id": "tool-2", "name": "web_search", "input": {"bad": "参数"}}]
        self.responses([claude_response(blocks, "tool_use"), claude_response([{"type": "text", "text": "<reply>回答</reply>"}])])
        with patch.object(tools, "search", AsyncMock(return_value={"results": []})) as search:
            _, usage = await llm._request({**PROVIDER, "format": "claude"}, "m", "原始人设", MESSAGES, 1024, .9,
                                         tool_mode="external", search_cfg={"backend": "tavily"})
        first, second = self.requests
        self.assertEqual(second["system"], first["system"])
        self.assertEqual(second["messages"][:-2], first["messages"])
        self.assertEqual(second["messages"][-2]["content"], blocks)
        results = second["messages"][-1]["content"]
        self.assertFalse(results[0]["is_error"])
        self.assertTrue(results[1]["is_error"])
        self.assertEqual(search.await_count, 1)
        self.assertEqual(usage["cache_write"], 10)

    async def test_native_pause_preserves_encrypted_results_and_citations(self):
        blocks = [{"type": "text", "text": "<reply>查到了："},
                  {"type": "server_tool_use", "id": "srv-1", "name": "web_search", "input": {"query": "新闻"}},
                  {"type": "web_search_tool_result", "tool_use_id": "srv-1", "content": [
                      {"type": "web_search_result", "url": "https://source.test", "encrypted_content": "opaque"}]}]
        citation = {"type": "web_search_result_location", "url": "https://source.test/a(b)", "encrypted_index": "signed"}
        self.responses([claude_response(blocks, "pause_turn"), claude_response([
            {"type": "text", "text": "新闻内容</reply>", "citations": [citation, citation]}])])
        with patch.object(tools, "execute", AsyncMock()) as execute:
            text, _ = await llm._request({**PROVIDER, "format": "claude"}, "m", "原始人设", MESSAGES, 1024, .9,
                                       tool_mode="claude")
        execute.assert_not_awaited()
        self.assertEqual(self.requests[1]["messages"][-1]["content"], blocks)
        self.assertEqual(self.requests[0]["tools"], self.requests[1]["tools"])
        self.assertNotIn("cache_control", self.requests[1])
        reply = context.parse_output(text)["reply"]
        self.assertIn("查到了：新闻内容", reply)
        self.assertEqual(reply.count("https://source.test/a(b)"), 1)

    async def test_external_round_limit_keeps_tools_and_disables_execution(self):
        call = {"role": "assistant", "content": None, "tool_calls": [
            {"id": "id-1", "type": "function", "function": {"name": "web_search", "arguments": '{"query":"新闻"}'}}]}
        self.responses([openai_response(call, "tool_calls"), openai_response()])
        with patch.object(tools, "search", AsyncMock(return_value={"results": []})):
            await llm._request(PROVIDER, "m", "s", MESSAGES, 1024, .9,
                               tool_mode="external", tool_rounds=1, search_cfg={"backend": "tavily"})
        self.assertEqual(self.requests[1]["tool_choice"], "none")
        self.assertEqual(self.requests[0]["tools"], self.requests[1]["tools"])

    async def test_unknown_and_malformed_tools_do_not_execute_search(self):
        with patch.object(tools, "search", AsyncMock()) as search:
            for name, args in (("shell", '{}'), ("web_search", 'invalid'), ("web_search", '{"query":7}')):
                result, error = await tools.execute(name, args, {})
                self.assertTrue(error)
                self.assertIn("error", json.loads(result))
            result, error = await llm._execute_tool("web_search", {"query": "x"}, {}, 13)
            self.assertTrue(error)
        search.assert_not_awaited()
        with self.assertRaises(ValueError):
            await tools.search(7, {})

    async def test_native_pause_limit_and_incompatible_format(self):
        pause = claude_response([{"type": "server_tool_use", "id": "s", "name": "web_search", "input": {"query": "x"}}], "pause_turn")
        self.responses([pause, pause])
        with self.assertRaisesRegex(llm.LLMError, "上限"):
            await llm._request({**PROVIDER, "format": "claude"}, "m", "s", MESSAGES, 1024, .9,
                               tool_mode="claude", tool_rounds=1)
        with self.assertRaisesRegex(llm.LLMError, "Claude 格式"):
            await llm._request(PROVIDER, "m", "s", MESSAGES, 1024, .9, tool_mode="claude")

    async def configure_models(self):
        await llm.save_providers([{**PROVIDER}, {**PROVIDER, "id": "fb", "name": "fallback"}])
        await db.set_setting("models", {"chat": {"provider": "p", "model": "main"},
                                        "judge": {"provider": "p", "model": "judge"},
                                        "fallback": {"provider": "fb", "model": "backup"}})

    async def test_fallback_keeps_prior_round_usage_and_starts_fresh(self):
        await self.configure_models()
        call = {"role": "assistant", "content": None, "tool_calls": [{"id": "id", "type": "function",
               "function": {"name": "web_search", "arguments": '{"query":"新闻"}'}}]}
        self.responses([openai_response(call, "tool_calls"), (500, {"error": "failed"}), openai_response()])
        with patch.object(tools, "search", AsyncMock(return_value={"results": []})):
            await llm.call("chat", "原始人设", MESSAGES, tool_mode="external")
        rows = await db.fetchall("SELECT * FROM usage ORDER BY id")
        self.assertEqual([r["ok"] for r in rows], [1, 0, 1])
        self.assertEqual(sum(r["input_tokens"] for r in rows), 80)
        self.assertEqual(self.requests[2]["messages"], self.requests[0]["messages"])
        self.assertEqual(self.requests[2]["model"], "backup")

    async def test_other_purposes_cannot_enable_tools(self):
        await self.configure_models()
        self.responses([openai_response()])
        await llm.call("judge", "s", MESSAGES, tool_mode="external")
        self.assertNotIn("tools", self.requests[0])

    async def test_noncompliant_model_cannot_loop_past_limit(self):
        call = {"role": "assistant", "content": None, "tool_calls": [
            {"id": "id", "type": "function", "function": {"name": "web_search", "arguments": '{"query":"新闻"}'}}]}
        self.responses([openai_response(call, "tool_calls"), openai_response(call, "tool_calls")])
        with patch.object(tools, "search", AsyncMock(return_value={"results": []})) as search:
            with self.assertRaises(llm.LLMError):
                await llm._request(PROVIDER, "m", "s", MESSAGES, 1024, .9, tool_mode="external",
                                   tool_rounds=1, search_cfg={"backend": "tavily"})
        self.assertEqual(len(self.requests), 2)
        self.assertEqual(search.await_count, 1)

    async def test_claude_model_pagination_and_list_route_persistence(self):
        await llm.save_providers([{**PROVIDER, "format": "claude"}])
        pages = [{"data": [{"id": "model-b"}], "has_more": True, "last_id": "model-b"},
                 {"data": [{"id": "model-a"}], "has_more": False}]
        requests = []

        def handle(request):
            requests.append(request)
            return httpx.Response(200, json=pages.pop(0))

        llm._client = httpx.AsyncClient(transport=httpx.MockTransport(handle))
        self.clients.append(llm._client)
        result = await web.provider_models({"provider": {"id": "p"}})
        self.assertTrue(result["ok"])
        self.assertEqual(result["models"], ["model-a", "model-b"])
        self.assertEqual(requests[1].url.params["after_id"], "model-b")
        self.assertEqual((await llm.get_providers())[0]["model_list"], result["models"])

    async def test_list_from_changed_draft_does_not_overwrite_saved_provider(self):
        await llm.save_providers([PROVIDER])
        await llm.cache_model_list("p", ["saved-model"])
        with patch.object(llm, "list_models", AsyncMock(return_value=["draft-model"])):
            result = await web.provider_models({"provider": {"id": "p", "base_url": "https://other.test"}})
        self.assertTrue(result["ok"])
        self.assertEqual((await llm.get_providers())[0]["model_list"], ["saved-model"])

    async def test_search_key_is_encrypted_and_masked(self):
        await tools.save_settings({"backend": "tavily", "base_url": "https://search.test", "api_key": "secret-test-key"})
        saved = await db.get_setting("search")
        self.assertNotIn("secret-test-key", json.dumps(saved))
        self.assertEqual(crypto.decrypt(saved["api_key_enc"]), "secret-test-key")
        self.assertNotIn("api_key", await tools.settings())
        await tools.save_settings({"backend": "tavily", "base_url": "https://search.test", "api_key": ""})
        self.assertEqual((await tools.settings(True))["api_key"], "secret-test-key")
        await tools.save_settings({"backend": "tavily", "base_url": "https://search.test", "clear_key": True})
        self.assertEqual((await tools.settings(True))["api_key"], "")

    async def test_model_lists_persist_and_invalidate_when_provider_changes(self):
        await llm.save_providers([PROVIDER])
        await llm.cache_model_list("p", ["listed-model"])
        await llm.save_providers([{**PROVIDER, "name": "renamed"}])
        self.assertEqual((await llm.get_providers())[0]["model_list"], ["listed-model"])
        await llm.save_providers([{**PROVIDER, "base_url": "https://other.test"}])
        self.assertEqual((await llm.get_providers())[0]["model_list"], [])
        await web.save_models({"models": {"chat": {"provider": "p", "model": "my-unlisted-model"}}})
        self.assertEqual((await llm.get_models())["chat"]["model"], "my-unlisted-model")

    async def test_scope_tools_inherit_and_validate(self):
        await store.set_scope("global", "global", {"chat_tools": "external"})
        await store.set_scope("guild", "g", {"chat_tools": "off"})
        self.assertEqual((await store.resolve("g", "c"))["chat_tools"], "off")
        await store.set_scope("channel", "c", {"chat_tools": "claude"})
        self.assertEqual((await store.resolve("g", "c"))["chat_tools"], "claude")
        for config in ({"chat_tools": "invalid"}, {"chat_tool_rounds": 9}):
            with self.assertRaises(ValueError):
                await store.set_scope("global", "global", config)

    async def test_search_routes_require_auth_and_hide_keys(self):
        transport = httpx.ASGITransport(app=web.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            for method, path in (("GET", "/api/search"), ("POST", "/api/search"), ("POST", "/api/search/test")):
                response = await client.request(method, path, json={} if method == "POST" else None)
                self.assertEqual(response.status_code, 401)
            web._sessions["test-session"] = 9999999999
            client.cookies.set("session", "test-session")
            response = await client.post("/api/search", json={"backend": "tavily", "base_url": "https://search.test", "api_key": "test-secret"})
            self.assertEqual(response.status_code, 200)
            self.assertNotIn("api_key", response.json()["data"])
            response = await client.post("/api/search", json={"backend": "unknown"})
            self.assertEqual(response.status_code, 400)


class SearchProtocolTests(unittest.IsolatedAsyncioTestCase):
    async def test_both_search_backends(self):
        original = httpx.AsyncClient
        for backend in ("tavily", "searxng"):
            seen = []

            def handle(request):
                seen.append(request)
                return httpx.Response(200, json={"results": [
                    {"title": "Source", "url": "https://source.test", "content": "新闻"},
                    {"title": "Bad", "url": "javascript:alert(1)", "content": "bad"}]})

            with patch.object(tools.httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(handle), **kwargs)):
                result = await tools.search("新闻", {"backend": backend, "base_url": "https://search.test", "api_key": "key", "max_results": 5})
            self.assertEqual(len(result["results"]), 1)
            if backend == "tavily":
                self.assertEqual(seen[0].method, "POST")
                self.assertEqual(seen[0].headers["authorization"], "Bearer key")
                self.assertEqual(json.loads(seen[0].content)["query"], "新闻")
            else:
                self.assertEqual(seen[0].url.params["format"], "json")
                self.assertNotIn("authorization", seen[0].headers)

    async def test_search_error_does_not_forward_provider_response_or_key(self):
        original = httpx.AsyncClient

        def handle(request):
            return httpx.Response(403, json={"error": "private provider diagnostics and secret-key"})

        cfg = {"backend": "tavily", "base_url": "https://search.test", "api_key": "secret-key"}
        with patch.object(tools.httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(handle), **kwargs)):
            result, error = await tools.execute("web_search", {"query": "新闻"}, cfg)
        self.assertTrue(error)
        self.assertIn("HTTP 403", result)
        self.assertNotIn("secret-key", result)
        self.assertNotIn("private provider diagnostics", result)


if __name__ == "__main__":
    unittest.main()
