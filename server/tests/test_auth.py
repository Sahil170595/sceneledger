# Sceneledger release: synthetic test addresses use the reserved .test domain.
"""Tests for auth endpoints: signup, login, me."""

import pytest
from httpx import AsyncClient

from tests.conftest import auth_header, create_user


@pytest.mark.asyncio
async def test_signup_returns_token_and_user(client: AsyncClient):
    resp = await client.post(
        "/api/auth/signup",
        json={"username": "alice", "email": "alice@example.test", "password": "pass123"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "token" in data
    assert data["user"]["username"] == "alice"
    assert data["user"]["email"] == "alice@example.test"
    assert "id" in data["user"]


@pytest.mark.asyncio
async def test_signup_duplicate_username(client: AsyncClient):
    await create_user(client, username="bob", email="bob1@example.test")
    resp = await client.post(
        "/api/auth/signup",
        json={"username": "bob", "email": "bob2@example.test", "password": "pass123"},
    )
    assert resp.status_code == 409
    assert resp.json()["error"] == "username_taken"


@pytest.mark.asyncio
async def test_signup_duplicate_email(client: AsyncClient):
    await create_user(client, username="carol1", email="carol@example.test")
    resp = await client.post(
        "/api/auth/signup",
        json={"username": "carol2", "email": "carol@example.test", "password": "pass123"},
    )
    assert resp.status_code == 409
    assert resp.json()["error"] == "email_taken"


@pytest.mark.asyncio
async def test_login_success(client: AsyncClient):
    await create_user(client, username="dave", email="dave@example.test", password="mypass")
    resp = await client.post(
        "/api/auth/login",
        json={"username": "dave", "password": "mypass"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "token" in data
    assert data["user"]["username"] == "dave"


@pytest.mark.asyncio
async def test_login_wrong_password(client: AsyncClient):
    await create_user(client, username="eve", email="eve@example.test", password="correct")
    resp = await client.post(
        "/api/auth/login",
        json={"username": "eve", "password": "wrong"},
    )
    assert resp.status_code == 401
    assert resp.json()["error"] == "invalid_credentials"


@pytest.mark.asyncio
async def test_login_nonexistent_user(client: AsyncClient):
    resp = await client.post(
        "/api/auth/login",
        json={"username": "ghost", "password": "nope"},
    )
    assert resp.status_code == 401
    assert resp.json()["error"] == "invalid_credentials"


@pytest.mark.asyncio
async def test_me_returns_user(client: AsyncClient):
    data = await create_user(client, username="frank")
    resp = await client.get("/api/auth/me", headers=auth_header(data["token"]))
    assert resp.status_code == 200
    assert resp.json()["username"] == "frank"


@pytest.mark.asyncio
async def test_me_no_token(client: AsyncClient):
    resp = await client.get("/api/auth/me")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_me_bad_token(client: AsyncClient):
    resp = await client.get("/api/auth/me", headers=auth_header("garbage.token.here"))
    assert resp.status_code == 401
