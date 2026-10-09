"""管理后台 API。"""
import asyncio
import collections
import datetime as dt
import hashlib
import hmac
import json
import logging
import secrets
import time
from pathlib import Path

from fastapi import Body, Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import config, context, crypto, db, llm, logbuf, memory, store, tools
from .bot import manager

log = logging.getLogger("web")
STATIC = Path(__file__).parent / "static"

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
app.mount("/static", StaticFiles(directory=STATIC), name="static")

# 机器人邀请权限：查看频道、发消息、读历史、加反应、外部表情、外部贴纸、在子区发消息
INVITE_PERMISSIONS = 1024 | 2048 | 65536 | 64 | 262144 | 137438953472 | 274877906944

# ---------- 认证 ----------

SESSION_TTL = 7 * 24 * 3600
_sessions: dict[str, float] = {}
_fails: dict[str, collections.deque] = collections.defaultdict(collections.deque)
MAX_FAILS, FAIL_WINDOW = 5, 15 * 60


def _hash(password: str, salt: bytes) -> str:
    return hashlib.scrypt(password.encode(), salt=salt, n=2 ** 14, r=8, p=1).hex()


async def set_password(password: str) -> None:
    salt = secrets.token_bytes(16)
    await db.set_setting("admin_password", {"salt": salt.hex(), "hash": _hash(password, salt)})


async def ensure_password() -> None:
    if await db.get_setting("admin_password"):
        return
    pw = config.ADMIN_PASSWORD
    if not pw:
        pw = secrets.token_urlsafe(12)
        (config.DATA_DIR / "initial_password.txt").write_text(pw)
        log.warning("没有设置 ADMIN_PASSWORD，已生成随机密码，保存在数据目录的 initial_password.txt")
    await set_password(pw)


async def check_password(password: str) -> bool:
    data = await db.get_setting("admin_password")
    if not data:
        return False
    return hmac.compare_digest(_hash(password, bytes.fromhex(data["salt"])), data["hash"])


def client_ip(request: Request) -> str:
    return (request.headers.get("cf-connecting-ip") or request.headers.get("x-real-ip")
            or (request.client.host if request.client else "unknown"))


def require_auth(request: Request) -> None:
    token = request.cookies.get("session", "")
    exp = _sessions.get(token)
    if not exp or exp < time.time():
        _sessions.pop(token, None)
        raise HTTPException(401, "未登录")


@app.middleware("http")
async def security_headers(request: Request, call_next):
    resp = await call_next(request)
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Referrer-Policy"] = "no-referrer"
    if request.url.path.startswith("/api"):
        resp.headers["Cache-Control"] = "no-store"
    return resp


@app.get("/")
async def index():
    return FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-cache"})


@app.post("/api/login")
async def login(request: Request, body: dict = Body(...)):
    ip = client_ip(request)
    dq = _fails[ip]
    now = time.time()
    while dq and now - dq[0] > FAIL_WINDOW:
        dq.popleft()
    if len(dq) >= MAX_FAILS:
        raise HTTPException(429, f"失败次数过多，请 {int((FAIL_WINDOW - (now - dq[0])) / 60) + 1} 分钟后再试")
    if not await check_password(str(body.get("password", ""))):
        dq.append(now)
        log.warning("后台登录失败，IP %s", ip)
        await asyncio.sleep(1)
        raise HTTPException(401, "密码错误")
    dq.clear()
    token = secrets.token_urlsafe(32)
    _sessions[token] = now + SESSION_TTL
    log.info("后台登录成功，IP %s", ip)
    resp = JSONResponse({"ok": True})
    secure = request.headers.get("x-forwarded-proto", request.url.scheme) == "https"
    resp.set_cookie("session", token, max_age=SESSION_TTL, httponly=True, samesite="strict", secure=secure)
    return resp


@app.post("/api/logout")
async def logout(request: Request):
    _sessions.pop(request.cookies.get("session", ""), None)
    resp = JSONResponse({"ok": True})
    resp.delete_cookie("session")
    return resp


@app.get("/api/session")
async def session(request: Request):
    token = request.cookies.get("session", "")
    return {"ok": bool(_sessions.get(token, 0) > time.time())}


A = [Depends(require_auth)]


@app.post("/api/password", dependencies=A)
async def change_password(body: dict = Body(...)):
    if not await check_password(str(body.get("old", ""))):
        raise HTTPException(400, "旧密码不正确")
    new = str(body.get("new", ""))
    if len(new) < 8:
        raise HTTPException(400, "新密码至少 8 位")
    await set_password(new)
    _sessions.clear()
    return {"ok": True}


# ---------- 状态 / bot ----------

@app.get("/api/status", dependencies=A)
async def status():
    s = manager.status()
    token = await manager.token()
    s["token_masked"] = crypto.mask(token)
    if s.get("user_id"):
        s["invite_url"] = (f"https://discord.com/oauth2/authorize?client_id={s['user_id']}"
                           f"&scope=bot&permissions={INVITE_PERMISSIONS}")
    return s


@app.post("/api/bot/token", dependencies=A)
async def set_token(body: dict = Body(...)):
    token = str(body.get("token", "")).strip()
    if not token:
        raise HTTPException(400, "token 不能为空")
    await db.set_setting("bot_token_enc", crypto.encrypt(token))
    await manager.start()
    return {"ok": True}


@app.post("/api/bot/start", dependencies=A)
async def bot_start():
    await manager.start()
    return {"ok": True}


@app.post("/api/bot/stop", dependencies=A)
async def bot_stop():
    await manager.stop()
    return {"ok": True}


# ---------- 服务器 / 群友 ----------

@app.get("/api/guilds", dependencies=A)
async def guilds():
    rows = await db.fetchall("SELECT * FROM guilds ORDER BY joined DESC, name")
    for g in rows:
        g["channels"] = await db.fetchall(
            "SELECT id, name, type FROM channels WHERE guild_id=? ORDER BY position", (g["id"],))
        c = await db.fetchone("SELECT COUNT(*) AS n FROM messages WHERE guild_id=?", (g["id"],))
        g["message_count"] = c["n"]
    return rows


@app.get("/api/guilds/{gid}/members", dependencies=A)
async def members(gid: str, q: str = ""):
    sql = ("SELECT m.*, (SELECT COUNT(*) FROM messages WHERE guild_id=m.guild_id AND author_id=m.user_id) AS msgs, "
           "(SELECT id FROM memories WHERE scope=? AND guild_id=m.guild_id AND user_id=m.user_id) AS memory_id "
           "FROM members m WHERE m.guild_id=?")
    params: list = ["dm" if gid == context.DM_GUILD else "user", gid]
    if q:
        sql += " AND (m.username LIKE ? OR m.nick LIKE ? OR m.global_name LIKE ? OR m.user_id LIKE ?)"
        params += [f"%{q}%"] * 4
    sql += " ORDER BY m.in_guild DESC, msgs DESC, m.username LIMIT 500"
    rows = await db.fetchall(sql, params)
    for r in rows:
        r["tag"] = await context.user_tag(gid, r["user_id"])
        current = r["nick"] or r["global_name"] or r["username"] or ""
        r["former"] = [n for n in await context.former_names(gid, r["user_id"], current)
                       if n not in (r["username"], r["nick"], r["global_name"])]
    return rows


@app.post("/api/channels/{cid}/import", dependencies=A)
async def import_channel(cid: str, body: dict = Body(default={})):
    client = manager.client
    if client is None or not client.is_ready():
        raise HTTPException(400, "bot 不在线，先到「设置 › 机器人连接」连上 Discord")
    limit = max(1, min(int(body.get("limit") or 500), 20000))
    job = memory.new_job("import")

    async def runner():
        try:
            await client.import_history(int(cid), limit, job)
            job["status"] = "done"
        except Exception as e:  # noqa: BLE001
            job["status"], job["error"] = "error", str(e)

    asyncio.create_task(runner())
    return {"job_id": job["id"]}


_guild_imports: dict[str, str] = {}


@app.post("/api/guilds/{gid}/import", dependencies=A)
async def import_guild(gid: str, body: dict = Body(default={})):
    client = manager.client
    if client is None or not client.is_ready():
        raise HTTPException(400, "bot 不在线，先到「设置 › 机器人连接」连上 Discord")
    running = _guild_imports.get(gid)
    if running and memory.jobs.get(running, {}).get("status") == "running":
        return {"job_id": running}
    limit = max(1, min(int(body.get("limit") or 2000), 50000))
    job = memory.new_job("import_guild")
    _guild_imports[gid] = job["id"]

    async def runner():
        try:
            await client.import_guild(int(gid), limit, job)
            job["status"] = "done"
        except Exception as e:  # noqa: BLE001
            job["status"], job["error"] = "error", str(e)

    asyncio.create_task(runner())
    return {"job_id": job["id"]}


@app.get("/api/guilds/{gid}/import", dependencies=A)
async def import_guild_status(gid: str):
    jid = _guild_imports.get(gid)
    return memory.jobs.get(jid) if jid else None


@app.get("/api/jobs/{jid}", dependencies=A)
async def job(jid: str):
    j = memory.jobs.get(jid)
    if not j:
        raise HTTPException(404, "任务不存在（可能服务已重启）")
    return j


# ---------- 分层配置 ----------

@app.get("/api/config", dependencies=A)
async def get_config(scope_type: str, scope_id: str = "global"):
    data = await store.get_scope(scope_type, scope_id)
    if scope_type == "global":
        parent = dict(store.SCOPE_DEFAULTS)
    elif scope_type == "guild":
        parent = await store.resolve(None, None)
    else:
        ch = await db.fetchone("SELECT guild_id FROM channels WHERE id=?", (scope_id,))
        parent = await store.resolve(ch["guild_id"] if ch else None, None)
    return {"data": data, "parent": parent, "defaults": store.SCOPE_DEFAULTS}


@app.get("/api/config/channels", dependencies=A)
async def channel_configs(guild_id: str):
    """某个服务器下每个频道的单独设置。"""
    rows = await db.fetchall(
        "SELECT s.scope_id, s.data FROM scope_config s JOIN channels c ON c.id=s.scope_id "
        "WHERE s.scope_type='channel' AND c.guild_id=?", (guild_id,))
    out = {}
    for r in rows:
        try:
            out[r["scope_id"]] = json.loads(r["data"]) or {}
        except ValueError:
            pass
    return out


@app.post("/api/config", dependencies=A)
async def save_config(body: dict = Body(...)):
    st = body.get("scope_type")
    if st not in ("global", "guild", "channel"):
        raise HTTPException(400, "scope_type 无效")
    try:
        await store.set_scope(st, str(body.get("scope_id") or "global"), body.get("data") or {})
    except (ValueError, TypeError) as e:
        raise HTTPException(400, str(e)) from e
    return {"ok": True}


# ---------- 上下文起点 ----------

async def _starts(guild_id: str) -> dict:
    rows = await db.fetchall("SELECT * FROM context_start WHERE guild_id=?", (guild_id,))
    out = {}
    for r in rows:
        after = await db.fetchone(
            "SELECT COUNT(*) AS n FROM messages WHERE channel_id=? AND deleted=0 AND created_at>=?",
            (r["channel_id"], r["start_ts"]))
        first = await db.fetchone(
            "SELECT * FROM messages WHERE channel_id=? AND deleted=0 AND created_at>=? ORDER BY created_at LIMIT 1",
            (r["channel_id"], r["start_ts"]))
        item = {"start_ts": r["start_ts"], "message_id": r["message_id"], "set_at": r["set_at"],
                "after": after["n"], "first": None}
        if first:
            who = "bot" if first["is_self"] else (first["display"] or first["username"])
            item["first"] = {"who": who, "text": (first["content"] or "")[:80], "ts": first["created_at"]}
        out[r["channel_id"]] = item
    return out


async def _guild_channel_ids(guild_id: str) -> list[str]:
    rows = await db.fetchall(
        "SELECT id FROM channels WHERE guild_id=? UNION SELECT DISTINCT channel_id FROM messages WHERE guild_id=?",
        (guild_id, guild_id))
    return [r["id"] for r in rows]


@app.get("/api/context/starts", dependencies=A)
async def context_starts(guild_id: str):
    data = {"starts": await _starts(guild_id)}
    if guild_id == context.DM_GUILD:
        convs = await db.fetchall(
            "SELECT channel_id, MAX(created_at) AS last, COUNT(*) AS n FROM messages WHERE guild_id=? GROUP BY channel_id "
            "ORDER BY last DESC", (guild_id,))
        for c in convs:
            other = await db.fetchone(
                "SELECT author_id FROM messages WHERE channel_id=? AND is_self=0 ORDER BY created_at DESC LIMIT 1",
                (c["channel_id"],))
            c["tag"] = await context.user_tag(guild_id, other["author_id"]) if other else "（未知）"
        data["conversations"] = convs
    return data


@app.post("/api/context/start", dependencies=A)
async def set_context_start(body: dict = Body(...)):
    gid = str(body.get("guild_id") or "")
    targets = [str(c) for c in body.get("channel_ids") or []]
    if body.get("all"):
        targets = await _guild_channel_ids(gid)
    if not targets:
        raise HTTPException(400, "没有选择频道")
    mode = body.get("mode") or "now"
    message_id = ""
    if mode == "now":
        ts = time.time()
    elif mode == "time":
        if not body.get("ts"):
            raise HTTPException(400, "请选择时间")
        ts = float(body["ts"])
    elif mode == "message":
        if len(targets) != 1:
            raise HTTPException(400, "按消息设置只能针对单个频道")
        try:
            link_channel, message_id = context.parse_message_ref(str(body.get("message") or ""))
        except ValueError as e:
            raise HTTPException(400, str(e))
        if link_channel and link_channel != targets[0]:
            raise HTTPException(400, "这条消息链接不是这个频道里的")
        ts = context.snowflake_ts(message_id)
    else:
        raise HTTPException(400, "mode 无效")
    for cid in targets:
        await context.set_context_start(cid, gid, ts, message_id)
    log.info("设置了 %d 个频道的上下文起点：%s", len(targets),
             dt.datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S"))
    return {"ok": True, "start_ts": ts, "starts": await _starts(gid)}


@app.post("/api/context/clear", dependencies=A)
async def clear_context_start(body: dict = Body(...)):
    gid = str(body.get("guild_id") or "")
    targets = [str(c) for c in body.get("channel_ids") or []]
    if body.get("all"):
        await db.execute("DELETE FROM context_start WHERE guild_id=?", (gid,))
    for cid in targets:
        await context.clear_context_start(cid)
    return {"ok": True, "starts": await _starts(gid)}


# ---------- 记忆 ----------

@app.get("/api/memory/list", dependencies=A)
async def memory_list(guild_id: str):
    scope_user = "dm" if guild_id == context.DM_GUILD else "user"
    g = None if guild_id == context.DM_GUILD else await memory.get("guild", guild_id, "")
    users = await db.fetchall(
        "SELECT id, user_id, content, updated_at FROM memories WHERE scope=? AND guild_id=? ORDER BY updated_at DESC",
        (scope_user, guild_id))
    for u in users:
        u["tag"] = await context.user_tag(guild_id, u["user_id"])
    return {"guild": g, "users": users}


@app.get("/api/memory/get", dependencies=A)
async def memory_get(scope: str, guild_id: str, user_id: str = ""):
    row = await memory.get(scope, guild_id, user_id)
    tag = await context.tag_with_history(guild_id, user_id) if user_id else ""
    since = row["summarized_until"] if row else None
    return {"memory": row, "tag": tag, "summarized_until": since,
            "new_since": await memory.new_since(scope, guild_id, user_id, since)}


@app.post("/api/memory/save", dependencies=A)
async def memory_save(body: dict = Body(...)):
    until = body.get("summarized_until")
    row = await memory.save(body["scope"], body["guild_id"], body.get("user_id") or "",
                            body.get("content") or "", body.get("note") or "手动修改",
                            float(until) if until else None)
    return {"memory": row}


@app.get("/api/memory/versions", dependencies=A)
async def memory_versions(memory_id: int):
    return await memory.versions(memory_id)


@app.post("/api/memory/restore", dependencies=A)
async def memory_restore(body: dict = Body(...)):
    row = await memory.restore(int(body["version_id"]))
    if not row:
        raise HTTPException(404, "版本不存在")
    return {"memory": row}


def _range(body: dict):
    return (body["guild_id"], [str(c) for c in body.get("channel_ids") or []],
            float(body["start"]) if body.get("start") else None,
            float(body["end"]) if body.get("end") else None)


@app.post("/api/memory/count", dependencies=A)
async def memory_count(body: dict = Body(...)):
    gid, chs, start, end = _range(body)
    return await memory.count_messages(gid, chs, start, end, body.get("user_id") or None)


@app.post("/api/memory/summarize", dependencies=A)
async def memory_summarize(body: dict = Body(...)):
    gid, chs, start, end = _range(body)
    jid = memory.start_summary({"scope": body["scope"], "guild_id": gid, "user_id": body.get("user_id") or "",
                                "channel_ids": chs, "start": start, "end": end,
                                "mode": body.get("mode") or "merge"})
    return {"job_id": jid}


# ---------- 表情 ----------

@app.get("/api/emojis", dependencies=A)
async def emojis(guild_id: str = ""):
    sql = ("SELECT e.*, g.name AS guild_name, (SELECT COALESCE(SUM(count),0) FROM emoji_usage WHERE emoji_key=e.id) "
           "AS uses FROM emojis e LEFT JOIN guilds g ON g.id=e.guild_id WHERE e.available=1")
    params = []
    if guild_id:
        sql += " AND e.guild_id=?"
        params.append(guild_id)
    sql += " ORDER BY e.kind, uses DESC, e.name"
    return await db.fetchall(sql, params)


@app.post("/api/emojis/retag_all", dependencies=A)
async def emoji_retag_all(body: dict = Body(default={})):
    if body.get("guild_id"):
        await db.execute("UPDATE emojis SET description=NULL, fail=0, desc_manual=0 WHERE guild_id=?",
                         (body["guild_id"],))
    else:
        await db.execute("UPDATE emojis SET description=NULL, fail=0, desc_manual=0")
    return {"ok": True}


@app.post("/api/emojis/{eid}", dependencies=A)
async def emoji_save(eid: str, body: dict = Body(...)):
    await db.execute("UPDATE emojis SET description=?, desc_manual=1 WHERE id=?",
                     ((body.get("description") or "").strip(), eid))
    return {"ok": True}


@app.post("/api/emojis/{eid}/retag", dependencies=A)
async def emoji_retag(eid: str):
    await db.execute("UPDATE emojis SET description=NULL, fail=0, desc_manual=0 WHERE id=?", (eid,))
    return {"ok": True}


# ---------- API 供应商 / 模型 ----------

@app.get("/api/providers", dependencies=A)
async def providers():
    return {"providers": await llm.get_providers(), "models": await llm.get_models(), "purposes": llm.PURPOSES}


@app.post("/api/providers", dependencies=A)
async def save_providers(body: dict = Body(...)):
    await llm.save_providers(body.get("providers") or [])
    return {"ok": True, "providers": await llm.get_providers()}


@app.post("/api/providers/models", dependencies=A)
async def provider_models(body: dict = Body(...)):
    try:
        provider = body.get("provider") or {}
        models = await llm.list_models(provider)
        # 只有已保存、且地址/格式一致的列表才写入对应供应商。
        if provider.get("id"):
            effective = await llm._with_saved_key(provider)
            saved = next((p for p in await llm.get_providers() if p["id"] == provider["id"]), None)
            if saved and all(saved.get(k) == effective.get(k) for k in ("base_url", "format")):
                await llm.cache_model_list(provider["id"], models)
        return {"ok": True, "models": models}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e), "models": []}


@app.post("/api/providers/test", dependencies=A)
async def test_provider(body: dict = Body(...)):
    try:
        result = await llm.test_provider(body.get("provider") or {}, str(body.get("model") or ""))
        return {"ok": True, "result": result}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "result": str(e)}


@app.post("/api/models", dependencies=A)
async def save_models(body: dict = Body(...)):
    data = {}
    for purpose in llm.PURPOSES:
        m = (body.get("models") or {}).get(purpose) or {}
        data[purpose] = {
            "provider": m.get("provider") or "",
            "model": (m.get("model") or "").strip(),
            "max_tokens": int(m.get("max_tokens") or 1024),
            "temperature": float(m.get("temperature") if m.get("temperature") not in (None, "") else 0.9),
        }
    await db.set_setting("models", data)
    return {"ok": True}


# ---------- 搜索服务 ----------

@app.get("/api/search", dependencies=A)
async def get_search():
    return await tools.settings()


@app.post("/api/search", dependencies=A)
async def save_search(body: dict = Body(...)):
    try:
        await tools.save_settings(body)
    except (ValueError, TypeError) as e:
        raise HTTPException(400, str(e)) from e
    return {"ok": True, "data": await tools.settings()}


@app.post("/api/search/test", dependencies=A)
async def test_search(body: dict = Body(default={})):
    result, error = await tools.execute("web_search", {"query": body.get("query", "今天的新闻")},
                                        await tools.settings(with_key=True))
    return {"ok": not error, "result": json.loads(result)}


# ---------- 通用设置 / 私聊 / 价格 ----------

@app.get("/api/general", dependencies=A)
async def get_general():
    return {"data": await store.general(), "defaults": store.GENERAL_DEFAULTS}


@app.post("/api/general", dependencies=A)
async def save_general(body: dict = Body(...)):
    data = {k: v for k, v in (body.get("data") or {}).items() if k in store.GENERAL_DEFAULTS}
    await db.set_setting("general", data)
    return {"ok": True}


@app.get("/api/dm", dependencies=A)
async def get_dm():
    return await store.dm_settings()


@app.post("/api/dm", dependencies=A)
async def save_dm(body: dict = Body(...)):
    wl = body.get("whitelist") or []
    if isinstance(wl, str):
        wl = wl.replace(",", "\n").split()
    data = {"whitelist": [str(x).strip() for x in wl if str(x).strip().isdigit()],
            "mode": body.get("mode") if body.get("mode") in ("guild", "persona", "own") else "own",
            "guild_id": str(body.get("guild_id") or "")}
    await db.set_setting("dm", data)
    return {"ok": True}


@app.get("/api/prices", dependencies=A)
async def get_prices():
    models = await db.fetchall("SELECT DISTINCT model FROM usage ORDER BY model")
    return {"prices": await db.get_setting("prices", {}) or {}, "models": [m["model"] for m in models]}


@app.post("/api/prices", dependencies=A)
async def save_prices(body: dict = Body(...)):
    clean = {}
    for model, p in (body.get("prices") or {}).items():
        clean[model] = {k: float(p.get(k) or 0) for k in ("input", "output", "cache_read", "cache_write")}
    await db.set_setting("prices", clean)
    return {"ok": True}


# ---------- 概览 / 提示词预览 ----------

def _cost(r: dict, prices: dict) -> float:
    p = prices.get(r["model"]) or {}
    return ((r["input_tokens"] or 0) * p.get("input", 0) + (r["output_tokens"] or 0) * p.get("output", 0)
            + (r["cache_read"] or 0) * p.get("cache_read", 0)
            + (r["cache_write"] or 0) * p.get("cache_write", 0)) / 1_000_000


@app.get("/api/overview", dependencies=A)
async def overview():
    general = await store.general()
    zone = context.tz(general["timezone"])
    now = dt.datetime.now(zone)
    sod = now.replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
    prices = await db.get_setting("prices", {}) or {}

    s = manager.status()
    token = await manager.token()
    models = await llm.get_models()
    global_cfg = await store.get_scope("global", "global")

    guild_rows = await db.fetchall("SELECT * FROM guilds WHERE joined=1 ORDER BY name")
    guilds = []
    for g in guild_rows:
        today = await db.fetchone(
            "SELECT COUNT(*) AS n, SUM(is_self) AS mine, MAX(created_at) AS last FROM messages "
            "WHERE guild_id=? AND deleted=0 AND created_at>=?", (g["id"], sod))
        last = await db.fetchone("SELECT MAX(created_at) AS t FROM messages WHERE guild_id=?", (g["id"],))
        mem = await memory.get("guild", g["id"], "")
        guilds.append({
            "id": g["id"], "name": g["name"], "icon": g["icon"], "member_count": g["member_count"],
            "today": today["n"] or 0, "replies_today": today["mine"] or 0, "last_message": last["t"],
            "memory_updated": mem["updated_at"] if mem else None,
            "new_since": await memory.new_since("guild", g["id"], "", mem["summarized_until"] if mem else None),
        })

    rows = await db.fetchall("SELECT * FROM usage WHERE ts>=?", (sod - 6 * 86400,))
    days = {}
    for i in range(6, -1, -1):
        d = (now - dt.timedelta(days=i)).strftime("%m-%d")
        days[d] = {"key": d, "tokens": 0, "cost": 0.0, "calls": 0}
    today_sum = {"calls": 0, "tokens": 0, "cost": 0.0, "fails": 0}
    for r in rows:
        key = dt.datetime.fromtimestamp(r["ts"], zone).strftime("%m-%d")
        c = _cost(r, prices)
        tok = (r["input_tokens"] or 0) + (r["output_tokens"] or 0) + (r["cache_read"] or 0)
        if key in days:
            days[key]["tokens"] += tok
            days[key]["cost"] += c
            days[key]["calls"] += 1
        if r["ts"] >= sod:
            today_sum["calls"] += 1
            today_sum["tokens"] += tok
            today_sum["cost"] += c
            today_sum["fails"] += 0 if r["ok"] else 1

    errors = await db.fetchall("SELECT id, ts, logger, message FROM errors ORDER BY id DESC LIMIT 3")
    if s.get("user_id"):
        s["invite_url"] = (f"https://discord.com/oauth2/authorize?client_id={s['user_id']}"
                           f"&scope=bot&permissions={INVITE_PERMISSIONS}")
    return {
        "status": s,
        "setup": {
            "token": bool(token),
            "online": s.get("state") == "online",
            "guilds": len(guilds) > 0,
            "model": bool(models["chat"].get("provider") and models["chat"].get("model")),
            "persona": bool(global_cfg.get("persona")),
        },
        "guilds": guilds,
        "today": today_sum,
        "week": list(days.values()),
        "has_prices": bool(prices),
        "errors": errors,
    }


@app.get("/api/preview", dependencies=A)
async def preview(guild_id: str = "", channel_id: str = ""):
    """拼出 bot 下一次回复时实际发给模型的系统提示词和上下文。"""
    from . import emoji as emoji_mod
    general = await store.general()
    if not channel_id and guild_id:
        last = await db.fetchone("SELECT channel_id FROM messages WHERE guild_id=? ORDER BY created_at DESC LIMIT 1",
                                 (guild_id,))
        channel_id = last["channel_id"] if last else ""
    cfg = await store.resolve(guild_id or None, channel_id or None)
    rows = await context.load_window(channel_id, cfg) if channel_id else []
    user_ids = []
    for r in reversed(rows):
        if not r["is_self"] and r["author_id"] not in user_ids:
            user_ids.append(r["author_id"])
    emoji_text, _ = await emoji_mod.candidates(guild_id, int(general.get("emoji_candidates") or 0))
    sticker_text = (await emoji_mod.sticker_candidates(guild_id))[0] if guild_id else ""
    g = await db.fetchone("SELECT name FROM guilds WHERE id=?", (guild_id,)) if guild_id else None
    ch = await db.fetchone("SELECT name FROM channels WHERE id=?", (channel_id,)) if channel_id else None
    location = (f"服务器「{g['name']}」的 #{ch['name'] if ch else channel_id} 频道" if g
                else "（预览：未指定服务器）")
    system = await context.build_system(cfg, general, guild_id, location, user_ids[:20], emoji_text, sticker_text)
    msgs = await context.build_messages(rows, guild_id, {**cfg, "image_limit": 0}, general)
    last_user = next((r for r in reversed(rows) if not r["is_self"]), None)
    target = await context.user_tag(guild_id, last_user["author_id"]) if last_user and guild_id else ""
    context.append_note(msgs, context.request_note(general, target))
    transcript = []
    for m in msgs:
        text = "".join(p.get("text", "") for p in m["parts"] if p["type"] == "text").strip()
        transcript.append({"role": m["role"], "text": text})
    images = sum(1 for r in rows for im in json.loads(r["images"] or "[]") if im.get("kind") == "image")
    return {
        "system": system,
        "messages": transcript,
        "channel": ch["name"] if ch else "",
        "system_tokens": context.est_tokens(system),
        "context_tokens": sum(context.est_tokens(m["text"]) for m in transcript),
        "images": min(images, int(cfg.get("image_limit") or 0)),
    }


# ---------- 用量 ----------

@app.get("/api/usage", dependencies=A)
async def usage(days: int = 7):
    days = max(1, min(days, 365))
    since = time.time() - days * 86400
    rows = await db.fetchall("SELECT * FROM usage WHERE ts>=?", (since,))
    prices = await db.get_setting("prices", {}) or {}
    general = await store.general()
    zone = context.tz(general["timezone"])
    names = {g["id"]: g["name"] for g in await db.fetchall("SELECT id, name FROM guilds")}

    def blank():
        return {"calls": 0, "fails": 0, "input": 0, "output": 0, "cache_read": 0, "cache_write": 0, "cost": 0.0}

    groups = {"guild": collections.defaultdict(blank), "model": collections.defaultdict(blank),
              "purpose": collections.defaultdict(blank), "day": collections.defaultdict(blank)}
    total = blank()
    for r in rows:
        p = prices.get(r["model"]) or {}
        cost = ((r["input_tokens"] or 0) * p.get("input", 0) + (r["output_tokens"] or 0) * p.get("output", 0)
                + (r["cache_read"] or 0) * p.get("cache_read", 0)
                + (r["cache_write"] or 0) * p.get("cache_write", 0)) / 1_000_000
        keys = {
            "guild": names.get(r["guild_id"], "私聊 / 其他") if r["guild_id"] else "私聊 / 其他",
            "model": r["model"] or "?",
            "purpose": llm.PURPOSES.get(r["purpose"], r["purpose"]),
            "day": dt.datetime.fromtimestamp(r["ts"], zone).strftime("%m-%d"),
        }
        for gname, key in list(keys.items()) + [("_total", None)]:
            bucket = total if gname == "_total" else groups[gname][key]
            bucket["calls"] += 1
            bucket["fails"] += 0 if r["ok"] else 1
            bucket["input"] += r["input_tokens"] or 0
            bucket["output"] += r["output_tokens"] or 0
            bucket["cache_read"] += r["cache_read"] or 0
            bucket["cache_write"] += r["cache_write"] or 0
            bucket["cost"] += cost

    def to_list(d, sort_key=None):
        items = [{"key": k, **v} for k, v in d.items()]
        items.sort(key=sort_key or (lambda x: -(x["input"] + x["output"])))
        return items

    return {"total": total, "by_guild": to_list(groups["guild"]), "by_model": to_list(groups["model"]),
            "by_purpose": to_list(groups["purpose"]),
            "daily": to_list(groups["day"], sort_key=lambda x: x["key"])}


# ---------- 日志 ----------

@app.get("/api/logs", dependencies=A)
async def logs(after: int = 0):
    return logbuf.get_logs(after)


@app.get("/api/errors", dependencies=A)
async def errors():
    return await db.fetchall("SELECT * FROM errors ORDER BY id DESC LIMIT 200")


@app.post("/api/errors/clear", dependencies=A)
async def clear_errors():
    await db.execute("DELETE FROM errors")
    return {"ok": True}


@app.exception_handler(Exception)
async def on_error(request: Request, exc: Exception):
    log.exception("接口 %s 出错", request.url.path)
    return JSONResponse({"detail": f"服务器内部错误：{exc}"}, status_code=500)
