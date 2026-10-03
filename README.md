# Sceneledger

A full-stack collaborative whiteboard: React canvas interaction, authenticated FastAPI HTTP/WebSocket sessions, and PostgreSQL shape persistence.

Sceneledger makes a small collaboration model inspectable. Users create a board, invite an existing account, draw rectangles, ellipses, lines or text, and send field patches through one WebSocket. The server writes current shape state before broadcasting successful operations. Presence and cursor positions stay ephemeral.

## Implemented capabilities

- Signup/login with bcrypt hashing and 24-hour HS256 JWTs; HTTP and WebSocket canvas-membership checks.
- Canvas creation, listing, opening, invitations by username/email, and owner-only deletion.
- Mouse drawing, selection, movement, resizing, deletion, fill/stroke color, opacity and text font size.
- Canvas 2D rendering with device-pixel-ratio scaling, geometry hit tests, selection handles and interpolated remote cursors.
- Optimistic operations, local undo/redo, operation echoes and bounded automatic reconnect attempts.
- PostgreSQL persistence for accounts, boards, memberships and current shapes.

This is a local-development application, not a production-hardened hosted service. Small synchronous groups are its design target, not a measured capacity or latency guarantee.

## Try it locally

Requirements: Docker Compose, or PostgreSQL 16 plus Python 3.12+ and Node.js 22+.

```bash
git clone https://github.com/Sahil170595/sceneledger.git
cd sceneledger
docker compose up --build
```

Open http://localhost:5173. Register two **synthetic** accounts in separate browser profiles, create a board in one, invite the other account, and open it in both. Draw a rectangle, move it from the other profile, then reload to inspect persisted state.

Compose uses Vite's development server and conspicuous local-only DB/JWT defaults, not a production deployment. See [SETUP.md](SETUP.md) for native execution from the correct directories, configuration and isolated tests.

## How collaboration actually works

1. The client emits `{type:"op", op, opId}` and applies it optimistically.
2. A **single server process** locks that canvas, writes the database mutation and assigns a process-local `seq` if a row was modified.
3. Broadcast occurs after releasing the canvas lock. The sender clears a pending operation on echo; update/delete echoes are reapplied, while an own add echo is skipped.
4. Reconnect loads a fresh snapshot, clears history/cursors, then resends unconfirmed operations with new operation IDs.

There is **no versionNonce, per-object version arbitration, CRDT, OT or durable operation ledger**. Updates change only supplied whitelisted fields. Later serialized writes win for the same database field; disjoint patches preserve other columns.

Sequence numbers describe server processing order, but the client does not buffer or reject out-of-order sequences. Snapshot loading and broadcasts are not one atomic stream. Arbitrary concurrent network schedules are **not guaranteed to converge**. Tests cover sequential ordering and ordinary two-client delivery, not a distributed-consistency proof.

Undo sends an ordinary inverse patch from local history. It preserves unrelated fields, but undoing fill can overwrite a teammate's later fill change; undoing creation deletes the shape even if another user moved it. Reconnect replay is not exactly-once: operation IDs are not deduplicated, and silent no-ops are not acknowledged. An unconfirmed add already in the reconnect snapshot can appear twice locally.

A separately authored [browser demo](https://chimeraforge.vercel.app/projects/product/collaborative-whiteboard) models this path and runs two concurrent same-field edits through every order they can take: six of eight leave a client disagreeing with the database, none when echoes are applied in sequence order. It also runs both undo cases above. It models the protocol; it does not run this server.

## Source map

| Area | Implementation |
|---|---|
| HTTP auth and membership | [auth.py](server/app/auth.py), [deps.py](server/app/deps.py), [canvas.py](server/app/canvas.py) |
| Persistence and sessions | [schema.sql](server/schema.sql), [db.py](server/app/db.py), [ws.py](server/app/ws.py) |
| Canvas interaction/reconnect | [CanvasPage.tsx](client/src/components/CanvasPage.tsx) |
| Geometry and drawing | [canvasRenderer.ts](client/src/canvasRenderer.ts) |
| Operations and inverses | [operations.ts](client/src/operations.ts) |
| Payload types | [types.ts](client/src/types.ts), [types.py](server/app/types.py) |

Read [architecture](docs/architecture.md), [protocol](docs/websocket-protocol.md), [data model](docs/data-model.md), [API](docs/api-reference.md), [frontend](docs/frontend-guide.md), [backend](docs/backend-guide.md) and [deployment limits](docs/deployment.md).

## Tests and evidence

```bash
# From root, after npm ci:
npm test --workspace client -- --maxWorkers=1
npm exec --workspace client -- tsc --noEmit
# Backend tests need an explicitly selected disposable DB.
# Follow SETUP.md first: fixtures TRUNCATE all application tables.
```

Client tests exercise immutable operation helpers, inverse round trips and hit tests. Server tests exercise auth, membership, HTTP board lifecycle, persistence, WebSocket echoes, sequential seq assignment, cursors and two-client delivery. The leave-presence test permits a best-effort failure, so green tests do not certify reliable disconnect notification. See [coverage and gaps](docs/tests.md).

No real user database, session dump, trace archive or credentials are distributed. Test users and examples are synthetic; dependency metadata uses public registries.

## Portfolio edition

The separate [browser-local edition](https://chimeraforge.vercel.app/work/projects/collaborative-whiteboard) demonstrates operation semantics without this FastAPI/PostgreSQL/WebSocket service. [Demo PR #60](https://github.com/Sahil170595/Banterblogs/pull/60) is pending merge at release preparation; the route is not presented as live. The currently public entry is [the work portfolio](https://chimeraforge.vercel.app/work).

## Boundaries

No offline editing guarantee, fine-grained roles, character-level text collaboration, media upload, PNG/SVG/PDF export, persisted undo, zoom/pan or touch-input implementation. The protocol can patch text content, but the UI creates text with a prompt, not an inline co-editor. Rotation and persistent z-index fields are absent.

Before internet-facing deployment: replace development credentials, add TLS and a production static frontend, bound/validate WebSocket messages, repair ordering/snapshot/replay races, protect tokens/logs, enforce membership revocation during sessions, and test multi-tab/concurrent/disconnect behavior. One active presence entry per user per canvas and process-local locks preclude horizontal-scaling claims.

## License

Apache-2.0. [LICENSE](LICENSE) is retained unchanged; [NOTICE](NOTICE) describes release modifications and dependency notice handling. Dependencies retain their respective licenses.
