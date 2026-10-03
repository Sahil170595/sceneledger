import os

import jwt
from fastapi import Header, HTTPException

from app.types import AuthUser


async def get_current_user(
    authorization: str = Header(default=""),
) -> AuthUser:
    """Extract and validate JWT from the Authorization header.

    Expected header format: ``Bearer <token>``
    JWT payload must contain: sub, username, email, exp.
    Returns an AuthUser-shaped dict on success.
    Raises HTTPException(401) on any failure.
    """
    secret = os.environ.get("JWT_SECRET", "dev-secret-do-not-use-in-prod")
    if not secret:
        raise HTTPException(status_code=401, detail="unauthorized")

    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="unauthorized")

    token = authorization[7:]
    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"])
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        raise HTTPException(status_code=401, detail="unauthorized")

    sub = payload.get("sub")
    username = payload.get("username")
    email = payload.get("email", "")

    if not sub or not username:
        raise HTTPException(status_code=401, detail="unauthorized")

    return AuthUser(id=sub, username=username, email=email)
