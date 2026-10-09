"""日志：内存环形缓冲（后台实时查看）+ 报错持久化到数据库。"""
import asyncio
import collections
import logging
import time
import traceback

from . import db

_buffer: collections.deque = collections.deque(maxlen=1500)
_seq = 0
_pending_errors: list[tuple] = []


class BufferHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        global _seq
        try:
            msg = record.getMessage()
        except Exception:  # noqa: BLE001
            msg = str(record.msg)
        _seq += 1
        _buffer.append({"seq": _seq, "ts": record.created, "level": record.levelname,
                        "logger": record.name, "message": msg})
        if record.levelno >= logging.ERROR:
            trace = ""
            if record.exc_info:
                trace = "".join(traceback.format_exception(*record.exc_info))
            _pending_errors.append((record.created, record.name, msg, trace))


def setup() -> None:
    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    stream = logging.StreamHandler()
    stream.setFormatter(fmt)
    root.handlers = [stream, BufferHandler()]
    logging.getLogger("discord").setLevel(logging.INFO)
    logging.getLogger("discord.gateway").setLevel(logging.WARNING)
    logging.getLogger("discord.http").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)


async def flush_errors_loop() -> None:
    while True:
        await asyncio.sleep(2)
        if not _pending_errors:
            continue
        rows = list(_pending_errors)
        _pending_errors.clear()
        try:
            await db.executemany("INSERT INTO errors (ts, logger, message, trace) VALUES (?,?,?,?)", rows)
            await db.execute("DELETE FROM errors WHERE id NOT IN (SELECT id FROM errors ORDER BY id DESC LIMIT 500)")
        except Exception:  # noqa: BLE001
            pass


def get_logs(after: int = 0, limit: int = 300) -> list[dict]:
    items = [x for x in _buffer if x["seq"] > after]
    return items[-limit:]


def now() -> float:
    return time.time()
