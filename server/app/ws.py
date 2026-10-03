"""
WebSocket handler for real-time whiteboard collaboration.

Sceneledger release: source comments clarified; behavior retained.
Implements: auth, init, op persistence+broadcast with seq/opId,
cursor relay, presence join/leave, per-canvas locking.
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid as _uuid
from collections import defaultdict

from fastapi import WebSocket, WebSocketDisconnect

from app.db import get_pool
from app.types import (
    CURSOR_PALETTE,
    SHAPE_DB_TO_WIRE,
    SHAPE_WIRE_TO_DB,
    AuthUser,
    PresenceUser,
)

# Local mapping overrides for columns not in types.py
_EXTRA_DB_TO_WIRE = {"border_radius": "borderRadius"}
_EXTRA_WIRE_TO_DB = {"borderRadius": "border_radius"}

try:
    import jwt
except ImportError:  # pragma: no cover – pyjwt is a runtime dep
    raise

# ── Module-level state (per-process, single worker) ─────────

# canvas_id -> user_id -> {username, color, ws, send_lock}
presence: dict[str, dict[str, dict]] = defaultdict(dict)

# canvas_id -> monotonically increasing int
seq_counters: dict[str, int] = defaultdict(int)

# canvas_id -> asyncio.Lock (serialises op processing per canvas)
canvas_locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)


# ── Helpers ──────────────────────────────────────────────────


def _decode_token(token: str) -> AuthUser | None:
    """Decode a JWT token manually (no FastAPI DI for WebSocket)."""
    secret = os.environ.get("JWT_SECRET", "dev-secret-do-not-use-in-prod")
    if not secret:
        return None
    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"])
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None
    sub = payload.get("sub")
    username = payload.get("username")
    email = payload.get("email")
    if not sub or not username:
        return None
    return AuthUser(id=sub, username=username, email=email or "")


def _row_to_shape(row: dict) -> dict:
    """Convert an asyncpg Record (snake_case) to a wire-format Shape (camelCase)."""
    shape: dict = {}
    for key, value in row.items():
        if key in ("canvas_id", "created_at"):
            continue  # internal, not on the wire
        # Omit None for optional fields (text, font_size) so the wire format
        # matches the NotRequired TypedDict contract.
        if value is None:
            continue
        wire_key = SHAPE_DB_TO_WIRE.get(key) or _EXTRA_DB_TO_WIRE.get(key, key)
        # UUID -> str
        if hasattr(value, "hex"):
            shape[wire_key] = str(value)
        else:
            shape[wire_key] = value
    return shape


_ALLOWED_SHAPE_COLS = frozenset({
    "id", "type", "x", "y", "width", "height",
    "fill", "stroke", "stroke_width", "text", "font_size",
    "opacity", "border_radius",
})


def _shape_to_columns(shape: dict) -> tuple[list[str], list]:
    """Extract DB columns and values from a wire-format Shape dict for INSERT.

    Only whitelisted column names are accepted to prevent SQL injection
    through crafted key names in the shape payload.
    """
    cols: list[str] = []
    vals: list = []
    for wire_key, value in shape.items():
        db_key = SHAPE_WIRE_TO_DB.get(wire_key) or _EXTRA_WIRE_TO_DB.get(wire_key, wire_key)
        if db_key not in _ALLOWED_SHAPE_COLS:
            continue
        # asyncpg requires uuid.UUID for UUID columns
        if db_key == "id" and isinstance(value, str):
            value = _uuid.UUID(value)
        cols.append(db_key)
        vals.append(value)
    return cols, vals


async def _safe_send(ws: WebSocket, data: str, send_lock: asyncio.Lock) -> None:
    """Send text through a WebSocket, serialised per-connection to avoid frame interleaving."""
    try:
        async with send_lock:
            await ws.send_text(data)
    except Exception:
        pass  # connection already closed; disconnect handler will clean up


async def _broadcast(canvas_id: str, message: dict, *, exclude_user: str | None = None) -> None:
    """Broadcast a JSON message to all clients on a canvas.

    Starts sends concurrently using asyncio.gather with return_exceptions=True.
    The caller still awaits all sends; there is no send deadline.
    """
    payload = json.dumps(message)
    targets = []
    for uid, info in presence.get(canvas_id, {}).items():
        if uid == exclude_user:
            continue
        targets.append(_safe_send(info["ws"], payload, info["send_lock"]))
    if targets:
        await asyncio.gather(*targets, return_exceptions=True)


async def _broadcast_all(canvas_id: str, message: dict) -> None:
    """Broadcast to ALL clients on a canvas, including the sender."""
    payload = json.dumps(message)
    targets = []
    for _uid, info in presence.get(canvas_id, {}).items():
        targets.append(_safe_send(info["ws"], payload, info["send_lock"]))
    if targets:
        await asyncio.gather(*targets, return_exceptions=True)


# ── Ping/Pong heartbeat ─────────────────────────────────────

PING_INTERVAL = 30  # seconds between pings
PONG_TIMEOUT = 10   # seconds to wait for pong reply


async def _heartbeat_loop(
    ws: WebSocket,
    send_lock: asyncio.Lock,
    pong_event: asyncio.Event,
    cancel_event: asyncio.Event,
) -> None:
    """Send periodic pings and close the connection if pong is not received in time."""
    try:
        while not cancel_event.is_set():
            # Wait PING_INTERVAL seconds or until cancelled
            try:
                await asyncio.wait_for(cancel_event.wait(), timeout=PING_INTERVAL)
                return  # cancel_event was set
            except asyncio.TimeoutError:
                pass  # time to ping

            # Send ping
            pong_event.clear()
            await _safe_send(ws, json.dumps({"type": "ping"}), send_lock)

            # Wait for pong
            try:
                await asyncio.wait_for(pong_event.wait(), timeout=PONG_TIMEOUT)
            except asyncio.TimeoutError:
                # No pong received — close the connection
                try:
                    await ws.close(code=1000, reason="pong timeout")
                except Exception:
                    pass
                return
    except asyncio.CancelledError:
        pass


# ── Op persistence ───────────────────────────────────────────


async def _persist_add(conn, canvas_id: str, shape: dict) -> bool:
    """INSERT a new shape. Returns True if inserted, False if id already existed."""
    cols, vals = _shape_to_columns(shape)
    # Ensure canvas_id is included (as UUID for asyncpg)
    if "canvas_id" not in cols:
        cols.append("canvas_id")
        vals.append(_uuid.UUID(canvas_id) if isinstance(canvas_id, str) else canvas_id)
    placeholders = ", ".join(f"${i+1}" for i in range(len(cols)))
    col_names = ", ".join(cols)
    result = await conn.execute(
        f"INSERT INTO shapes ({col_names}) VALUES ({placeholders}) ON CONFLICT (id) DO NOTHING",
        *vals,
    )
    # asyncpg returns 'INSERT 0 1' or 'INSERT 0 0'
    return result.endswith("1")


_ALLOWED_UPDATE_COLS = _ALLOWED_SHAPE_COLS - {"id", "type"}


async def _persist_update(conn, canvas_id: str, shape_id: str, props: dict) -> bool:
    """UPDATE only the columns in props, scoped to this canvas.

    Returns True if a row was modified.
    """
    if not props:
        return False
    set_parts: list[str] = []
    vals: list = []
    idx = 1
    for wire_key, value in props.items():
        db_key = SHAPE_WIRE_TO_DB.get(wire_key) or _EXTRA_WIRE_TO_DB.get(wire_key, wire_key)
        if db_key not in _ALLOWED_UPDATE_COLS:
            continue
        set_parts.append(f"{db_key} = ${idx}")
        vals.append(value)
        idx += 1
    if not set_parts:
        return False
    vals.append(_uuid.UUID(shape_id) if isinstance(shape_id, str) else shape_id)
    vals.append(_uuid.UUID(canvas_id) if isinstance(canvas_id, str) else canvas_id)
    sql = f"UPDATE shapes SET {', '.join(set_parts)} WHERE id = ${idx} AND canvas_id = ${idx + 1}"
    result = await conn.execute(sql, *vals)
    # asyncpg returns 'UPDATE N'
    return not result.endswith("0")


async def _persist_delete(conn, canvas_id: str, shape_id: str) -> bool:
    """DELETE a shape, scoped to this canvas. Returns True if a row was removed."""
    result = await conn.execute(
        "DELETE FROM shapes WHERE id = $1 AND canvas_id = $2",
        _uuid.UUID(shape_id) if isinstance(shape_id, str) else shape_id,
        _uuid.UUID(canvas_id) if isinstance(canvas_id, str) else canvas_id,
    )
    return not result.endswith("0")


# ── Main endpoint ────────────────────────────────────────────


async def websocket_endpoint(ws: WebSocket) -> None:
    """WebSocket endpoint for a canvas session.

    Connection: WS /ws?canvasId=<uuid>&token=<jwt>
    """
    # ── Auth before accept ───────────────────────────────────
    canvas_id = ws.query_params.get("canvasId", "")
    token = ws.query_params.get("token", "")

    # Accept first to avoid Starlette/uvicorn issues with close-before-accept
    await ws.accept()

    if not canvas_id or not token:
        await ws.close(code=4001, reason="missing canvasId or token")
        return

    user = _decode_token(token)
    if user is None:
        await ws.close(code=4001, reason="auth failure")
        return

    user_id: str = user["id"]
    username: str = user["username"]

    # Verify canvas membership
    pool = await get_pool()
    try:
        cid = _uuid.UUID(canvas_id)
        uid = _uuid.UUID(user_id)
    except (ValueError, AttributeError):
        await ws.close(code=4001, reason="invalid canvasId or userId")
        return

    async with pool.acquire(timeout=5) as conn:
        row = await conn.fetchrow(
            "SELECT 1 FROM canvas_members WHERE canvas_id = $1 AND user_id = $2",
            cid,
            uid,
        )
    if row is None:
        await ws.close(code=4003, reason="not a canvas member")
        return

    # Per-connection lock serializes sends from concurrent tasks.
    send_lock = asyncio.Lock()

    # Heartbeat events
    pong_event = asyncio.Event()
    cancel_heartbeat = asyncio.Event()

    # ── Presence ─────────────────────────────────────────────
    canvas_presence = presence[canvas_id]
    color_index = len(canvas_presence) % len(CURSOR_PALETTE)
    color = CURSOR_PALETTE[color_index]

    me: PresenceUser = PresenceUser(
        userId=user_id,
        username=username,
        color=color,
    )
    canvas_presence[user_id] = {
        "username": username,
        "color": color,
        "ws": ws,
        "send_lock": send_lock,
    }

    heartbeat_task = None

    try:
        # ── Send init ────────────────────────────────────────
        async with pool.acquire(timeout=5) as conn:
            rows = await conn.fetch(
                "SELECT * FROM shapes WHERE canvas_id = $1 ORDER BY created_at, id",
                cid,
            )
        shapes = [_row_to_shape(dict(r)) for r in rows]
        users = [
            PresenceUser(userId=uid, username=info["username"], color=info["color"])
            for uid, info in canvas_presence.items()
        ]
        current_seq = seq_counters[canvas_id]

        init_msg = json.dumps({
            "type": "init",
            "shapes": shapes,
            "users": users,
            "seq": current_seq,
        })
        async with send_lock:
            await ws.send_text(init_msg)

        # Broadcast join to others
        await _broadcast(canvas_id, {"type": "join", "user": dict(me)}, exclude_user=user_id)

        # Start heartbeat task
        heartbeat_task = asyncio.create_task(
            _heartbeat_loop(ws, send_lock, pong_event, cancel_heartbeat)
        )

        # ── Message loop ─────────────────────────────────────
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                continue  # ignore malformed messages

            msg_type = msg.get("type")

            if msg_type == "pong":
                pong_event.set()
                continue

            if msg_type == "op":
                op = msg.get("op")
                op_id = msg.get("opId", "")
                if not op or not isinstance(op, dict):
                    continue

                kind = op.get("kind")
                lock = canvas_locks[canvas_id]

                # Acquire per-canvas lock, persist, assign seq, then
                # release before broadcast. Delivery is not seq-ordered.
                modified = False
                seq = 0
                async with lock:
                    async with pool.acquire(timeout=5) as conn:
                        if kind == "add":
                            shape = op.get("shape")
                            if shape and isinstance(shape, dict) and "id" in shape:
                                modified = await _persist_add(conn, canvas_id, shape)
                        elif kind == "update":
                            shape_id = op.get("shapeId")
                            props = op.get("props")
                            if shape_id and props and isinstance(props, dict):
                                modified = await _persist_update(conn, canvas_id, shape_id, props)
                        elif kind == "delete":
                            shape_id = op.get("shapeId")
                            if shape_id:
                                modified = await _persist_delete(conn, canvas_id, shape_id)
                    if modified:
                        seq_counters[canvas_id] += 1
                        seq = seq_counters[canvas_id]
                # Lock released — now broadcast outside the lock
                if modified:
                    await _broadcast_all(canvas_id, {
                        "type": "op",
                        "op": op,
                        "userId": user_id,
                        "seq": seq,
                        "opId": op_id,
                    })
                # If not modified (no-op): no broadcast, no seq increment

            elif msg_type == "cursor":
                x = msg.get("x")
                y = msg.get("y")
                if x is not None and y is not None:
                    await _broadcast(canvas_id, {
                        "type": "cursor",
                        "userId": user_id,
                        "username": username,
                        "x": x,
                        "y": y,
                    }, exclude_user=user_id)

    except WebSocketDisconnect:
        pass
    except Exception:
        # Send error before disconnecting so client knows what happened
        try:
            async with send_lock:
                await ws.send_text(json.dumps({
                    "type": "error",
                    "message": "internal server error",
                }))
        except Exception:
            pass
    finally:
        # ── Cleanup ──────────────────────────────────────────
        cancel_heartbeat.set()
        if heartbeat_task is not None:
            try:
                heartbeat_task.cancel()
                await heartbeat_task
            except Exception:
                pass

        # Only remove presence if this socket is still the registered one.
        # A second tab from the same user may have already replaced us.
        info = canvas_presence.get(user_id)
        if info and info["ws"] is ws:
            canvas_presence.pop(user_id, None)
            # Broadcast leave only if we were the active connection
            await _broadcast(canvas_id, {"type": "leave", "userId": user_id})

        # Do NOT delete canvas_locks/seq_counters — avoids race on
        # simultaneous disconnect and prevents seq reset mid-session.
