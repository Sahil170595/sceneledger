# Sceneledger backend

| Module | Responsibility |
|---|---|
| main.py | FastAPI instance, DB pool lifespan, CORS, HTTPException handler, /health and routers |
| auth.py | bcrypt signup/login, 24-hour HS256 tokens, IP/action attempt limiter |
| deps.py | HTTP Bearer JWT validation |
| canvas.py | Membership list/detail, transactional board creation, invite, owner deletion |
| db.py | Lazy module-global asyncpg pool (min 2, max 20) |
| ws.py | Shape SQL, process-local locking/seq, broadcasts, presence and heartbeat |
| types.py | Static TypedDict wire types, NOT runtime WS validators |

Run from server: python -m uvicorn app.main:app --port 3001.

## Configuration/auth

DATABASE_URL and JWT_SECRET come from process environment. Defaults are explicitly public local-development examples. Token issuance reads its secret at import; set values before launching. CORS allows http://localhost:5173.

No dotenv loader, refresh token, revocation store, password reset or production password policy exists. Auth attempts are limited per process by IP and action (20 per 60-second window). Request models establish string types without robust length bounds.

## Persistence

Canvas creation and creator membership share a transaction. Values/UUIDs use asyncpg parameters. Dynamic WS SQL interpolates only whitelisted column names. Update/delete include canvas ID. Current shapes persist, not mutation history.

HTTP routes acquire context-managed connections without the explicit 5-second acquire timeout used by health/WS. No guaranteed automatic recovery after DB restart is certified.

## Realtime limitations

The transport accepts before JWT/membership checks, then closes rejected clients without scene data. A canvas lock protects DB mutation/seq assignment, not delivery: broadcast is outside the lock and clients do not enforce sequences. Seq is not durable.

Concurrent send fan-out still awaits its slowest recipient. No bounded queue or deadline exists. Silent no-ops have no acknowledgement. Some send/cleanup errors are swallowed; there is no comprehensive structured audit log.

Use one worker. Presence/locks/counters are process-local; same-user tabs replace the presence entry. See [protocol](websocket-protocol.md) for init/replay/concurrency risks.

## Errors

Known HTTPException/route failures use an error-code envelope. Request validation still uses FastAPI's default 422 detail payload; unexpected failures are not guaranteed to use that envelope. /health queries SELECT 1, not schema readiness.

WS rejection uses 4001/4003; session exceptions may send generic internal-server-error. Malformed JSON/unsupported operations can be silently ignored. This documents actual behavior, not complete error-handling coverage.
