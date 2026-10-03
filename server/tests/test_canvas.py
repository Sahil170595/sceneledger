"""Tests for canvas CRUD and invite endpoints."""

import pytest
from httpx import AsyncClient

from tests.conftest import auth_header, create_canvas, create_user


@pytest.mark.asyncio
async def test_create_canvas(client: AsyncClient):
    user = await create_user(client)
    canvas = await create_canvas(client, user["token"], name="My Board")
    assert canvas["name"] == "My Board"
    assert "id" in canvas
    assert canvas["ownerId"] == user["user"]["id"]
    assert "createdAt" in canvas


@pytest.mark.asyncio
async def test_list_canvases_shows_own(client: AsyncClient):
    user = await create_user(client)
    await create_canvas(client, user["token"], name="Board A")
    await create_canvas(client, user["token"], name="Board B")

    resp = await client.get("/api/canvases", headers=auth_header(user["token"]))
    assert resp.status_code == 200
    names = [c["name"] for c in resp.json()]
    assert "Board A" in names
    assert "Board B" in names


@pytest.mark.asyncio
async def test_list_canvases_excludes_others(client: AsyncClient):
    alice = await create_user(client, username="alice")
    bob = await create_user(client, username="bob")
    await create_canvas(client, alice["token"], name="Alice Only")

    resp = await client.get("/api/canvases", headers=auth_header(bob["token"]))
    assert resp.status_code == 200
    assert len(resp.json()) == 0


@pytest.mark.asyncio
async def test_get_canvas_detail(client: AsyncClient):
    user = await create_user(client)
    canvas = await create_canvas(client, user["token"])

    resp = await client.get(
        f"/api/canvases/{canvas['id']}", headers=auth_header(user["token"])
    )
    assert resp.status_code == 200
    detail = resp.json()
    assert detail["id"] == canvas["id"]
    assert "shapes" in detail
    assert "members" in detail
    assert len(detail["members"]) == 1
    assert detail["members"][0]["username"] == user["user"]["username"]


@pytest.mark.asyncio
async def test_get_canvas_not_found(client: AsyncClient):
    user = await create_user(client)
    resp = await client.get(
        "/api/canvases/00000000-0000-0000-0000-000000000000",
        headers=auth_header(user["token"]),
    )
    assert resp.status_code == 404
    assert resp.json()["error"] == "not_found"


@pytest.mark.asyncio
async def test_get_canvas_not_member(client: AsyncClient):
    alice = await create_user(client, username="alice")
    bob = await create_user(client, username="bob")
    canvas = await create_canvas(client, alice["token"])

    resp = await client.get(
        f"/api/canvases/{canvas['id']}", headers=auth_header(bob["token"])
    )
    assert resp.status_code == 403
    assert resp.json()["error"] == "not_a_member"


@pytest.mark.asyncio
async def test_get_canvas_malformed_id(client: AsyncClient):
    user = await create_user(client)
    resp = await client.get(
        "/api/canvases/not-a-uuid", headers=auth_header(user["token"])
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_invite_by_username(client: AsyncClient):
    alice = await create_user(client, username="alice")
    bob = await create_user(client, username="bob")
    canvas = await create_canvas(client, alice["token"])

    resp = await client.post(
        f"/api/canvases/{canvas['id']}/invite",
        json={"identifier": "bob"},
        headers=auth_header(alice["token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    # Bob can now see the canvas
    resp = await client.get("/api/canvases", headers=auth_header(bob["token"]))
    assert any(c["id"] == canvas["id"] for c in resp.json())


@pytest.mark.asyncio
async def test_invite_by_email(client: AsyncClient):
    alice = await create_user(client, username="alice")
    await create_user(client, username="bob", email="bob@example.com")
    canvas = await create_canvas(client, alice["token"])

    resp = await client.post(
        f"/api/canvases/{canvas['id']}/invite",
        json={"identifier": "bob@example.com"},
        headers=auth_header(alice["token"]),
    )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_invite_user_not_found(client: AsyncClient):
    alice = await create_user(client, username="alice")
    canvas = await create_canvas(client, alice["token"])

    resp = await client.post(
        f"/api/canvases/{canvas['id']}/invite",
        json={"identifier": "nobody"},
        headers=auth_header(alice["token"]),
    )
    assert resp.status_code == 404
    assert resp.json()["error"] == "user_not_found"


@pytest.mark.asyncio
async def test_invite_not_a_member(client: AsyncClient):
    alice = await create_user(client, username="alice")
    bob = await create_user(client, username="bob")
    await create_user(client, username="carol")
    canvas = await create_canvas(client, alice["token"])

    resp = await client.post(
        f"/api/canvases/{canvas['id']}/invite",
        json={"identifier": "carol"},
        headers=auth_header(bob["token"]),
    )
    assert resp.status_code == 403
    assert resp.json()["error"] == "not_a_member"


@pytest.mark.asyncio
async def test_invite_idempotent(client: AsyncClient):
    alice = await create_user(client, username="alice")
    await create_user(client, username="bob")
    canvas = await create_canvas(client, alice["token"])

    # Invite twice — second should succeed silently
    for _ in range(2):
        resp = await client.post(
            f"/api/canvases/{canvas['id']}/invite",
            json={"identifier": "bob"},
            headers=auth_header(alice["token"]),
        )
        assert resp.status_code == 200


@pytest.mark.asyncio
async def test_delete_canvas_owner(client: AsyncClient):
    alice = await create_user(client, username="alice")
    canvas = await create_canvas(client, alice["token"])

    resp = await client.delete(
        f"/api/canvases/{canvas['id']}", headers=auth_header(alice["token"])
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    # Verify it's gone
    resp = await client.get(
        f"/api/canvases/{canvas['id']}", headers=auth_header(alice["token"])
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_canvas_not_owner(client: AsyncClient):
    alice = await create_user(client, username="alice")
    bob = await create_user(client, username="bob")
    canvas = await create_canvas(client, alice["token"])

    # Invite bob first so he's a member
    await client.post(
        f"/api/canvases/{canvas['id']}/invite",
        json={"identifier": "bob"},
        headers=auth_header(alice["token"]),
    )

    resp = await client.delete(
        f"/api/canvases/{canvas['id']}", headers=auth_header(bob["token"])
    )
    assert resp.status_code == 403
    assert resp.json()["error"] == "not_owner"
