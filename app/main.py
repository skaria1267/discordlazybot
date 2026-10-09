"""入口：同一个事件循环里运行管理后台和 Discord bot。"""
import asyncio
import logging

import uvicorn

from . import config, db, emoji, logbuf, web
from .bot import manager

log = logging.getLogger("main")


async def main() -> None:
    logbuf.setup()
    await db.init()
    await web.ensure_password()
    asyncio.create_task(logbuf.flush_errors_loop())
    asyncio.create_task(emoji.tagger_loop())
    asyncio.create_task(manager.autostart())
    log.info("管理后台监听 %s:%s", config.HOST, config.PORT)
    server = uvicorn.Server(uvicorn.Config(
        web.app, host=config.HOST, port=config.PORT, log_config=None,
        proxy_headers=True, forwarded_allow_ips="*"))
    try:
        await server.serve()
    finally:
        await manager.stop()
        await db.close()


if __name__ == "__main__":
    asyncio.run(main())
