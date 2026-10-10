"""业务配置：分层配置（全局 / 服务器 / 频道）、通用设置、私聊设置。"""
import json

from . import db

# 可分层的配置项及默认值
SCOPE_DEFAULTS: dict = {
    "enabled": True,              # 是否在该范围内工作
    "persona": "你是群里一个友好、有趣的群友。说话自然、简短，像真人一样聊天。",
    "reply_enabled": True,        # 被 @ 或被回复时回答
    "context_mode": "count",      # count=按消息条数, tokens=按估算 token 数
    "context_size": 40,
    "image_limit": 2,             # 进入上下文的图片数量上限
    "reply_image_limit": 4,       # 被回复的那条消息里最多看几张图片（不占 image_limit）
    "memory_enabled": True,       # 是否把记忆放进系统提示词
    "interject_enabled": False,   # 主动插话
    "interject_prob": 0.15,       # 每批新消息触发插话判断的概率
    "interject_cooldown": 300,    # bot 上次发言后的冷却秒数
    "interject_max": 5,           # 窗口内最多插话/点反应次数
    "interject_window": 60,       # 窗口长度（分钟）
    "chat_provider": "",          # 留空 = 使用 API 页面里"聊天"用途的配置
    "chat_model": "",
    "chat_tools": "off",         # off=纯聊天; external=搜索服务; claude=Claude 原生搜索
    "chat_tool_rounds": 4,        # 最多执行几轮工具调用 / 原生搜索续轮
    "emoji_scope": "guild",       # guild=只给本服务器的表情, all=bot 所在所有服务器的表情
    "emoji_limit": 60,            # 最多给模型看多少个表情，0=不给
    "emoji_images": True,         # 上下文里群友用的表情附上图片（不占 image_limit）
    "emoji_image_limit": 60,      # 一次请求最多附几张表情图，0=不限
}

GENERAL_DEFAULTS: dict = {
    "timezone": "Asia/Shanghai",
    "debounce_seconds": 3.0,      # 防抖等待
    "respond_to_bots": False,     # 是否回应其他 bot
    "judge_context_lines": 15,    # 插话判断时给小模型看的最近消息条数
    "max_reactions": 2,
    "gap_minutes": 30,            # 相邻消息间隔超过多少分钟时标注时间间隔
}

DM_DEFAULTS: dict = {
    "whitelist": [],              # 允许私聊的 Discord 用户 ID
    "mode": "own",                # guild=加载某服务器人设+记忆; persona=只用人设; own=私聊独立记忆
    "guild_id": "",               # guild / persona 模式下使用的服务器（own 模式下作为人设来源，可空=全局）
}


async def get_scope(scope_type: str, scope_id: str) -> dict:
    row = await db.fetchone(
        "SELECT data FROM scope_config WHERE scope_type=? AND scope_id=?", (scope_type, scope_id)
    )
    if not row:
        return {}
    try:
        return json.loads(row["data"]) or {}
    except ValueError:
        return {}


async def set_scope(scope_type: str, scope_id: str, data: dict) -> None:
    clean = {k: v for k, v in data.items() if k in SCOPE_DEFAULTS and v is not None}
    if "chat_tools" in clean and clean["chat_tools"] not in ("off", "external", "claude"):
        raise ValueError("聊天工具模式无效")
    if "chat_tool_rounds" in clean:
        rounds = int(clean["chat_tool_rounds"])
        if not 1 <= rounds <= 8:
            raise ValueError("工具调用轮数必须在 1 到 8 之间")
        clean["chat_tool_rounds"] = rounds
    if "emoji_scope" in clean and clean["emoji_scope"] not in ("guild", "all"):
        raise ValueError("表情范围无效")
    for k in ("emoji_limit", "emoji_image_limit", "reply_image_limit", "image_limit"):
        if k in clean:
            clean[k] = max(0, int(clean[k] or 0))
    await db.execute(
        "INSERT INTO scope_config (scope_type, scope_id, data) VALUES (?, ?, ?) "
        "ON CONFLICT(scope_type, scope_id) DO UPDATE SET data=excluded.data",
        (scope_type, scope_id, json.dumps(clean, ensure_ascii=False)),
    )


async def resolve(guild_id: str | None, channel_id: str | None) -> dict:
    """频道 → 服务器 → 全局 → 默认值，下层有设置时覆盖上层。"""
    cfg = dict(SCOPE_DEFAULTS)
    cfg.update(await get_scope("global", "global"))
    if guild_id:
        cfg.update(await get_scope("guild", guild_id))
    if channel_id:
        cfg.update(await get_scope("channel", channel_id))
    return cfg


async def general() -> dict:
    data = dict(GENERAL_DEFAULTS)
    data.update(await db.get_setting("general", {}) or {})
    return data


async def dm_settings() -> dict:
    data = dict(DM_DEFAULTS)
    data.update(await db.get_setting("dm", {}) or {})
    data["whitelist"] = [str(x).strip() for x in data.get("whitelist") or [] if str(x).strip()]
    return data
