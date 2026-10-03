"""Authentication endpoints: signup, login, and current-user lookup."""

from __future__ import annotations

import os
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.db import get_pool
from app.deps import get_current_user
from app.types import AuthResponse, AuthUser

# ---------------------------------------------------------------------------
# Simple in-memory rate limiter: {ip: [timestamps]}
# ---------------------------------------------------------------------------

_rate_limits: dict[str, list[float]] = defaultdict(list)
RATE_LIMIT_WINDOW = 60  # seconds
RATE_LIMIT_MAX = 20  # max attempts per window per key (generous for shared NAT/VPN)


def _check_rate_limit(ip: str, action: str = "auth") -> bool:
    """Returns True if rate limited (should reject). Keyed by ip+action."""
    key = f"{ip}:{action}"
    now = time.time()
    attempts = _rate_limits[key]
    _rate_limits[key] = [t for t in attempts if now - t < RATE_LIMIT_WINDOW]
    if len(_rate_limits[key]) >= RATE_LIMIT_MAX:
        return True
    _rate_limits[key].append(now)
    return False

# ---------------------------------------------------------------------------
# JWT configuration
# ---------------------------------------------------------------------------

JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret-do-not-use-in-prod")
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 24

# ---------------------------------------------------------------------------
# Pydantic request models (for FastAPI body parsing / validation)
# ---------------------------------------------------------------------------


class SignupRequestBody(BaseModel):
    username: str
    email: str
    password: str


class LoginRequestBody(BaseModel):
    username: str
    password: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _hash_password(plain: str) -> str:
    """Return a bcrypt hash of *plain*."""
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _verify_password(plain: str, hashed: str) -> bool:
    """Check *plain* against a bcrypt *hashed* value."""
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def _create_token(user_id: str, username: str, email: str) -> str:
    """Create a signed JWT with the standard payload fields."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "username": username,
        "email": email,
        "exp": now + timedelta(hours=JWT_EXPIRY_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

auth_router = APIRouter()


@auth_router.post("/signup")
async def signup(body: SignupRequestBody, request: Request) -> JSONResponse:
    """Register a new user and return an auth token."""
    client_ip = request.client.host if request.client else "unknown"
    if _check_rate_limit(client_ip, "signup"):
        return JSONResponse(status_code=429, content={"error": "rate_limited"})

    pool = await get_pool()
    password_hash = _hash_password(body.password)

    async with pool.acquire() as conn:
        try:
            row = await conn.fetchrow(
                """
                INSERT INTO users (username, email, password_hash)
                VALUES ($1, $2, $3)
                RETURNING id, username, email
                """,
                body.username,
                body.email,
                password_hash,
            )
        except Exception as exc:
            # asyncpg raises UniqueViolationError (a subclass of
            # asyncpg.IntegrityConstraintViolationError) when a UNIQUE
            # constraint is violated.  The constraint name tells us which
            # column collided.
            exc_str = str(exc)
            if "users_username_key" in exc_str:
                return JSONResponse(
                    status_code=409,
                    content={"error": "username_taken"},
                )
            if "users_email_key" in exc_str:
                return JSONResponse(
                    status_code=409,
                    content={"error": "email_taken"},
                )
            # Re-raise unexpected DB errors.
            raise

    user_id = str(row["id"])
    username = row["username"]
    email = row["email"]
    token = _create_token(user_id, username, email)

    response: AuthResponse = {
        "token": token,
        "user": {
            "id": user_id,
            "username": username,
            "email": email,
        },
    }
    return JSONResponse(status_code=200, content=response)


@auth_router.post("/login")
async def login(body: LoginRequestBody, request: Request) -> JSONResponse:
    """Authenticate an existing user and return an auth token."""
    client_ip = request.client.host if request.client else "unknown"
    if _check_rate_limit(client_ip, "login"):
        return JSONResponse(status_code=429, content={"error": "rate_limited"})

    pool = await get_pool()

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, username, email, password_hash FROM users WHERE username = $1",
            body.username,
        )

    if row is None:
        return JSONResponse(
            status_code=401,
            content={"error": "invalid_credentials"},
        )

    if not _verify_password(body.password, row["password_hash"]):
        return JSONResponse(
            status_code=401,
            content={"error": "invalid_credentials"},
        )

    user_id = str(row["id"])
    username = row["username"]
    email = row["email"]
    token = _create_token(user_id, username, email)

    response: AuthResponse = {
        "token": token,
        "user": {
            "id": user_id,
            "username": username,
            "email": email,
        },
    }
    return JSONResponse(status_code=200, content=response)


@auth_router.get("/me")
async def me(current_user: AuthUser = Depends(get_current_user)) -> JSONResponse:
    """Return the authenticated user's profile."""
    return JSONResponse(status_code=200, content=current_user)
