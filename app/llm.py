"""大模型调用：支持 OpenAI 兼容格式和 Claude 格式，按用途选择模型，失败时切换备用模型，记录用量。

内部消息格式：
    {"role": "user" | "assistant", "parts": [{"type": "text", "text": "..."},
                                             {"type": "image", "media_type": "image/png", "data": "<base64>"}]}
"""
import logging
import time
import uuid

import httpx

from . import crypto, db

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
                   max_tokens: int, temperature: float) -> tuple[str, dict]:
    fmt = provider.get("format", "openai")
    url = _url(provider.get("base_url", ""), fmt)
    key = provider.get("api_key", "")
    msgs = _normalize(messages)
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

    resp = await client().post(url, json=body, headers=headers)
    if resp.status_code >= 400:
        raise LLMError(f"HTTP {resp.status_code}: {resp.text[:500]}")
    try:
        data = resp.json()
    except ValueError:
        raise LLMError(f"返回的不是 JSON: {resp.text[:300]}")

    usage = {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0}
    if fmt == "claude":
        text = "".join(c.get("text", "") for c in data.get("content", []) if c.get("type") == "text")
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
        u = data.get("usage") or {}
        usage["input"] = int(u.get("prompt_tokens") or 0)
        usage["output"] = int(u.get("completion_tokens") or 0)
        details = u.get("prompt_tokens_details") or {}
        usage["cache_read"] = int(details.get("cached_tokens") or u.get("cache_read_input_tokens") or 0)
        usage["cache_write"] = int(u.get("cache_creation_input_tokens") or 0)
    return text, usage


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
               provider_id: str = "", model: str = "", max_tokens: int | None = None) -> str:
    """按用途调用模型。provider_id/model 可覆盖用途配置（例如分层配置中的聊天模型）。"""
    models = await get_models()
    providers = {p["id"]: p for p in await get_providers(with_keys=True)}
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
            text, usage = await _request(
                prov, cfg["model"], system, messages,
                int(max_tokens or cfg.get("max_tokens") or 1024),
                float(cfg.get("temperature") if cfg.get("temperature") is not None else 0.9),
            )
            await _record(guild_id, prov["name"], cfg["model"], purpose, usage, True)
            return text
        except Exception as e:  # noqa: BLE001
            last_err = e
            await _record(guild_id, prov["name"], cfg["model"], purpose, {}, False)
            if i + 1 < len(attempts):
                log.warning("模型 %s 调用失败，切换备用模型：%s", cfg["model"], e)
            else:
                log.error("模型 %s 调用失败：%s", cfg["model"], e)
    raise LLMError(str(last_err) if last_err else "调用失败")


async def test_provider(provider: dict, model: str) -> str:
    if not provider.get("api_key") and provider.get("id"):
        saved = {p["id"]: p for p in await get_providers(with_keys=True)}
        if provider["id"] in saved:
            provider = {**saved[provider["id"]], **{k: v for k, v in provider.items() if v}}
    text, usage = await _request(provider, model, "", [
        {"role": "user", "parts": [{"type": "text", "text": "请只回复：OK"}]}], 16, 0)
    return f"{text.strip()[:100]}（输入 {usage['input']} / 输出 {usage['output']} tokens）"
