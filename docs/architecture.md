# Sceneledger architecture

```text
React + Canvas 2D
  HTTP /api/* and WebSocket /ws (same-origin browser URLs)
       |
Vite development proxy / a production reverse proxy you supply
       |
FastAPI, ONE Uvicorn worker
  auth.py / deps.py: signup, login, me, JWT checking
  canvas.py: board membership, invitations, owner deletion
  ws.py: shape writes/echoes, ephemeral cursors, heartbeat
       |
asyncpg --> PostgreSQL: users, canvases, canvas_members, shapes
```

There is no token-refresh endpoint. Tokens expire after 24 hours and are stored in browser localStorage. WS transport acceptance occurs before JWT/membership checking, but rejected connections receive no scene data or operation loop.

The renderer and operation helpers are separated from CanvasPage's input/network coordination. Shape/cursor state uses refs and requestAnimationFrame; controls/status use React state.

## State boundaries

PostgreSQL stores accounts, membership and current shapes, not an operation ledger. A reload is a snapshot, not event-log replay.

The process owns per-canvas mutation locks/seq counters, one presence/socket entry per user per canvas, and per-connection send locks/heartbeat tasks. All reset on restart. Browser undo/redo and pending ops are session-local.

## Concurrency tradeoff

One process serializes writes for a canvas. Updates change supplied whitelisted columns, so disjoint fields preserve one another and later serialized writes win for the same database field. No per-object version rejection, versionNonce, CRDT or OT exists.

Broadcast runs outside the mutation lock. Init is not an atomic snapshot/sequence stream, and clients do not enforce seq ordering. Network reordering, join/reconnect races and pending replay remain risks; arbitrary convergence is not guaranteed. Multiple workers have no shared locks or fan-out.

Inverse patches preserve unrelated fields, but same-field undo can overwrite newer remote work. Undoing creation deletes the object including subsequent edits.

## Development topology

Compose starts PostgreSQL 16, one Uvicorn process and Vite. Vite reads VITE_API_URL/VITE_WS_URL to configure its proxy: Compose uses the server service, native defaults use localhost. Browser paths remain relative.

See [protocol](websocket-protocol.md) and [deployment limits](deployment.md).
