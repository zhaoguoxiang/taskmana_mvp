"""
Authentication — JWT Bearer Token + bcrypt password hashing.

SECRET_KEY is read from TASKMANA_SECRET_KEY env var (REQUIRED, no default).
User creation is done via cli.py (NOT exposed as a public endpoint).
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlmodel import Session, select

import bcrypt

from database import get_session
from model import User

load_dotenv()  # Load .env so both main.py and cli.py pick up config

# ── Config ────────────────────────────────────────────────────────────────────

SECRET_KEY = os.getenv("TASKMANA_SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError(
        "TASKMANA_SECRET_KEY environment variable is required.\n"
        "Generate one:  python -c \"import secrets; print(secrets.token_urlsafe(32))\"\n"
        "Then:  export TASKMANA_SECRET_KEY='...'  or add it to .env"
    )

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("TASKMANA_TOKEN_EXPIRE_MINUTES", "1440"))  # 24h

# ── Password hashing ──────────────────────────────────────────────────────────


def hash_password(plain: str) -> str:
    """Hash a plain-text password with bcrypt."""
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    """Verify a plain-text password against a bcrypt hash."""
    return bcrypt.checkpw(plain.encode(), hashed.encode())


# ── JWT ───────────────────────────────────────────────────────────────────────


def create_access_token(data: dict) -> str:
    """Create a signed JWT with an expiration claim."""
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict | None:
    """Decode and validate a JWT.  Returns payload dict or None on failure."""
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None


# ── Schemas ───────────────────────────────────────────────────────────────────

_bearer = HTTPBearer(auto_error=False)


class UserLogin(BaseModel):
    username: str
    password: str


class UserResponse(BaseModel):
    id: int
    username: str
    created_at: str


# ── Dependency ────────────────────────────────────────────────────────────────


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    session: Session = Depends(get_session),
) -> User:
    """FastAPI dependency: extract Bearer token, validate, return User.

    Raises 401 if token is missing, invalid, or user not found.
    """
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header (Bearer token required)",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = decode_access_token(credentials.credentials)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id_str: str | None = payload.get("sub")
    if user_id_str is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id = int(user_id_str)
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return user


def get_optional_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    session: Session = Depends(get_session),
) -> User | None:
    """Like get_current_user but returns None instead of raising 401."""
    if credentials is None:
        return None
    payload = decode_access_token(credentials.credentials)
    if payload is None:
        return None
    user_id_str: str | None = payload.get("sub")
    if user_id_str is None:
        return None
    return session.get(User, int(user_id_str))
