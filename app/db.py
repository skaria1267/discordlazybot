"""SQLite 数据库访问。"""
import json
from typing import Any

import aiosqlite

from .config import DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS scope_config (
    scope_type TEXT, scope_id TEXT, data TEXT,
    PRIMARY KEY (scope_type, scope_id));
CREATE TABLE IF NOT EXISTS guilds (
    id TEXT PRIMARY KEY, name TEXT, icon TEXT, member_count INTEGER,
    joined INTEGER DEFAULT 1, updated_at REAL);
CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY, guild_id TEXT, name TEXT, type TEXT, position INTEGER);
CREATE TABLE IF NOT EXISTS members (
    guild_id TEXT, user_id TEXT, username TEXT, global_name TEXT, nick TEXT,
    avatar TEXT, is_bot INTEGER DEFAULT 0, in_guild INTEGER DEFAULT 1, updated_at REAL,
    PRIMARY KEY (guild_id, user_id));
CREATE TABLE IF NOT EXISTS name_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT, user_id TEXT, name TEXT,
    seen_at REAL, UNIQUE (guild_id, user_id, name));
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, guild_id TEXT, channel_id TEXT, author_id TEXT,
    username TEXT, display TEXT, content TEXT, images TEXT, reply_to TEXT,
    created_at REAL, edited_at REAL, deleted INTEGER DEFAULT 0,
    is_self INTEGER DEFAULT 0, is_bot INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_msg_chan ON messages (channel_id, created_at);
CREATE INDEX IF NOT EXISTS idx_msg_guild ON messages (guild_id, created_at);
CREATE INDEX IF NOT EXISTS idx_msg_author ON messages (guild_id, author_id, created_at);
CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT, guild_id TEXT,
    user_id TEXT DEFAULT '', content TEXT, updated_at REAL,
    UNIQUE (scope, guild_id, user_id));
CREATE TABLE IF NOT EXISTS memory_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, memory_id INTEGER, content TEXT,
    note TEXT, created_at REAL);
CREATE TABLE IF NOT EXISTS emojis (
    id TEXT PRIMARY KEY, kind TEXT, guild_id TEXT, name TEXT, animated INTEGER,
    url TEXT, format TEXT, description TEXT, desc_manual INTEGER DEFAULT 0,
    fail INTEGER DEFAULT 0, available INTEGER DEFAULT 1, updated_at REAL);
CREATE TABLE IF NOT EXISTS emoji_usage (
    guild_id TEXT, emoji_key TEXT, count INTEGER DEFAULT 0,
    PRIMARY KEY (guild_id, emoji_key));
CREATE TABLE IF NOT EXISTS usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL, guild_id TEXT, provider TEXT,
    model TEXT, purpose TEXT, input_tokens INTEGER, output_tokens INTEGER,
    cache_read INTEGER, cache_write INTEGER, ok INTEGER);
CREATE INDEX IF NOT EXISTS idx_usage_ts ON usage (ts);
CREATE TABLE IF NOT EXISTS context_start (
    channel_id TEXT PRIMARY KEY, guild_id TEXT, start_ts REAL, message_id TEXT, set_at REAL);
CREATE TABLE IF NOT EXISTS errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL, logger TEXT, message TEXT, trace TEXT);
"""

_conn: aiosqlite.Connection | None = None


async def init() -> None:
    global _conn
    _conn = await aiosqlite.connect(DB_PATH)
    _conn.row_factory = aiosqlite.Row
    await _conn.execute("PRAGMA journal_mode=WAL")
    await _conn.execute("PRAGMA synchronous=NORMAL")
    await _conn.executescript(SCHEMA)
    await _conn.commit()
    # 迁移：记忆增加「已总结到」时间点
    cols = [r["name"] for r in await fetchall("PRAGMA table_info(memories)")]
    if "summarized_until" not in cols:
        await execute("ALTER TABLE memories ADD COLUMN summarized_until REAL")


async def close() -> None:
    if _conn:
        await _conn.close()


def conn() -> aiosqlite.Connection:
    assert _conn is not None, "database not initialised"
    return _conn


async def execute(sql: str, params: tuple | list = ()) -> int:
    cur = await conn().execute(sql, params)
    await conn().commit()
    return cur.lastrowid or 0


async def executemany(sql: str, rows: list) -> None:
    if not rows:
        return
    await conn().executemany(sql, rows)
    await conn().commit()


async def fetchall(sql: str, params: tuple | list = ()) -> list[dict]:
    cur = await conn().execute(sql, params)
    rows = await cur.fetchall()
    return [dict(r) for r in rows]


async def fetchone(sql: str, params: tuple | list = ()) -> dict | None:
    cur = await conn().execute(sql, params)
    row = await cur.fetchone()
    return dict(row) if row else None


async def get_setting(key: str, default: Any = None) -> Any:
    row = await fetchone("SELECT value FROM settings WHERE key=?", (key,))
    if not row:
        return default
    try:
        return json.loads(row["value"])
    except (TypeError, ValueError):
        return default


async def set_setting(key: str, value: Any) -> None:
    await execute(
        "INSERT INTO settings (key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, json.dumps(value, ensure_ascii=False)),
    )
