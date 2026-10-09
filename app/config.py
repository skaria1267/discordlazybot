"""运行环境配置（来自环境变量）。业务配置都在数据库里，通过后台修改。"""
import os
import secrets
from pathlib import Path

DATA_DIR = Path(os.environ.get("DATA_DIR", "./data")).resolve()
DATA_DIR.mkdir(parents=True, exist_ok=True)

HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "38761"))
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
DB_PATH = DATA_DIR / "bot.db"


def _load_secret() -> str:
    env = os.environ.get("SECRET_KEY")
    if env:
        return env
    p = DATA_DIR / "secret.key"
    if p.exists():
        return p.read_text().strip()
    key = secrets.token_urlsafe(48)
    p.write_text(key)
    try:
        os.chmod(p, 0o600)
    except OSError:
        pass
    return key


SECRET_KEY = _load_secret()
