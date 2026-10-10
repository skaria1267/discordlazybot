"""上下文构建：身份标签、时间戳、消息合并、图片、系统提示词。"""
import asyncio
import base64
import collections
import datetime as dt
import io
import json
import logging
import re
import time
from zoneinfo import ZoneInfo

from PIL import Image

from . import db, llm, store

log = logging.getLogger("context")

DM_GUILD = "dm"


# ---------- 身份 ----------

async def member_row(guild_id: str, user_id: str) -> dict | None:
    return await db.fetchone("SELECT * FROM members WHERE guild_id=? AND user_id=?", (guild_id, user_id))


def _clean(s: str | None) -> str:
    return (s or "").replace("[", "(").replace("]", ")").strip()


async def user_tag(guild_id: str, user_id: str, username: str = "", display: str = "") -> str:
    """[服务器昵称-用户名-用户ID]。"""
    row = await member_row(guild_id, user_id)
    if row:
        username = row["username"] or username
        display = row["nick"] or row["global_name"] or display or username
    display = display or username
    return f"[{_clean(display)}-{_clean(username)}-{user_id}]"


async def former_names(guild_id: str, user_id: str, current: str = "") -> list[str]:
    rows = await db.fetchall(
        "SELECT name FROM name_history WHERE guild_id=? AND user_id=? ORDER BY seen_at", (guild_id, user_id))
    names = []
    for r in rows:
        n = r["name"]
        if n and n != current and n not in names:
            names.append(n)
    return names[-8:]


async def tag_with_history(guild_id: str, user_id: str) -> str:
    row = await member_row(guild_id, user_id)
    tag = await user_tag(guild_id, user_id)
    current = ""
    if row:
        current = row["nick"] or row["global_name"] or row["username"] or ""
    olds = [n for n in await former_names(guild_id, user_id, current)
            if row is None or n not in (row["username"], row["nick"], row["global_name"])]
    return tag + (f"（曾用名：{'、'.join(olds)}）" if olds else "")


# ---------- 时间 ----------

def tz(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except Exception:  # noqa: BLE001
        return ZoneInfo("Asia/Shanghai")


def fmt_time(ts: float, zone: ZoneInfo) -> str:
    return dt.datetime.fromtimestamp(ts, zone).strftime("%Y-%m-%d %H:%M")


def fmt_gap(seconds: float) -> str:
    m = int(seconds // 60)
    if m < 60:
        return f"{m} 分钟"
    h = m // 60
    if h < 24:
        return f"{h} 小时" + (f" {m % 60} 分钟" if m % 60 and h < 3 else "")
    return f"{h // 24} 天"


def est_tokens(text: str) -> int:
    cjk = len(re.findall(r"[　-鿿＀-￯]", text))
    return cjk + (len(text) - cjk) // 4 + 4


# ---------- 图片 ----------

_img_cache: collections.OrderedDict = collections.OrderedDict()
_emoji_img_cache: collections.OrderedDict = collections.OrderedDict()
EMOJI_CDN = "https://cdn.discordapp.com/emojis/{}.png?size=96"


async def fetch_image(url: str, max_side: int = 1024, cache: collections.OrderedDict = _img_cache,
                      cache_size: int = 64) -> dict | None:
    if url in cache:
        cache.move_to_end(url)
        return cache[url]
    try:
        r = await llm.client().get(url, timeout=30)
        if r.status_code != 200:
            return None
        img = Image.open(io.BytesIO(r.content))
        img.seek(0)
        img = img.convert("RGBA")
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[-1])
        bg.thumbnail((max_side, max_side))
        buf = io.BytesIO()
        bg.save(buf, "JPEG", quality=85)
        item = {"type": "image", "media_type": "image/jpeg", "data": base64.b64encode(buf.getvalue()).decode()}
    except Exception as e:  # noqa: BLE001
        log.warning("下载图片失败 %s: %s", url[:80], e)
        return None
    cache[url] = item
    while len(cache) > cache_size:
        cache.popitem(last=False)
    return item


async def fetch_emoji_image(emoji_id: str) -> dict | None:
    # 表情图很小，单独缓存更多张，避免和普通图片互相挤掉；动图表情取 png 就是第一帧
    return await fetch_image(EMOJI_CDN.format(emoji_id), max_side=96, cache=_emoji_img_cache, cache_size=1000)


# ---------- 消息格式化 ----------

async def format_line(row: dict, zone: ZoneInfo, guild_id: str, with_reply: bool = True) -> str:
    tag = await user_tag(guild_id, row["author_id"], row["username"], row["display"])
    text = row["content"] or ""
    images = json.loads(row["images"] or "[]")
    extras = []
    for im in images:
        if im.get("kind") != "emoji":
            extras.append(f"[{im.get('label') or '图片'}]")
    reply = ""
    if with_reply and row.get("reply_to"):
        ref = await db.fetchone("SELECT * FROM messages WHERE id=?", (row["reply_to"],))
        if ref:
            rtag = "你" if ref["is_self"] else await user_tag(guild_id, ref["author_id"], ref["username"], ref["display"])
            snippet = (ref["content"] or "").replace("\n", " ")[:60]
            reply = f"（回复 {rtag}：{snippet}）"
    edited = "（已编辑）" if row.get("edited_at") else ""
    body = " ".join(x for x in [reply + text, " ".join(extras)] if x).strip()
    return f"[{fmt_time(row['created_at'], zone)}] {tag}: {body}{edited}"


# ---------- 上下文起点 ----------

DISCORD_EPOCH_MS = 1420070400000
CUSTOM_EMOJI_RE = re.compile(r"<a?:(\w+):\d+>")
EMOJI_NAME_RE = re.compile(r":(\w+):")
LINK_RE = re.compile(r"channels/(\d+|@me)/(\d+)/(\d+)")


def snowflake_ts(sid: str | int) -> float:
    """Discord 消息 ID 里自带发送时间。"""
    return ((int(sid) >> 22) + DISCORD_EPOCH_MS) / 1000


def parse_message_ref(text: str) -> tuple[str | None, str]:
    """接受消息 ID 或消息链接，返回 (频道ID 或 None, 消息ID)。"""
    text = (text or "").strip()
    m = LINK_RE.search(text)
    if m:
        return m.group(2), m.group(3)
    if re.fullmatch(r"\d{15,22}", text):
        return None, text
    raise ValueError("请填写消息 ID（一串数字）或消息链接")


async def context_start(channel_id: str) -> float | None:
    row = await db.fetchone("SELECT start_ts FROM context_start WHERE channel_id=?", (channel_id,))
    return row["start_ts"] if row else None


async def set_context_start(channel_id: str, guild_id: str, start_ts: float, message_id: str = "") -> None:
    await db.execute(
        "INSERT INTO context_start (channel_id, guild_id, start_ts, message_id, set_at) VALUES (?,?,?,?,?) "
        "ON CONFLICT(channel_id) DO UPDATE SET guild_id=excluded.guild_id, start_ts=excluded.start_ts, "
        "message_id=excluded.message_id, set_at=excluded.set_at",
        (channel_id, guild_id, start_ts, message_id, time.time()))


async def clear_context_start(channel_id: str) -> None:
    await db.execute("DELETE FROM context_start WHERE channel_id=?", (channel_id,))


IMAGE_TOKENS = 1000  # 一张图片大致占用的 token 数，只用于估算上下文长度


async def load_window(channel_id: str, cfg: dict) -> list[dict]:
    size = max(1, int(cfg.get("context_size") or 40))
    start = await context_start(channel_id)
    since = "AND created_at>=? " if start else ""
    sp = (start,) if start else ()
    if cfg.get("context_mode") == "tokens":
        # 从新往旧分批读，直到 token 预算用完或读到起点，不设固定条数上限
        image_left = max(0, int(cfg.get("image_limit") or 0))
        picked, total, before, full = [], 0, float("inf"), False
        while not full:
            rows = await db.fetchall(
                f"SELECT * FROM messages WHERE channel_id=? AND deleted=0 {since}AND created_at<? "
                "ORDER BY created_at DESC LIMIT 500", (channel_id, *sp, before))
            for r in rows:
                t = est_tokens(r["content"] or "") + 20
                if image_left and not r["is_self"]:
                    n = sum(1 for im in json.loads(r["images"] or "[]")
                            if im.get("url") and im.get("kind", "image") == "image")
                    t += min(n, image_left) * IMAGE_TOKENS
                    image_left -= min(n, image_left)
                if picked and total + t > size:
                    full = True
                    break
                picked.append(r)
                total += t
            if len(rows) < 500:
                break
            before = rows[-1]["created_at"]
        rows = picked
    else:
        rows = await db.fetchall(
            f"SELECT * FROM messages WHERE channel_id=? AND deleted=0 {since}ORDER BY created_at DESC LIMIT ?",
            (channel_id, *sp, size))
    rows.reverse()
    return rows


def image_slots(rows: list[dict], image_limit: int) -> set[tuple[str, int]]:
    """最近 image_limit 张群友发的图片，返回 (消息ID, 第几张)。"""
    slots: set[tuple[str, int]] = set()
    for r in reversed(rows):
        if len(slots) >= image_limit:
            break
        if r["is_self"]:
            continue
        ims = json.loads(r["images"] or "[]")
        for i in range(len(ims) - 1, -1, -1):
            if ims[i].get("url") and ims[i].get("kind", "image") == "image" and len(slots) < image_limit:
                slots.add((r["id"], i))
    return slots


async def emoji_id_by_name(name: str, guild_id: str, cache: dict) -> str | None:
    if name not in cache:
        row = await db.fetchone(
            "SELECT id FROM emojis WHERE kind='emoji' AND name=? ORDER BY (guild_id=?) DESC, available DESC LIMIT 1",
            (name, guild_id))
        cache[name] = row["id"] if row else None
    return cache[name]


async def split_emojis(text: str, row: dict, guild_id: str, state: dict) -> list[dict]:
    """把一行文字里的 :名称: 后面接上表情图片。

    同一个表情一次请求里只在第一次出现时附图；从旧到新挑，上下文只往后追加时前面不变，不破坏缓存。
    图片先用占位 {"type": "emoji_ref"} 表示，最后统一下载。
    """
    known = {im["name"]: im["id"] for im in json.loads(row["images"] or "[]")
             if im.get("kind") == "emoji" and im.get("id")}
    parts, pos = [], 0
    for m in EMOJI_NAME_RE.finditer(text):
        eid = known.get(m.group(1)) or await emoji_id_by_name(m.group(1), guild_id, state["names"])
        if not eid or eid in state["shown"]:
            continue
        if state["limit"] and len(state["shown"]) >= state["limit"]:
            break
        state["shown"].add(eid)
        parts.append({"type": "text", "text": text[pos:m.end()]})
        parts.append({"type": "emoji_ref", "id": eid})
        pos = m.end()
    parts.append({"type": "text", "text": text[pos:]})
    return parts


async def build_messages(rows: list[dict], guild_id: str, cfg: dict, general: dict) -> list[dict]:
    zone = tz(general["timezone"])
    gap_s = float(general.get("gap_minutes") or 30) * 60
    img_slots = image_slots(rows, max(0, int(cfg.get("image_limit") or 0)))
    emoji_state = {"shown": set(), "names": {}, "limit": max(0, int(cfg.get("emoji_image_limit") or 0))}
    emoji_images = bool(cfg.get("emoji_images", True))

    out: list[dict] = []
    prev_ts = None
    for r in rows:
        if r["is_self"]:
            # 自己发过的自定义表情显示成 :名称:，和群友消息、可用表情列表的写法一致
            text = CUSTOM_EMOJI_RE.sub(lambda m: f":{m.group(1)}:", r["content"] or "")
            out.append({"role": "assistant", "parts": [{"type": "text", "text": text}]})
            prev_ts = r["created_at"]
            continue
        line = await format_line(r, zone, guild_id)
        if prev_ts and r["created_at"] - prev_ts > gap_s:
            line = f"（距上一条消息 {fmt_gap(r['created_at'] - prev_ts)}）\n" + line
        prev_ts = r["created_at"]
        if emoji_images:
            parts = await split_emojis(line + "\n", r, guild_id, emoji_state)
        else:
            parts = [{"type": "text", "text": line + "\n"}]
        ims = json.loads(r["images"] or "[]")
        for i, im in enumerate(ims):
            if (r["id"], i) in img_slots:
                data = await fetch_image(im["url"])
                if data:
                    parts.append(data)
        if out and out[-1]["role"] == "user":
            out[-1]["parts"].extend(parts)
        else:
            out.append({"role": "user", "parts": parts})
    if emoji_state["shown"]:
        ids = sorted(emoji_state["shown"])
        got = dict(zip(ids, await asyncio.gather(*(fetch_emoji_image(i) for i in ids))))
        for m in out:
            m["parts"] = [got[p["id"]] if p["type"] == "emoji_ref" else p
                          for p in m["parts"] if p["type"] != "emoji_ref" or got.get(p["id"])]
    return out


async def memory_block(guild_id: str, user_ids: list[str], dm_user: str | None = None,
                       dm_own: bool = False) -> str:
    parts = []
    if dm_own and dm_user:
        row = await db.fetchone("SELECT content FROM memories WHERE scope='dm' AND guild_id=? AND user_id=?",
                                (DM_GUILD, dm_user))
        if row and row["content"].strip():
            parts.append("【私聊记忆】\n" + row["content"].strip())
        return "\n\n".join(parts)
    row = await db.fetchone("SELECT content FROM memories WHERE scope='guild' AND guild_id=? AND user_id=''",
                            (guild_id,))
    if row and row["content"].strip():
        parts.append("【服务器记忆】\n" + row["content"].strip())
    user_lines = []
    # 按用户 ID 固定排序，避免谁最近说话导致顺序变化、破坏提示词缓存
    for uid in sorted(set(user_ids), key=lambda x: int(x) if str(x).isdigit() else 0):
        r = await db.fetchone("SELECT content FROM memories WHERE scope='user' AND guild_id=? AND user_id=?",
                              (guild_id, uid))
        if r and r["content"].strip():
            user_lines.append(f"{await tag_with_history(guild_id, uid)}：\n{r['content'].strip()}")
    if user_lines:
        parts.append("【群友记忆】（以 [服务器昵称-用户名-用户ID] 区分，用户ID 相同才是同一个人）\n"
                     + "\n\n".join(user_lines))
    return "\n\n".join(parts)


def format_rules(has_emojis: bool, has_stickers: bool, max_reactions: int) -> str:
    lines = [
        "【输出格式】",
        "把要发送的话写在 <reply></reply> 里。",
    ]
    if has_emojis:
        lines.append("回复里想用自定义表情时直接写 :名称:，名称取自【可用表情】，发送时会自动变成表情；"
                     "可以夹在文字里，也可以单独发。看场合自然地用，不要每句都加，也不要编造列表里没有的名称。")
    if max_reactions > 0:
        lines.append(f"如果想给对方的消息点表情反应，写 <react>表情</react>，最多 {max_reactions} 个；"
                     + ("可以写【可用表情】里的 :名称:，也可以直接写一个 Unicode emoji。" if has_emojis
                        else "直接写一个 Unicode emoji。"))
    if has_stickers:
        lines.append("想发贴纸时写 <sticker>代码</sticker>，代码取自【可用贴纸】，最多 1 个。")
    lines.append("只想点反应不想说话时可以省略 <reply>。")
    lines.append("回复里不要带 [昵称-用户名-ID] 这样的标签，也不要模仿聊天记录的时间戳格式，称呼别人直接用昵称。")
    return "\n".join(lines)


async def build_system(cfg: dict, general: dict, guild_id: str, location: str, user_ids: list[str],
                       emoji_text: str, sticker_text: str, dm_user: str | None = None,
                       dm_mode: str | None = None) -> str:
    # 系统提示词里只放稳定的内容；当前时间等每次都变的信息由 request_note() 放到最后一条消息末尾。
    # 越不容易变的越靠前：表情列表和格式说明基本不变，放在记忆前面，记忆更新时前面的部分仍能命中缓存
    sections = [cfg.get("persona") or ""]
    sections.append(f"【当前位置】{location}")
    sections.append("【身份说明】聊天记录里每位群友以 [服务器昵称-用户名-用户ID] 标识，用户ID 唯一不变，"
                    "昵称可能会变。多条连续的群友消息会合并在一起，你自己说过的话是 assistant 消息。"
                    + ("群友消息里的自定义表情写作 :名称:，后面紧跟着这个表情的图片；同一个表情只在第一次出现时附图。"
                       if cfg.get("emoji_images", True) else ""))
    if emoji_text:
        sections.append("【可用表情】（:名称: | 描述）\n" + emoji_text)
    if sticker_text:
        sections.append("【可用贴纸】（代码 | 描述）\n" + sticker_text)
    sections.append(format_rules(bool(emoji_text), bool(sticker_text), int(general.get("max_reactions") or 0)))
    use_memory = cfg.get("memory_enabled", True) and dm_mode != "persona"
    if use_memory:
        mem = await memory_block(guild_id, user_ids, dm_user=dm_user, dm_own=(dm_mode == "own"))
        if mem:
            sections.append(mem)
    return "\n\n".join(s for s in sections if s)


async def reply_image_parts(ref: dict, images: list[dict], guild_id: str, limit: int,
                            skip: set[int] = frozenset()) -> list[dict]:
    """触发这次回复的消息所引用的那条消息里的图片，附在最后一条消息末尾，不占普通图片名额。

    ref 至少包含 author_id / is_self / username / display；skip 是已经作为普通图片放进上下文的序号。
    """
    picked = []
    for i, im in enumerate(images):
        if len(picked) >= limit:
            break
        if i in skip or not im.get("url") or im.get("kind", "image") != "image":
            continue
        data = await fetch_image(im["url"])
        if data:
            picked.append(data)
    if not picked:
        return []
    who = "你自己" if ref["is_self"] else await user_tag(guild_id, ref["author_id"], ref["username"], ref["display"])
    return [{"type": "text", "text": f"\n（这次的消息回复了 {who} 的一条消息，那条消息里的图片如下：）\n"}, *picked]


def request_note(general: dict, target_tag: str = "", interject: bool = False) -> str:
    """每次请求都会变的信息（当前时间、这次回应谁），放在最后一条用户消息末尾，不影响前面的缓存。"""
    zone = tz(general["timezone"])
    now = dt.datetime.now(zone)
    week = "一二三四五六日"[now.weekday()]
    parts = [f"现在是 {now.strftime('%Y-%m-%d %H:%M')} 星期{week}（{general['timezone']}）。"]
    if interject:
        parts.append("这次没有人直接叫你，是你自己决定加入聊天，自然地接话即可。")
    elif target_tag:
        parts.append(f"这次需要你回应的是 {target_tag} 的最新消息。")
    return "（系统提示：" + "".join(parts) + "）"


def append_parts(messages: list[dict], parts: list[dict]) -> list[dict]:
    if messages and messages[-1]["role"] == "user":
        messages[-1]["parts"].extend(parts)
    else:
        messages.append({"role": "user", "parts": list(parts)})
    return messages


def append_note(messages: list[dict], note: str) -> list[dict]:
    if messages and messages[-1]["role"] == "user":
        messages[-1]["parts"].append({"type": "text", "text": "\n" + note})
    else:
        messages.append({"role": "user", "parts": [{"type": "text", "text": note}]})
    return messages


def parse_output(text: str) -> dict:
    reply_parts = re.findall(r"<reply>(.*?)</reply>", text, flags=re.S)
    reacts = [x.strip() for x in re.findall(r"<react>(.*?)</react>", text, flags=re.S) if x.strip()]
    stickers = [x.strip() for x in re.findall(r"<sticker>(.*?)</sticker>", text, flags=re.S) if x.strip()]
    if reply_parts:
        reply = "\n".join(p.strip() for p in reply_parts).strip()
    else:
        reply = re.sub(r"<(react|sticker)>.*?</\1>", "", text, flags=re.S)
        reply = re.sub(r"</?reply>", "", reply).strip()
    # 去掉模型误加的身份标签前缀
    reply = re.sub(r"^\s*(\[[^\]]*\]\s*)+[:：]\s*", "", reply)
    return {"reply": reply, "reacts": reacts, "stickers": stickers}
