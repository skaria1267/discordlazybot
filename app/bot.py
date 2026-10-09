"""Discord bot：消息存储、频道队列与防抖、回复、主动插话、表情反应、私聊、同步。"""
import asyncio
import collections
import json
import logging
import random
import re
import time

import discord

from . import context, crypto, db, emoji, llm, store

log = logging.getLogger("bot")
DM = context.DM_GUILD

USER_MENTION = re.compile(r"<@!?(\d+)>")
ROLE_MENTION = re.compile(r"<@&(\d+)>")
CHANNEL_MENTION = re.compile(r"<#(\d+)>")
CUSTOM_EMOJI = re.compile(r"<a?:(\w+):\d+>")
UNICODE_EMOJI_HINT = re.compile(r"^[^\w\s<>]{1,8}$")


def split_text(text: str, limit: int = 1900) -> list[str]:
    text = text.strip()
    if len(text) <= limit:
        return [text] if text else []
    out = []
    while len(text) > limit:
        cut = text.rfind("\n", 0, limit)
        if cut < limit // 2:
            cut = text.rfind(" ", 0, limit)
        if cut < limit // 2:
            cut = limit
        out.append(text[:cut].strip())
        text = text[cut:].strip()
    if text:
        out.append(text)
    return [x for x in out if x]


class ChannelQueue:
    """每个频道一个队列：等消息安静 N 秒后合并处理，同一频道同时只处理一批。"""

    def __init__(self, bot: "LazyBot", channel_id: int):
        self.bot = bot
        self.channel_id = channel_id
        self.pending: list[discord.Message] = []
        self.last = 0.0
        self.runner: asyncio.Task | None = None
        self.busy = False

    def push(self, msg: discord.Message) -> None:
        self.pending.append(msg)
        self.last = time.monotonic()
        if not self.runner or self.runner.done():
            self.runner = asyncio.create_task(self.run())

    async def run(self) -> None:
        while True:
            debounce = float((await store.general()).get("debounce_seconds") or 0)
            while time.monotonic() - self.last < debounce:
                await asyncio.sleep(0.3)
            if not self.pending:
                return
            batch, self.pending = self.pending, []
            self.busy = True
            try:
                await self.bot.process_batch(batch)
            except Exception:  # noqa: BLE001
                log.exception("处理频道 %s 的消息时出错", self.channel_id)
            finally:
                self.busy = False
            if not self.pending:
                return


class LazyBot(discord.Client):
    def __init__(self):
        intents = discord.Intents.default()
        intents.message_content = True
        intents.members = True
        super().__init__(intents=intents, max_messages=1000, chunk_guilds_at_startup=False)
        self.queues: dict[int, ChannelQueue] = {}
        self.interject_log: dict[str, collections.deque] = collections.defaultdict(collections.deque)
        self.synced_once = False
        self.connected_at: float | None = None

    # ---------- 同步 ----------

    async def on_ready(self):
        self.connected_at = time.time()
        log.info("已登录：%s（ID %s），加入了 %d 个服务器", self.user, self.user.id, len(self.guilds))
        if not self.synced_once:
            self.synced_once = True
            asyncio.create_task(self.initial_sync())

    async def initial_sync(self):
        try:
            ids = []
            for g in self.guilds:
                ids.append(str(g.id))
                await self.sync_guild(g)
            if ids:
                await db.execute(f"UPDATE guilds SET joined=0 WHERE id NOT IN ({','.join('?' * len(ids))})", ids)
            else:
                await db.execute("UPDATE guilds SET joined=0")
            await self.backfill()
            for g in self.guilds:
                await self.sync_members(g)
            log.info("初始同步完成")
        except Exception:  # noqa: BLE001
            log.exception("初始同步失败")

    async def sync_guild(self, g: discord.Guild) -> None:
        await db.execute(
            "INSERT INTO guilds (id, name, icon, member_count, joined, updated_at) VALUES (?,?,?,?,1,?) "
            "ON CONFLICT(id) DO UPDATE SET name=excluded.name, icon=excluded.icon, "
            "member_count=excluded.member_count, joined=1, updated_at=excluded.updated_at",
            (str(g.id), g.name, str(g.icon.url) if g.icon else "", g.member_count or 0, time.time()))
        await self.sync_channels(g)
        await emoji.sync_guild(g)

    async def sync_channels(self, g: discord.Guild) -> None:
        await db.execute("DELETE FROM channels WHERE guild_id=?", (str(g.id),))
        rows = []
        for ch in g.channels:
            if isinstance(ch, (discord.TextChannel, discord.VoiceChannel, discord.StageChannel,
                               discord.ForumChannel)):
                rows.append((str(ch.id), str(g.id), ch.name, str(ch.type), ch.position))
        await db.executemany("INSERT OR REPLACE INTO channels (id, guild_id, name, type, position) "
                             "VALUES (?,?,?,?,?)", rows)

    async def sync_members(self, g: discord.Guild) -> None:
        try:
            if not g.chunked:
                await g.chunk(cache=True)
        except Exception as e:  # noqa: BLE001
            log.warning("拉取 %s 的成员失败（检查 Server Members Intent）：%s", g.name, e)
        rows, hist = [], []
        now = time.time()
        for m in g.members:
            rows.append((str(g.id), str(m.id), m.name, m.global_name, m.nick,
                         str(m.display_avatar.url), int(m.bot), now))
            for n in {m.nick, m.global_name, m.name}:
                if n:
                    hist.append((str(g.id), str(m.id), n, now))
        await db.execute("UPDATE members SET in_guild=0 WHERE guild_id=?", (str(g.id),))
        await db.executemany(
            "INSERT INTO members (guild_id, user_id, username, global_name, nick, avatar, is_bot, in_guild, "
            "updated_at) VALUES (?,?,?,?,?,?,?,1,?) ON CONFLICT(guild_id, user_id) DO UPDATE SET "
            "username=excluded.username, global_name=excluded.global_name, nick=excluded.nick, "
            "avatar=excluded.avatar, is_bot=excluded.is_bot, in_guild=1, updated_at=excluded.updated_at", rows)
        await db.executemany("INSERT OR IGNORE INTO name_history (guild_id, user_id, name, seen_at) "
                             "VALUES (?,?,?,?)", hist)

    async def upsert_member(self, guild_id: str, user, in_guild: bool = True) -> None:
        nick = getattr(user, "nick", None)
        avatar = str(user.display_avatar.url) if getattr(user, "display_avatar", None) else ""
        now = time.time()
        await db.execute(
            "INSERT INTO members (guild_id, user_id, username, global_name, nick, avatar, is_bot, in_guild, "
            "updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(guild_id, user_id) DO UPDATE SET "
            "username=excluded.username, global_name=excluded.global_name, nick=excluded.nick, "
            "avatar=excluded.avatar, is_bot=excluded.is_bot, in_guild=excluded.in_guild, "
            "updated_at=excluded.updated_at",
            (guild_id, str(user.id), user.name, user.global_name, nick, avatar, int(user.bot),
             int(in_guild), now))
        for n in {nick, user.global_name, user.name}:
            if n:
                await db.execute("INSERT OR IGNORE INTO name_history (guild_id, user_id, name, seen_at) "
                                 "VALUES (?,?,?,?)", (guild_id, str(user.id), n, now))

    async def backfill(self) -> None:
        """补拉离线期间漏掉的消息。"""
        rows = await db.fetchall(
            "SELECT channel_id, MAX(CAST(id AS INTEGER)) AS last FROM messages "
            "WHERE guild_id!=? GROUP BY channel_id", (DM,))
        total = 0
        for r in rows:
            ch = self.get_channel(int(r["channel_id"]))
            if ch is None or not hasattr(ch, "history"):
                continue
            try:
                async for m in ch.history(after=discord.Object(id=int(r["last"])), limit=300, oldest_first=True):
                    await self.store_message(m)
                    total += 1
            except discord.Forbidden:
                continue
            except Exception as e:  # noqa: BLE001
                log.warning("补拉频道 %s 失败：%s", r["channel_id"], e)
        if total:
            log.info("补拉了 %d 条离线期间的消息", total)

    async def import_history(self, channel_id: int, limit: int, job: dict) -> None:
        ch = self.get_channel(channel_id)
        if ch is None or not hasattr(ch, "history"):
            raise ValueError("找不到这个频道，或 bot 没有权限")
        first = await db.fetchone("SELECT MIN(CAST(id AS INTEGER)) AS first FROM messages WHERE channel_id=?",
                                  (str(channel_id),))
        before = discord.Object(id=int(first["first"])) if first and first["first"] else None
        job["total"] = limit
        n = 0
        async for m in ch.history(limit=limit, before=before):
            await self.store_message(m)
            n += 1
            job["progress"] = n
        job["result"] = f"导入了 {n} 条消息"

    # ---------- 消息存储 ----------

    async def render(self, content: str, guild_id: str) -> str:
        """把 <@id> <#id> <:emoji:id> 转成可读文字。"""
        if not content:
            return ""

        async def user_name(m):
            uid = m.group(1)
            if self.user and uid == str(self.user.id):
                return "@你"
            row = await context.member_row(guild_id, uid)
            if row:
                return "@" + (row["nick"] or row["global_name"] or row["username"])
            u = self.get_user(int(uid))
            return "@" + (u.display_name if u else uid)

        out, pos = [], 0
        for m in USER_MENTION.finditer(content):
            out.append(content[pos:m.start()])
            out.append(await user_name(m))
            pos = m.end()
        out.append(content[pos:])
        text = "".join(out)

        def channel_name(m):
            ch = self.get_channel(int(m.group(1)))
            return "#" + (ch.name if ch and hasattr(ch, "name") else m.group(1))

        def role_name(m):
            for g in self.guilds:
                r = g.get_role(int(m.group(1)))
                if r:
                    return "@" + r.name
            return "@角色"

        text = CHANNEL_MENTION.sub(channel_name, text)
        text = ROLE_MENTION.sub(role_name, text)
        text = CUSTOM_EMOJI.sub(lambda m: f":{m.group(1)}:", text)
        return text

    async def store_message(self, msg: discord.Message) -> None:
        if msg.type not in (discord.MessageType.default, discord.MessageType.reply):
            return
        gid = DM if msg.guild is None else str(msg.guild.id)
        images = []
        for a in msg.attachments:
            if (a.content_type or "").startswith("image/"):
                images.append({"url": a.url, "kind": "image", "label": "图片"})
            else:
                images.append({"kind": "file", "label": f"文件：{a.filename}"})
        for s in msg.stickers:
            images.append({"kind": "sticker", "label": f"贴纸：{s.name}"})
        for e in msg.embeds:
            if e.type in ("gifv", "image") and (e.thumbnail and e.thumbnail.url):
                images.append({"url": e.thumbnail.url, "kind": "image", "label": "动图" if e.type == "gifv" else "图片"})
        is_self = bool(self.user and msg.author.id == self.user.id)
        if not is_self:
            await self.upsert_member(gid, msg.author)
        content = msg.content if is_self else await self.render(msg.content, gid)
        await db.execute(
            "INSERT OR IGNORE INTO messages (id, guild_id, channel_id, author_id, username, display, content, "
            "images, reply_to, created_at, edited_at, deleted, is_self, is_bot) VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?,?)",
            (str(msg.id), gid, str(msg.channel.id), str(msg.author.id), msg.author.name,
             msg.author.display_name, content, json.dumps(images, ensure_ascii=False),
             str(msg.reference.message_id) if msg.reference and msg.reference.message_id else None,
             msg.created_at.timestamp(), msg.edited_at.timestamp() if msg.edited_at else None,
             int(is_self), int(msg.author.bot)))

    # ---------- 事件 ----------

    async def on_message(self, msg: discord.Message):
        try:
            await self.store_message(msg)
        except Exception:  # noqa: BLE001
            log.exception("保存消息失败")
        if self.user is None or msg.author.id == self.user.id:
            return
        if msg.type not in (discord.MessageType.default, discord.MessageType.reply):
            return
        gid = DM if msg.guild is None else str(msg.guild.id)
        keys = emoji.keys_in_text(msg.content)
        if keys:
            await emoji.count_usage(gid, keys)
        general = await store.general()
        if msg.author.bot and not general.get("respond_to_bots"):
            return
        if msg.guild is None:
            dm = await store.dm_settings()
            if str(msg.author.id) not in dm["whitelist"]:
                return
            if msg.content.strip().lower().startswith(("!mode", "/mode")):
                await self.dm_command(msg, dm)
                return
        q = self.queues.get(msg.channel.id)
        if q is None:
            q = self.queues[msg.channel.id] = ChannelQueue(self, msg.channel.id)
        q.push(msg)

    async def on_raw_message_edit(self, payload: discord.RawMessageUpdateEvent):
        content = payload.data.get("content")
        if content is None:
            return
        row = await db.fetchone("SELECT guild_id, is_self FROM messages WHERE id=?", (str(payload.message_id),))
        if not row:
            return
        text = content if row["is_self"] else await self.render(content, row["guild_id"])
        await db.execute("UPDATE messages SET content=?, edited_at=? WHERE id=?",
                         (text, time.time(), str(payload.message_id)))

    async def on_raw_message_delete(self, payload: discord.RawMessageDeleteEvent):
        await db.execute("UPDATE messages SET deleted=1 WHERE id=?", (str(payload.message_id),))

    async def on_raw_bulk_message_delete(self, payload: discord.RawBulkMessageDeleteEvent):
        ids = [str(i) for i in payload.message_ids]
        if ids:
            await db.execute(f"UPDATE messages SET deleted=1 WHERE id IN ({','.join('?' * len(ids))})", ids)

    async def on_raw_reaction_add(self, payload: discord.RawReactionActionEvent):
        if self.user and payload.user_id == self.user.id:
            return
        if payload.emoji.id and payload.guild_id:
            await emoji.count_usage(str(payload.guild_id), [str(payload.emoji.id)])

    async def on_guild_join(self, g):
        log.info("加入了服务器：%s", g.name)
        await self.sync_guild(g)
        await self.sync_members(g)

    async def on_guild_remove(self, g):
        log.info("离开了服务器：%s", g.name)
        await db.execute("UPDATE guilds SET joined=0 WHERE id=?", (str(g.id),))
        await emoji.mark_guild_left(str(g.id))

    async def on_guild_update(self, before, after):
        await self.sync_guild(after)

    async def on_guild_channel_create(self, ch):
        await self.sync_channels(ch.guild)

    async def on_guild_channel_delete(self, ch):
        await self.sync_channels(ch.guild)

    async def on_guild_channel_update(self, before, after):
        await self.sync_channels(after.guild)

    async def on_guild_emojis_update(self, g, before, after):
        await emoji.sync_guild(g)

    async def on_guild_stickers_update(self, g, before, after):
        await emoji.sync_guild(g)

    async def on_member_join(self, m):
        await self.upsert_member(str(m.guild.id), m)

    async def on_member_update(self, before, after):
        await self.upsert_member(str(after.guild.id), after)

    async def on_member_remove(self, m):
        await self.upsert_member(str(m.guild.id), m, in_guild=False)

    async def on_user_update(self, before, after):
        for g in self.guilds:
            m = g.get_member(after.id)
            if m:
                await self.upsert_member(str(g.id), m)

    # ---------- 处理 ----------

    async def is_trigger(self, m: discord.Message) -> bool:
        if self.user in m.mentions:
            return True
        ref = m.reference
        if ref and ref.message_id:
            if isinstance(ref.resolved, discord.Message):
                return ref.resolved.author.id == self.user.id
            row = await db.fetchone("SELECT is_self FROM messages WHERE id=?", (str(ref.message_id),))
            return bool(row and row["is_self"])
        return False

    async def process_batch(self, batch: list[discord.Message]) -> None:
        last = batch[-1]
        channel = last.channel
        general = await store.general()
        if last.guild is None:
            dm = await store.dm_settings()
            cfg = await store.resolve(dm["guild_id"] or None, None)
            await self.respond(channel, last, cfg, general, as_reply=False, dm=dm)
            return
        conf_channel = getattr(channel, "parent_id", None) if isinstance(channel, discord.Thread) else channel.id
        cfg = await store.resolve(str(last.guild.id), str(conf_channel))
        if not cfg.get("enabled", True):
            return
        triggers = [m for m in batch if await self.is_trigger(m)]
        if triggers:
            if cfg.get("reply_enabled", True):
                await self.respond(channel, triggers[-1], cfg, general, as_reply=True)
            return
        if cfg.get("interject_enabled"):
            await self.maybe_interject(channel, last, cfg, general)

    async def maybe_interject(self, channel, last, cfg, general) -> None:
        cid = str(channel.id)
        now = time.time()
        row = await db.fetchone("SELECT MAX(created_at) AS t FROM messages WHERE channel_id=? AND is_self=1", (cid,))
        if row and row["t"] and now - row["t"] < float(cfg.get("interject_cooldown") or 0):
            return
        dq = self.interject_log[cid]
        window = float(cfg.get("interject_window") or 60) * 60
        while dq and now - dq[0] > window:
            dq.popleft()
        if len(dq) >= int(cfg.get("interject_max") or 0):
            return
        if random.random() > float(cfg.get("interject_prob") or 0):
            return
        decision, code, emap = await self.judge(channel, cfg, general)
        log.info("插话判断 #%s：%s %s", getattr(channel, "name", cid), decision, code or "")
        if decision == "SPEAK":
            dq.append(now)
            await self.respond(channel, last, cfg, general, as_reply=False, interject=True)
        elif decision == "REACT" and code:
            dq.append(now)
            await self.add_reactions(last, [code], emap, general)

    async def judge(self, channel, cfg, general) -> tuple[str, str, dict]:
        gid = str(channel.guild.id)
        n = int(general.get("judge_context_lines") or 15)
        rows = await db.fetchall(
            "SELECT * FROM messages WHERE channel_id=? AND deleted=0 ORDER BY created_at DESC LIMIT ?",
            (str(channel.id), n))
        rows.reverse()
        zone = context.tz(general["timezone"])
        lines = []
        for r in rows:
            if r["is_self"]:
                lines.append(f"[{context.fmt_time(r['created_at'], zone)}] 【你】: {r['content']}")
            else:
                lines.append(await context.format_line(r, zone, gid))
        emoji_text, emap = await emoji.candidates(gid, min(40, int(general.get("emoji_candidates") or 40)))
        system = "你要替一个群聊角色判断此刻是否应该主动插话。角色设定：\n" + (cfg.get("persona") or "")[:1500]
        prompt = ("最近的聊天记录：\n" + "\n".join(lines)
                  + ("\n\n可用表情（代码 | 描述）：\n" + emoji_text if emoji_text else "")
                  + "\n\n这些消息没有 @ 你，也没有回复你。判断你现在是否适合自然地加入聊天。"
                  "只输出一行，三选一：\n"
                  "SPEAK —— 有话想说，适合插话\n"
                  "REACT 代码 —— 不说话，只给最后一条消息点个表情（代码取自可用表情，或一个 Unicode emoji）\n"
                  "IGNORE —— 不打扰\n"
                  "大多数时候应该 IGNORE；只有话题和你有关、很有趣、或你确实能接上话时才 SPEAK。")
        try:
            out = await llm.call("judge", system, [{"role": "user", "parts": [{"type": "text", "text": prompt}]}],
                                 guild_id=gid)
        except Exception as e:  # noqa: BLE001
            log.warning("插话判断失败：%s", e)
            return "IGNORE", "", {}
        first = out.strip().splitlines()[0].strip() if out.strip() else "IGNORE"
        upper = first.upper()
        if upper.startswith("SPEAK"):
            return "SPEAK", "", emap
        if upper.startswith("REACT"):
            code = first[5:].strip(" ：:")
            return "REACT", code.split()[0] if code else "", emap
        return "IGNORE", "", emap

    async def respond(self, channel, target: discord.Message, cfg: dict, general: dict,
                      as_reply: bool, interject: bool = False, dm: dict | None = None) -> None:
        cid = str(channel.id)
        is_dm = target.guild is None
        gid = DM if is_dm else str(target.guild.id)
        rows = await context.load_window(cid, cfg)
        user_ids = []
        for r in reversed(rows):
            if not r["is_self"] and r["author_id"] not in user_ids:
                user_ids.append(r["author_id"])
        user_ids = user_ids[:20]
        if str(target.author.id) not in user_ids:
            user_ids.insert(0, str(target.author.id))

        emoji_text, emap = await emoji.candidates(gid, int(general.get("emoji_candidates") or 0))
        sticker_text, smap = ("", {}) if is_dm else await emoji.sticker_candidates(gid)

        if is_dm:
            mode = (dm or {}).get("mode", "own")
            memory_gid = (dm or {}).get("guild_id") or DM
            tag = await context.user_tag(DM, str(target.author.id))
            location = f"和 {tag} 的私聊"
            if mode == "guild" and memory_gid != DM:
                gname = await db.fetchone("SELECT name FROM guilds WHERE id=?", (memory_gid,))
                location += f"（对方是服务器「{gname['name'] if gname else memory_gid}」的成员）"
            system = await context.build_system(cfg, general, memory_gid, location, [str(target.author.id)],
                                                emoji_text, "", dm_user=str(target.author.id), dm_mode=mode)
        else:
            location = f"服务器「{target.guild.name}」的 #{getattr(channel, 'name', cid)} 频道"
            system = await context.build_system(cfg, general, gid, location, user_ids, emoji_text, sticker_text)

        if interject:
            system += "\n\n这次没有人直接叫你，是你自己决定加入聊天，自然地接话即可。"
        elif not is_dm:
            system += f"\n\n这次需要你回应的是 {await context.user_tag(gid, str(target.author.id))} 的最新消息。"

        messages = await context.build_messages(rows, gid, cfg, general)
        async with channel.typing():
            text = await llm.call("chat", system, messages, guild_id=None if is_dm else gid,
                                  provider_id=cfg.get("chat_provider") or "", model=cfg.get("chat_model") or "")
        out = context.parse_output(text)
        sticker = None
        for code in out["stickers"][:1]:
            if code in smap:
                sticker = self.get_sticker(int(smap[code]["id"]))
        if out["reply"] or sticker:
            await self.send_text(channel, out["reply"], reply_to=target if as_reply else None, sticker=sticker)
        if out["reacts"]:
            await self.add_reactions(target, out["reacts"], emap, general)

    async def send_text(self, channel, text: str, reply_to: discord.Message | None = None, sticker=None):
        chunks = split_text(text) or [""]
        allowed = discord.AllowedMentions(everyone=False, roles=False,
                                          users=[reply_to.author] if reply_to else False,
                                          replied_user=bool(reply_to))
        for i, chunk in enumerate(chunks):
            kwargs: dict = {"allowed_mentions": allowed}
            if i == 0 and reply_to is not None:
                kwargs["reference"] = reply_to.to_reference(fail_if_not_exists=False)
                kwargs["mention_author"] = True
            if i == len(chunks) - 1 and sticker is not None:
                kwargs["stickers"] = [sticker]
            if not chunk and "stickers" not in kwargs:
                continue
            try:
                await channel.send(chunk or None, **kwargs)
            except discord.HTTPException as e:
                log.warning("发送失败，去掉引用和贴纸重试：%s", e)
                kwargs.pop("reference", None)
                kwargs.pop("stickers", None)
                if chunk:
                    await channel.send(chunk, allowed_mentions=allowed)

    async def add_reactions(self, msg: discord.Message, codes: list[str], emap: dict, general: dict):
        limit = int(general.get("max_reactions") or 2)
        for code in codes[:limit]:
            code = code.strip()
            target = None
            if code in emap:
                target = self.get_emoji(int(emap[code]["id"]))
            elif re.fullmatch(r"<a?:\w+:\d+>", code):
                target = discord.PartialEmoji.from_str(code)
            elif UNICODE_EMOJI_HINT.match(code):
                target = code
            if target is None:
                continue
            try:
                await msg.add_reaction(target)
            except discord.HTTPException as e:
                log.warning("点反应 %s 失败：%s", code, e)
            await asyncio.sleep(0.5)

    # ---------- 私聊指令 ----------

    async def dm_command(self, msg: discord.Message, dm: dict) -> None:
        parts = msg.content.strip().split()
        await db.execute("UPDATE messages SET deleted=1 WHERE id=?", (str(msg.id),))
        guild_names = {str(g.id): g.name for g in self.guilds}

        def describe(d):
            mode_names = {"guild": "加载服务器人设和记忆", "persona": "只用人设，不加载记忆", "own": "私聊独立记忆"}
            g = d.get("guild_id")
            src = f"「{guild_names.get(g, g)}」" if g else "全局"
            return f"当前模式：{mode_names.get(d['mode'], d['mode'])}；人设来源：{src}"

        if len(parts) == 1:
            lines = [describe(dm), "", "用法：",
                     "`!mode guild <服务器ID>` 加载该服务器的人设和记忆",
                     "`!mode persona <服务器ID|global>` 只用人设，不加载记忆",
                     "`!mode own [服务器ID|global]` 私聊独立记忆，人设取自该服务器或全局",
                     "", "服务器列表："] + [f"`{k}` {v}" for k, v in guild_names.items()]
            reply = "\n".join(lines)
        else:
            mode = parts[1].lower()
            arg = parts[2] if len(parts) > 2 else ""
            if arg.lower() == "global":
                arg = ""
            if mode not in ("guild", "persona", "own"):
                reply = "模式只能是 guild / persona / own"
            elif mode == "guild" and arg not in guild_names:
                reply = "guild 模式需要一个有效的服务器ID，发送 `!mode` 查看列表"
            elif arg and arg not in guild_names:
                reply = "找不到这个服务器ID，发送 `!mode` 查看列表"
            else:
                dm["mode"], dm["guild_id"] = mode, arg
                await db.set_setting("dm", dm)
                reply = "已切换。" + describe(dm)
        sent = await msg.channel.send(reply)
        await db.execute("UPDATE messages SET deleted=1 WHERE id=?", (str(sent.id),))

    # ---------- 状态 ----------

    def status(self) -> dict:
        return {
            "user": str(self.user) if self.user else "",
            "user_id": str(self.user.id) if self.user else "",
            "avatar": str(self.user.display_avatar.url) if self.user else "",
            "latency_ms": round(self.latency * 1000) if self.latency == self.latency else None,
            "guilds": len(self.guilds),
            "connected_at": self.connected_at,
            "queues": sum(len(q.pending) for q in self.queues.values()),
            "busy_channels": sum(1 for q in self.queues.values() if q.busy),
        }


class Manager:
    def __init__(self):
        self.client: LazyBot | None = None
        self.task: asyncio.Task | None = None
        self.state = "stopped"
        self.last_error = ""

    async def token(self) -> str:
        return crypto.decrypt(await db.get_setting("bot_token_enc", "") or "")

    async def start(self) -> None:
        await self.stop()
        token = await self.token()
        if not token:
            self.state, self.last_error = "stopped", "还没有配置 bot token"
            return
        self.client = LazyBot()
        self.state, self.last_error = "connecting", ""
        self.task = asyncio.create_task(self._run(self.client, token))

    async def _run(self, client: LazyBot, token: str) -> None:
        try:
            await client.start(token)
        except discord.LoginFailure:
            self.last_error = "token 无效，请检查后重新填写"
            log.error(self.last_error)
        except discord.PrivilegedIntentsRequired:
            self.last_error = ("缺少特权 Intent：请在 Discord Developer Portal → Bot 页面打开 "
                               "Server Members Intent 和 Message Content Intent")
            log.error(self.last_error)
        except asyncio.CancelledError:
            pass
        except Exception as e:  # noqa: BLE001
            self.last_error = f"连接出错：{e}"
            log.exception("bot 运行出错")
        finally:
            if self.client is client:
                self.state = "stopped" if not self.last_error else "error"

    async def stop(self) -> None:
        if self.client is not None:
            client, self.client = self.client, None
            try:
                await client.close()
            except Exception:  # noqa: BLE001
                pass
        if self.task is not None:
            task, self.task = self.task, None
            try:
                await asyncio.wait_for(task, 10)
            except (asyncio.TimeoutError, asyncio.CancelledError, Exception):  # noqa: BLE001
                task.cancel()
        self.state = "stopped"

    async def autostart(self) -> None:
        if await self.token():
            await self.start()

    def status(self) -> dict:
        data = {"state": self.state, "error": self.last_error}
        c = self.client
        if c is not None:
            if c.is_ready() and not c.is_closed():
                data["state"] = "online"
            data.update(c.status())
        return data


manager = Manager()
