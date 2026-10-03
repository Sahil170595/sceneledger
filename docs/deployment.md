# Sceneledger deployment boundaries

Compose is a **local-development stack**, not a production-ready deployment. [SETUP.md](../SETUP.md) contains commands.

| Service | Runtime | Host port |
|---|---|---|
| db | postgres:16-alpine, named pgdata | 5432 |
| server | Python 3.12 image, one Uvicorn worker | 3001 |
| client | Node 22 image, Vite dev server | 5173 |

Server waits for the DB pg_isready check. Schema initialization occurs once for an empty volume. Existing volumes need deliberate migrations, not deletion of live data. docker compose down retains pgdata.

Compose sets Vite proxy targets to the server service; native defaults target localhost:3001. Browser paths remain same-origin. Client Dockerfile uses npm install without the root workspace lockfile, so it is not a deterministic production build. Python dependencies also have ranges without a resolved lockfile.

Docker build/pull was not run during source release preparation. Cached PostgreSQL is sufficient for isolated handler/SQL tests.

## Public local-only defaults

| Variable | Native default |
|---|---|
| DATABASE_URL | postgres://whiteboard:whiteboard@localhost:5432/whiteboard |
| JWT_SECRET | dev-secret-do-not-use-in-prod |
| VITE_API_URL | http://localhost:3001 |
| VITE_WS_URL | ws://localhost:3001 |

[.env.example](../.env.example) contains public development examples, not secrets. Python does not load .env automatically; Compose supplies its own values. Never use these defaults for public hosting.

## Before production

- Supply a TLS reverse proxy/static frontend, not public Vite hosting.
- Replace development credentials, restrict network exposure and DB privilege, and set JWT_SECRET before import.
- Protect localStorage tokens against XSS and redact query tokens from logs. No refresh/revocation flow exists.
- Bound/validate WS messages, field values, identifiers, rates and connections. Column whitelists are not complete validation.
- Reauthorize membership during sessions; existing sockets are not checked per operation.
- Address delivery order, init races, pending replay and no-op acknowledgement; seq alone does not guarantee convergence.
- Use one worker unless shared locks/order/fan-out/presence are implemented. Qualify same-user tabs, backpressure, disconnect/reconnect.
- Add migrations, backup/recovery, DB restart qualification and logging. /health proves connectivity, not schema readiness; send/cleanup errors can be swallowed.

Tests do not certify throughput, availability, small-group capacity or long-session endurance. The intended usage context is a design target only.
