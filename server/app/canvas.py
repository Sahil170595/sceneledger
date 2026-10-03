"""Canvas CRUD and invite endpoints.

Exports ``canvas_router`` to be mounted at ``/api/canvases``.
"""

from __future__ import annotations

import uuid as _uuid

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.db import get_pool
from app.deps import get_current_user
from app.types import AuthUser, CanvasDetail, CanvasMember, CanvasSummary

# ---------------------------------------------------------------------------
# Request body models (Pydantic for validation, matching contract TypedDicts)
# ---------------------------------------------------------------------------


class CreateCanvasBody(BaseModel):
    name: str


class InviteBody(BaseModel):
    identifier: str


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

canvas_router = APIRouter()


# ---------------------------------------------------------------------------
# GET / — list canvases where the authenticated user is a member
# ---------------------------------------------------------------------------


@canvas_router.get("")
async def list_canvases(
    user: AuthUser = Depends(get_current_user),
) -> list[CanvasSummary]:
    pool = await get_pool()
    uid = _uuid.UUID(user["id"])
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT c.id, c.name, c.owner_id, c.created_at
            FROM canvases c
            JOIN canvas_members cm ON cm.canvas_id = c.id
            WHERE cm.user_id = $1
            ORDER BY c.created_at DESC
            """,
            uid,
        )
    return [
        CanvasSummary(
            id=str(row["id"]),
            name=row["name"],
            ownerId=str(row["owner_id"]),
            createdAt=row["created_at"].isoformat(),
        )
        for row in rows
    ]


# ---------------------------------------------------------------------------
# POST / — create a canvas and auto-add the creator as a member
# ---------------------------------------------------------------------------


@canvas_router.post("")
async def create_canvas(
    body: CreateCanvasBody,
    user: AuthUser = Depends(get_current_user),
) -> CanvasSummary:
    pool = await get_pool()
    uid = _uuid.UUID(user["id"])
    async with pool.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                INSERT INTO canvases (name, owner_id)
                VALUES ($1, $2)
                RETURNING id, name, owner_id, created_at
                """,
                body.name,
                uid,
            )
            await conn.execute(
                """
                INSERT INTO canvas_members (canvas_id, user_id)
                VALUES ($1, $2)
                """,
                row["id"],
                uid,
            )
    return CanvasSummary(
        id=str(row["id"]),
        name=row["name"],
        ownerId=str(row["owner_id"]),
        createdAt=row["created_at"].isoformat(),
    )


# ---------------------------------------------------------------------------
# GET /{canvas_id} — full canvas detail with shapes and members
# ---------------------------------------------------------------------------


@canvas_router.get("/{canvas_id}", response_model=None)
async def get_canvas(
    canvas_id: str,
    user: AuthUser = Depends(get_current_user),
) -> CanvasDetail | JSONResponse:
    pool = await get_pool()
    try:
        cid = _uuid.UUID(canvas_id)
    except (ValueError, AttributeError):
        return JSONResponse(status_code=404, content={"error": "not_found"})
    uid = _uuid.UUID(user["id"])
    async with pool.acquire() as conn:
        # Check canvas exists
        canvas_row = await conn.fetchrow(
            """
            SELECT id, name, owner_id, created_at
            FROM canvases
            WHERE id = $1
            """,
            cid,
        )
        if canvas_row is None:
            return JSONResponse(status_code=404, content={"error": "not_found"})

        # Check membership
        membership = await conn.fetchval(
            """
            SELECT 1 FROM canvas_members
            WHERE canvas_id = $1 AND user_id = $2
            """,
            cid,
            uid,
        )
        if membership is None:
            return JSONResponse(status_code=403, content={"error": "not_a_member"})

        # Load shapes
        shape_rows = await conn.fetch(
            """
            SELECT id, type, x, y, width, height, fill, stroke,
                   stroke_width, text, font_size, opacity, border_radius
            FROM shapes
            WHERE canvas_id = $1
            ORDER BY created_at, id
            """,
            cid,
        )

        # Load members
        member_rows = await conn.fetch(
            """
            SELECT u.id AS user_id, u.username
            FROM canvas_members cm
            JOIN users u ON u.id = cm.user_id
            WHERE cm.canvas_id = $1
            """,
            cid,
        )

    shapes = []
    for r in shape_rows:
        s: dict = {
            "id": str(r["id"]),
            "type": r["type"],
            "x": r["x"],
            "y": r["y"],
            "width": r["width"],
            "height": r["height"],
            "fill": r["fill"],
            "stroke": r["stroke"],
            "strokeWidth": r["stroke_width"],
        }
        if r["text"] is not None:
            s["text"] = r["text"]
        if r["font_size"] is not None:
            s["fontSize"] = r["font_size"]
        if r["opacity"] != 1:
            s["opacity"] = r["opacity"]
        if r["border_radius"] != 0:
            s["borderRadius"] = r["border_radius"]
        shapes.append(s)

    members = [
        CanvasMember(userId=str(r["user_id"]), username=r["username"])
        for r in member_rows
    ]

    return CanvasDetail(
        id=str(canvas_row["id"]),
        name=canvas_row["name"],
        ownerId=str(canvas_row["owner_id"]),
        createdAt=canvas_row["created_at"].isoformat(),
        shapes=shapes,
        members=members,
    )


# ---------------------------------------------------------------------------
# POST /{canvas_id}/invite — invite a user by username or email
# ---------------------------------------------------------------------------


@canvas_router.post("/{canvas_id}/invite", response_model=None)
async def invite_to_canvas(
    canvas_id: str,
    body: InviteBody,
    user: AuthUser = Depends(get_current_user),
) -> dict | JSONResponse:
    pool = await get_pool()
    try:
        cid = _uuid.UUID(canvas_id)
    except (ValueError, AttributeError):
        return JSONResponse(status_code=404, content={"error": "canvas_not_found"})
    uid = _uuid.UUID(user["id"])
    async with pool.acquire() as conn:
        # Check canvas exists
        canvas_exists = await conn.fetchval(
            "SELECT 1 FROM canvases WHERE id = $1",
            cid,
        )
        if canvas_exists is None:
            return JSONResponse(
                status_code=404, content={"error": "canvas_not_found"}
            )

        # Check requester is a member
        membership = await conn.fetchval(
            """
            SELECT 1 FROM canvas_members
            WHERE canvas_id = $1 AND user_id = $2
            """,
            cid,
            uid,
        )
        if membership is None:
            return JSONResponse(
                status_code=403, content={"error": "not_a_member"}
            )

        # Look up target user by username first, then by email
        target = await conn.fetchrow(
            "SELECT id FROM users WHERE username = $1",
            body.identifier,
        )
        if target is None:
            target = await conn.fetchrow(
                "SELECT id FROM users WHERE email = $1",
                body.identifier,
            )
        if target is None:
            return JSONResponse(
                status_code=404, content={"error": "user_not_found"}
            )

        # Add membership (idempotent — ignore if already a member)
        await conn.execute(
            """
            INSERT INTO canvas_members (canvas_id, user_id)
            VALUES ($1, $2)
            ON CONFLICT DO NOTHING
            """,
            cid,
            target["id"],
        )

    return {"ok": True}


# ---------------------------------------------------------------------------
# DELETE /{canvas_id} — delete a canvas (owner only)
# ---------------------------------------------------------------------------


@canvas_router.delete("/{canvas_id}", response_model=None)
async def delete_canvas(
    canvas_id: str,
    user: AuthUser = Depends(get_current_user),
) -> dict | JSONResponse:
    pool = await get_pool()
    try:
        cid = _uuid.UUID(canvas_id)
    except (ValueError, AttributeError):
        return JSONResponse(status_code=404, content={"error": "not_found"})
    uid = _uuid.UUID(user["id"])
    async with pool.acquire() as conn:
        canvas_row = await conn.fetchrow(
            "SELECT owner_id FROM canvases WHERE id = $1",
            cid,
        )
        if canvas_row is None:
            return JSONResponse(status_code=404, content={"error": "not_found"})
        if str(canvas_row["owner_id"]) != str(uid):
            return JSONResponse(status_code=403, content={"error": "not_owner"})
        await conn.execute("DELETE FROM canvases WHERE id = $1", cid)
    return {"ok": True}
