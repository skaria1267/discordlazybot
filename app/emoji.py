"""表情与贴纸：同步、自动打标、使用频率、候选列表。"""
import asyncio
import base64
import io
import logging
import re
import time

from PIL import Image

from . import db, llm

log = logging.getLogger("emoji")

CUSTOM_EMOJI_RE = re.compile(r"<a?:(\w+):(\d+)>")


async def sync_guild(guild) -> None:
    """同步一个服务器的表情和贴纸；新增或改名的表情会重新打标。"""
    gid = str(guild.id)
    now = time.time()
    seen = []
    for e in guild.emojis:
        eid = str(e.id)
        seen.append(eid)
        old = await db.fetchone("SELECT name, desc_manual FROM emojis WHERE id=?", (eid,))
        url = str(e.url)
        if not old:
            await db.execute(
                "INSERT INTO emojis (id, kind, guild_id, name, animated, url, format, available, updated_at) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                (eid, "emoji", gid, e.name, int(e.animated), url, "gif" if e.animated else "png",
                 int(getattr(e, "available", True)), now))
        else:
            reset = old["name"] != e.name and not old["desc_manual"]
            await db.execute(
                "UPDATE emojis SET name=?, url=?, animated=?, available=?, updated_at=?"
                + (", description=NULL, fail=0" if reset else "") + " WHERE id=?",
                (e.name, url, int(e.animated), int(getattr(e, "available", True)), now, eid))
    for s in getattr(guild, "stickers", []):
        sid = str(s.id)
        fmt = str(getattr(s.format, "name", s.format)).lower()
        if fmt == "lottie":
            continue
        seen.append(sid)
        old = await db.fetchone("SELECT name, desc_manual FROM emojis WHERE id=?", (sid,))
        if not old:
            await db.execute(
                "INSERT INTO emojis (id, kind, guild_id, name, animated, url, format, available, updated_at) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                (sid, "sticker", gid, s.name, int(fmt in ("apng", "gif")), str(s.url), fmt,
                 int(getattr(s, "available", True)), now))
        else:
            reset = old["name"] != s.name and not old["desc_manual"]
            await db.execute(
                "UPDATE emojis SET name=?, url=?, format=?, updated_at=?"
                + (", description=NULL, fail=0" if reset else "") + " WHERE id=?",
                (s.name, str(s.url), fmt, now, sid))
    if seen:
        marks = ",".join("?" * len(seen))
        await db.execute(f"UPDATE emojis SET available=0 WHERE guild_id=? AND id NOT IN ({marks})", [gid, *seen])
    else:
        await db.execute("UPDATE emojis SET available=0 WHERE guild_id=?", (gid,))


async def mark_guild_left(guild_id: str) -> None:
    await db.execute("UPDATE emojis SET available=0 WHERE guild_id=?", (guild_id,))


async def count_usage(guild_id: str, keys: list[str]) -> None:
    for k in keys:
        await db.execute(
            "INSERT INTO emoji_usage (guild_id, emoji_key, count) VALUES (?, ?, 1) "
            "ON CONFLICT(guild_id, emoji_key) DO UPDATE SET count=count+1", (guild_id, k))


def keys_in_text(text: str) -> list[str]:
    return [m.group(2) for m in CUSTOM_EMOJI_RE.finditer(text or "")]


async def candidates(guild_id: str, limit: int) -> tuple[str, dict]:
    """返回 (给模型看的列表文本, 代码→表情信息)。优先本服务器常用的表情。"""
    rows = await db.fetchall(
        "SELECT e.id, e.name, e.description, e.animated, e.guild_id, COALESCE(u.count, 0) AS cnt "
        "FROM emojis e LEFT JOIN emoji_usage u ON u.emoji_key=e.id AND u.guild_id=? "
        "WHERE e.kind='emoji' AND e.available=1 "
        "ORDER BY cnt DESC, (e.guild_id=?) DESC, (e.description IS NOT NULL) DESC, e.name LIMIT ?",
        (guild_id, guild_id, max(0, limit)))
    mapping, lines = {}, []
    for i, r in enumerate(rows, 1):
        code = f"e{i}"
        mapping[code] = r
        desc = r["description"] or f"（名称：{r['name']}）"
        lines.append(f"{code} | {desc}")
    return "\n".join(lines), mapping


async def sticker_candidates(guild_id: str, limit: int = 20) -> tuple[str, dict]:
    rows = await db.fetchall(
        "SELECT id, name, description FROM emojis WHERE kind='sticker' AND available=1 AND guild_id=? "
        "ORDER BY name LIMIT ?", (guild_id, limit))
    mapping, lines = {}, []
    for i, r in enumerate(rows, 1):
        code = f"s{i}"
        mapping[code] = r
        lines.append(f"{code} | {r['description'] or '（名称：' + r['name'] + '）'}")
    return "\n".join(lines), mapping


def _frames_to_png(raw: bytes) -> bytes:
    img = Image.open(io.BytesIO(raw))
    n = getattr(img, "n_frames", 1)
    idxs = sorted({0, n // 2, max(0, n - 1)}) if n > 1 else [0]
    frames = []
    for i in idxs:
        img.seek(i)
        f = img.convert("RGBA")
        bg = Image.new("RGB", f.size, (255, 255, 255))
        bg.paste(f, mask=f.split()[-1])
        bg.thumbnail((256, 256))
        frames.append(bg)
    w = sum(f.width for f in frames) + 8 * (len(frames) - 1)
    h = max(f.height for f in frames)
    sheet = Image.new("RGB", (w, h), (255, 255, 255))
    x = 0
    for f in frames:
        sheet.paste(f, (x, 0))
        x += f.width + 8
    buf = io.BytesIO()
    sheet.save(buf, "PNG")
    return buf.getvalue()


async def tag_one(row: dict) -> str:
    url = row["url"]
    if row["kind"] == "emoji" and row["animated"]:
        url = url.split("?")[0].rsplit(".", 1)[0] + ".gif"
    r = await llm.client().get(url, timeout=30)
    r.raise_for_status()
    png = await asyncio.to_thread(_frames_to_png, r.content)
    multi = row["animated"]
    kind = "贴纸" if row["kind"] == "sticker" else "表情"
    prompt = (f"这是 Discord 上的一个自定义{kind}，名称是「{row['name']}」。"
              + ("图片是动图的几帧，从左到右依次播放。" if multi else "")
              + f"请用一句中文描述它的画面和适合在什么情绪或场合下使用，不超过 40 字。只输出这一句话。")
    text = await llm.call("tagging", "", [{"role": "user", "parts": [
        {"type": "image", "media_type": "image/png", "data": base64.b64encode(png).decode()},
        {"type": "text", "text": prompt}]}], guild_id=row["guild_id"], max_tokens=200)
    return text.strip().strip("「」\"'")[:120]


async def tagger_loop() -> None:
    while True:
        await asyncio.sleep(20)
        try:
            models = await llm.get_models()
            if not (models["tagging"].get("provider") and models["tagging"].get("model")):
                continue
            rows = await db.fetchall(
                "SELECT * FROM emojis WHERE description IS NULL AND available=1 AND fail<3 LIMIT 5")
            for row in rows:
                try:
                    desc = await tag_one(row)
                    await db.execute("UPDATE emojis SET description=?, fail=0 WHERE id=?", (desc, row["id"]))
                    log.info("表情打标：%s → %s", row["name"], desc)
                except Exception as e:  # noqa: BLE001
                    await db.execute("UPDATE emojis SET fail=fail+1 WHERE id=?", (row["id"],))
                    log.warning("表情 %s 打标失败：%s", row["name"], e)
                await asyncio.sleep(1)
        except Exception:  # noqa: BLE001
            log.exception("打标循环出错")
