"""大模型调用：支持 OpenAI 兼容格式和 Claude 格式，按用途选择模型，失败时切换备用模型，记录用量。

内部消息格式：
    {"role": "user" | "assistant", "parts": [{"type": "text", "text": "..."},
                                             {"type": "image", "media_type": "image/png", "data": "<base64>"}]}
"""
import copy
import logging
import time
import uuid

import httpx

from . import crypto, db, tools

log = logging.getLogger("llm")

PURPOSES = {
    "chat": "聊天回复",
    "judge": "插话判断",
    "summary": "记忆总结",
    "tagging": "表情打标（需支持图片）",
    "fallback": "备用模型（主模型报错时使用）",
}

MODEL_DEFAULTS = {"provider": "", "model": "", "max_tokens": 1024, "temperature": 0.9}

_client: httpx.AsyncClient | None = None


class LLMError(Exception):
    pass


def client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=httpx.Timeout(180.0, connect=20.0))
    return _client


# ---------- 配置读取 ----------

async def get_providers(with_keys: bool = False) -> list[dict]:
    providers = await db.get_setting("providers", []) or []
    out = []
    for p in providers:
        item = {k: v for k, v in p.items() if k != "api_key_enc"}
        key = crypto.decrypt(p.get("api_key_enc", ""))
        if with_keys:
            item["api_key"] = key
        else:
            item["api_key_masked"] = crypto.mask(key)
        out.append(item)
    return out


async def save_providers(items: list[dict]) -> None:
    old = {p["id"]: p for p in (await db.get_setting("providers", []) or [])}
    result = []
    for it in items:
        pid = it.get("id") or uuid.uuid4().hex[:8]
        fmt = it.get("format") if it.get("format") in ("openai", "claude") else "openai"
        entry = {
            "id": pid,
            "name": (it.get("name") or pid).strip(),
            "format": fmt,
            "base_url": (it.get("base_url") or "").strip(),
            "model_list": (list(old.get(pid, {}).get("model_list") or [])
                           if old.get(pid, {}).get("base_url") == (it.get("base_url") or "").strip()
                           and old.get(pid, {}).get("format") == fmt else []),
        }
        new_key = (it.get("api_key") or "").strip()
        if new_key:
            entry["api_key_enc"] = crypto.encrypt(new_key)
        elif pid in old:
            entry["api_key_enc"] = old[pid].get("api_key_enc", "")
        else:
            entry["api_key_enc"] = ""
        result.append(entry)
    await db.set_setting("providers", result)


async def get_models() -> dict:
    data = await db.get_setting("models", {}) or {}
    out = {}
    for purpose in PURPOSES:
        m = dict(MODEL_DEFAULTS)
        m.update(data.get(purpose) or {})
        out[purpose] = m
    return out


# ---------- 格式转换 ----------

def _normalize(messages: list[dict]) -> list[dict]:
    """合并相邻同角色消息，去掉开头的 assistant（Claude 要求从 user 开始）。"""
    merged: list[dict] = []
    for m in messages:
        parts = [p for p in m["parts"] if (p["type"] != "text" or p["text"].strip())]
        if not parts:
            continue
        if merged and merged[-1]["role"] == m["role"]:
            merged[-1]["parts"].extend([{"type": "text", "text": "\n"}] + parts)
        else:
            merged.append({"role": m["role"], "parts": list(parts)})
    while merged and merged[0]["role"] != "user":
        merged.pop(0)
    if not merged:
        merged = [{"role": "user", "parts": [{"type": "text", "text": "（开始）"}]}]
    return merged


def _to_openai(system: str, messages: list[dict]) -> list[dict]:
    out = []
    if system:
        out.append({"role": "system", "content": system})
    for m in messages:
        if all(p["type"] == "text" for p in m["parts"]):
            out.append({"role": m["role"], "content": "".join(p["text"] for p in m["parts"])})
            continue
        content = []
        for p in m["parts"]:
            if p["type"] == "text":
                content.append({"type": "text", "text": p["text"]})
            else:
                content.append({"type": "image_url",
                                "image_url": {"url": f"data:{p['media_type']};base64,{p['data']}"}})
        out.append({"role": m["role"], "content": content})
    return out


def _to_claude(messages: list[dict]) -> list[dict]:
    out = []
    for m in messages:
        content = []
        for p in m["parts"]:
            if p["type"] == "text":
                if content and content[-1]["type"] == "text":
                    content[-1]["text"] += p["text"]
                else:
                    content.append({"type": "text", "text": p["text"]})
            else:
                content.append({"type": "image", "source": {
                    "type": "base64", "media_type": p["media_type"], "data": p["data"]}})
        out.append({"role": m["role"], "content": content})
    return out


def _url(base: str, fmt: str) -> str:
    base = base.rstrip("/")
    if fmt == "claude":
        if base.endswith("/messages"):
            return base
        if base.endswith("/v1"):
            return base + "/messages"
        return base + "/v1/messages"
    if base.endswith("/chat/completions"):
        return base
    if base.endswith("/v1"):
        return base + "/chat/completions"
    return base + "/v1/chat/completions"


# ---------- 调用 ----------

async def _request(provider: dict, model: str, system: str, messages: list[dict],
                   max_tokens: int, temperature: float, tool_mode: str = "off",
                   tool_rounds: int = 4, search_cfg: dict | None = None,
                   on_usage=None) -> tuple[str, dict]:
    fmt = provider.get("format", "openai")
    url = _url(provider.get("base_url", ""), fmt)
    key = provider.get("api_key", "")
    msgs = _normalize(copy.deepcopy(messages))
    if fmt == "claude":
        body = {"model": model, "max_tokens": max_tokens, "temperature": temperature,
                "messages": _to_claude(msgs)}
        if system:
            body["system"] = system
        headers = {"x-api-key": key, "Authorization": f"Bearer {key}",
                   "anthropic-version": "2023-06-01", "content-type": "application/json"}
    else:
        body = {"model": model, "max_tokens": max_tokens, "temperature": temperature,
                "messages": _to_openai(system, msgs)}
        headers = {"Authorization": f"Bearer {key}", "content-type": "application/json"}

    try:
        definitions = tools.definitions(tool_mode, fmt)
    except ValueError as e:
        raise LLMError(str(e)) from e
    if definitions:
        body["tools"] = definitions
    # system 与最初的聊天消息只构建一次。工具续轮仅追加原始调用及结果。
    rounds = max(1, min(8, int(tool_rounds))) if definitions else 0
    total = {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0}
    executed = 0
    paused_text = []
    citations = []
    for step in range(rounds + 1):
        if definitions and step == rounds and tool_mode == "external":
            body["tool_choice"] = {"type": "none"} if fmt == "claude" else "none"
        data = await _post(url, body, headers)
        text, usage, stop = _parse_response(data, fmt, model)
        for k in total:
            total[k] += usage[k]
        if on_usage:
            await on_usage(usage)
        if fmt == "claude":
            blocks = data.get("content") or []
            calls = [b for b in blocks if b.get("type") == "tool_use"]
            for block in blocks:
                citations.extend(c for c in block.get("citations") or [] if c.get("url"))
                if block.get("type") == "web_search_tool_result" and isinstance(block.get("content"), dict):
                    log.warning("Claude 原生搜索错误：%s", block["content"].get("error_code", "unknown"))
            if stop == "pause_turn" and definitions:
                if step == rounds:
                    raise LLMError("Claude 原生搜索续轮达到上限，尚未完成回复")
                paused_text.append(text)
                body["messages"].append({"role": "assistant", "content": copy.deepcopy(blocks)})
                continue
            if calls:
                if tool_mode != "external" or step == rounds:
                    raise LLMError("模型返回了当前模式不允许的工具调用")
                body["messages"].append({"role": "assistant", "content": copy.deepcopy(blocks)})
                results = []
                for call in calls:
                    if not call.get("id"):
                        raise LLMError("Claude 工具调用缺少 ID")
                    executed += 1
                    result, error = await _execute_tool(call.get("name"), call.get("input"),
                                                        search_cfg, executed)
                    results.append({"type": "tool_result", "tool_use_id": call["id"],
                                    "content": result, "is_error": error})
                body["messages"].append({"role": "user", "content": results})
                continue
        else:
            message = data["choices"][0].get("message") or {}
            calls = message.get("tool_calls") or []
            if calls:
                if tool_mode != "external" or step == rounds:
                    raise LLMError("模型返回了当前模式不允许的工具调用")
                # 保留 reasoning_content 等供应商扩展字段，以及原始 arguments/ID。
                body["messages"].append(copy.deepcopy(message))
                for call in calls:
                    if not call.get("id"):
                        raise LLMError("工具调用缺少 ID")
                    executed += 1
                    fn = call.get("function") or {}
                    result, _ = await _execute_tool(fn.get("name"), fn.get("arguments"),
                                                     search_cfg, executed)
                    body["messages"].append({"role": "tool", "tool_call_id": call["id"], "content": result})
                continue
        text = "".join(paused_text) + text
        if definitions and not text.strip():
            raise LLMError("模型完成工具调用后没有返回回复正文")
        return _with_citations(text, citations), total
    raise LLMError("工具调用达到轮数上限")


async def _execute_tool(name, arguments, search_cfg, executed):
    if executed > 12:
        return '{"error":"本次回复已达到 12 次工具调用上限，请用已有结果回答"}', True
    if search_cfg is None:
        return '{"error":"未配置搜索服务"}', True
    return await tools.execute(name, arguments, search_cfg)


def _with_citations(text: str, citations: list[dict]) -> str:
    """把 Claude 原生搜索引用展示到 Discord，避免被 <reply> 解析丢弃。"""
    links = []
    seen = set()
    for citation in citations:
        url = str(citation.get("url") or "")
        if not url.startswith(("https://", "http://")) or url in seen:
            continue
        seen.add(url)
        # URL 用尖括号包裹，括号不会破坏 Markdown；不展示未经转义的来源标题。
        safe = url.replace("<", "%3C").replace(">", "%3E").replace("\n", "").replace("\r", "")
        links.append(f"[{len(links) + 1}](<{safe}>)")
    if not links:
        return text
    refs = "\n\n来源：" + " · ".join(links)
    pos = text.rfind("</reply>")
    return text[:pos] + refs + text[pos:] if pos >= 0 else text + refs


async def _post(url: str, body: dict, headers: dict) -> dict:
    resp = await client().post(url, json=body, headers=headers)
    if resp.status_code >= 400:
        raise LLMError(f"HTTP {resp.status_code}: {resp.text[:500]}")
    try:
        data = resp.json()
    except ValueError:
        raise LLMError(f"返回的不是 JSON: {resp.text[:300]}")
    if not isinstance(data, dict):
        raise LLMError("模型响应必须是 JSON 对象")
    return data


def _parse_response(data: dict, fmt: str, model: str) -> tuple[str, dict, str]:

    usage = {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0}
    if fmt == "claude":
        text = "".join(c.get("text", "") for c in data.get("content", []) if c.get("type") == "text")
        stop = data.get("stop_reason") or ""
        u = data.get("usage") or {}
        usage["input"] = int(u.get("input_tokens") or 0)
        usage["output"] = int(u.get("output_tokens") or 0)
        usage["cache_read"] = int(u.get("cache_read_input_tokens") or 0)
        usage["cache_write"] = int(u.get("cache_creation_input_tokens") or 0)
    else:
        choices = data.get("choices") or []
        if not choices:
            raise LLMError(f"没有返回内容: {str(data)[:300]}")
        content = (choices[0].get("message") or {}).get("content") or ""
        if isinstance(content, list):
            content = "".join(c.get("text", "") for c in content if isinstance(c, dict))
        text = content
        stop = choices[0].get("finish_reason") or ""
        u = data.get("usage") or {}
        details = u.get("prompt_tokens_details") or {}
        usage["cache_read"] = int(details.get("cached_tokens") or u.get("cache_read_input_tokens") or 0)
        usage["cache_write"] = int(u.get("cache_creation_input_tokens") or 0)
        # OpenAI 格式的 prompt_tokens 已包含缓存命中部分，扣掉以免重复计费
        usage["input"] = max(0, int(u.get("prompt_tokens") or 0) - usage["cache_read"])
        usage["output"] = int(u.get("completion_tokens") or 0)
    if stop in ("max_tokens", "length"):
        log.warning("模型 %s 的输出因达到最大 tokens 被截断%s，请在 API 页调大「最大输出 tokens」"
                    "（开启思考时思考内容也占用这个额度）", model, "，正文为空" if not text.strip() else "")
    elif not text.strip() and stop not in ("tool_use", "tool_calls", "pause_turn"):
        log.warning("模型 %s 返回了空内容（stop_reason=%s）", model, stop or "?")
    return text, usage, stop


async def _record(guild_id, provider, model, purpose, usage, ok):
    try:
        await db.execute(
            "INSERT INTO usage (ts, guild_id, provider, model, purpose, input_tokens, output_tokens, "
            "cache_read, cache_write, ok) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (time.time(), guild_id or "", provider, model, purpose, usage.get("input", 0),
             usage.get("output", 0), usage.get("cache_read", 0), usage.get("cache_write", 0), 1 if ok else 0),
        )
    except Exception:
        log.exception("记录用量失败")


async def call(purpose: str, system: str, messages: list[dict], guild_id: str | None = None,
               provider_id: str = "", model: str = "", max_tokens: int | None = None,
               tool_mode: str = "off", tool_rounds: int = 4) -> str:
    """按用途调用模型。provider_id/model 可覆盖用途配置（例如分层配置中的聊天模型）。"""
    models = await get_models()
    providers = {p["id"]: p for p in await get_providers(with_keys=True)}
    tool_mode = tool_mode if purpose == "chat" else "off"
    search_cfg = await tools.settings(with_key=True) if tool_mode == "external" else None
    primary = dict(models.get(purpose) or MODEL_DEFAULTS)
    if provider_id and model:
        primary["provider"], primary["model"] = provider_id, model

    attempts = [primary]
    fb = models.get("fallback") or {}
    if purpose != "tagging" and fb.get("provider") and fb.get("model") and \
            (fb["provider"], fb["model"]) != (primary.get("provider"), primary.get("model")):
        attempts.append({**fb, "max_tokens": primary.get("max_tokens") or fb.get("max_tokens"),
                         "temperature": primary.get("temperature", fb.get("temperature"))})

    last_err: Exception | None = None
    for i, cfg in enumerate(attempts):
        prov = providers.get(cfg.get("provider", ""))
        if not prov or not cfg.get("model"):
            last_err = LLMError(f"「{PURPOSES.get(purpose, purpose)}」没有配置可用的供应商或模型")
            continue
        try:
            async def record_round(usage):
                await _record(guild_id, prov["name"], cfg["model"], purpose, usage, True)

            text, usage = await _request(
                prov, cfg["model"], system, messages,
                int(max_tokens or cfg.get("max_tokens") or 1024),
                float(cfg.get("temperature") if cfg.get("temperature") is not None else 0.9),
                tool_mode=tool_mode, tool_rounds=tool_rounds, search_cfg=search_cfg,
                on_usage=record_round,
            )
            return text
        except Exception as e:  # noqa: BLE001
            last_err = e
            await _record(guild_id, prov["name"], cfg["model"], purpose, {}, False)
            if i + 1 < len(attempts):
                log.warning("模型 %s 调用失败，切换备用模型：%s", cfg["model"], e)
            else:
                log.error("模型 %s 调用失败：%s", cfg["model"], e)
    raise LLMError(str(last_err) if last_err else "调用失败")


async def _with_saved_key(provider: dict) -> dict:
    """前端没有重新填 Key 时，使用已保存的 Key。"""
    if provider.get("id"):
        saved = {p["id"]: p for p in await get_providers(with_keys=True)}
        if provider["id"] in saved:
            provider = {**saved[provider["id"]], **{k: v for k, v in provider.items() if v}}
    return provider


async def test_provider(provider: dict, model: str) -> str:
    provider = await _with_saved_key(provider)
    text, usage = await _request(provider, model, "", [
        {"role": "user", "parts": [{"type": "text", "text": "请只回复：OK"}]}], 1024, 0)
    return f"{text.strip()[:100] or '（空回复）'}（输入 {usage['input']} / 输出 {usage['output']} tokens）"


async def list_models(provider: dict) -> list[str]:
    """从供应商拉取可用模型列表（OpenAI 与 Claude 都是 GET /v1/models）。"""
    provider = await _with_saved_key(provider)
    fmt = provider.get("format", "openai")
    base = (provider.get("base_url") or "").rstrip("/")
    for suffix in ("/chat/completions", "/messages"):
        if base.endswith(suffix):
            base = base[: -len(suffix)]
    url = base + "/models" if base.endswith("/v1") else base + "/v1/models"
    key = provider.get("api_key", "")
    headers = {"Authorization": f"Bearer {key}"}
    if fmt == "claude":
        headers.update({"x-api-key": key, "anthropic-version": "2023-06-01"})
    ids = set()
    params = {"limit": 1000} if fmt == "claude" else {}
    for _ in range(20):
        resp = await client().get(url, headers=headers, params=params)
        if resp.status_code >= 400:
            raise LLMError(f"HTTP {resp.status_code}: {resp.text[:300]}")
        data = resp.json()
        items = data.get("data") if isinstance(data, dict) else data
        ids.update(str(m["id"]) for m in items or [] if isinstance(m, dict) and m.get("id"))
        if fmt != "claude" or not isinstance(data, dict) or not data.get("has_more"):
            break
        cursor = data.get("last_id")
        if not cursor or cursor == params.get("after_id"):
            raise LLMError("模型列表分页游标无效")
        params["after_id"] = cursor
    else:
        raise LLMError("模型列表分页超过上限")
    ids = sorted(ids)
    if not ids:
        raise LLMError("供应商没有返回模型列表")
    return ids


async def cache_model_list(provider_id: str, models: list[str]) -> None:
    saved = await db.get_setting("providers", []) or []
    for provider in saved:
        if provider["id"] == provider_id:
            provider["model_list"] = models
            await db.set_setting("providers", saved)
            break
