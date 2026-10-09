"""敏感信息（bot token、API Key）加密存储。"""
import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from .config import SECRET_KEY

_fernet = Fernet(base64.urlsafe_b64encode(hashlib.sha256(SECRET_KEY.encode()).digest()))


def encrypt(text: str) -> str:
    if not text:
        return ""
    return _fernet.encrypt(text.encode()).decode()


def decrypt(token: str) -> str:
    if not token:
        return ""
    try:
        return _fernet.decrypt(token.encode()).decode()
    except InvalidToken:
        return ""


def mask(text: str) -> str:
    if not text:
        return ""
    if len(text) <= 8:
        return "****"
    return text[:4] + "****" + text[-4:]
