# Sceneledger setup

Run commands from the **repository root** unless a directory change is shown. Tests delete application rows: never select a database containing useful data. Browser HTTP/WS URLs are same-origin; Vite proxies them to the backend.

## Compose development stack

```bash
docker compose up --build
```

Ports: PostgreSQL 5432, FastAPI 3001, Vite 5173. The schema init script runs once on an empty named volume. Do not reapply it to initialized tables; its DDL is not idempotent. docker compose down stops without deleting the data volume.

A fresh machine may download images/dependencies. This stack was not rebuilt during release preparation. The client image uses npm install in its client-only context rather than the root lockfile; native root npm ci provides lockfile-based frontend installation.

Defaults in [.env.example](.env.example) are **public local-development examples**, not production secrets. Native apps do not load this file automatically; export variables explicitly.

## Native backend/frontend, database in Compose

Terminal 1, from root:
```bash
docker compose up -d db
```

Compose applies schema to a fresh volume. An existing PostgreSQL installation instead needs a new empty database and one psql -f server/schema.sql invocation.

Terminal 2, from root (POSIX):
```bash
python -m venv .venv
. .venv/bin/activate
python -m pip install -e "./server[dev]"
export DATABASE_URL='postgres://whiteboard:whiteboard@localhost:5432/whiteboard'
export JWT_SECRET='dev-secret-do-not-use-in-prod'
cd server
python -m uvicorn app.main:app --reload --port 3001
```

PowerShell equivalent, from root:
```powershell
py -m venv .venv
. ./.venv/Scripts/Activate.ps1
python -m pip install -e './server[dev]'
$env:DATABASE_URL = 'postgres://whiteboard:whiteboard@localhost:5432/whiteboard'
$env:JWT_SECRET = 'dev-secret-do-not-use-in-prod'
Set-Location server
python -m uvicorn app.main:app --reload --port 3001
```

Terminal 3, from root:
```bash
npm ci
npm run dev --workspace client
```

Open http://localhost:5173. Install from the root workspace, not inside server. Native proxy targets default to localhost:3001. VITE_API_URL/VITE_WS_URL in the Vite process environment configure the proxy, not browser fetch bases.

## Isolated test database

Tests TRUNCATE all application tables. Use a new independent container with ephemeral storage, never a development volume.

POSIX, from root:
```bash
docker run --pull=never --rm -d --name sceneledger-test-db -e POSTGRES_USER=whiteboard -e POSTGRES_PASSWORD=whiteboard -e POSTGRES_DB=sceneledger_test -p 127.0.0.1:55439:5432 --tmpfs /var/lib/postgresql/data postgres:16
docker exec sceneledger-test-db pg_isready -U whiteboard -d sceneledger_test
# Repeat readiness until successful, then apply once:
docker exec -i sceneledger-test-db psql -U whiteboard -d sceneledger_test -v ON_ERROR_STOP=1 < server/schema.sql
export SCENELEDGER_TEST_DATABASE_URL='postgres://whiteboard:whiteboard@localhost:55439/sceneledger_test'
export JWT_SECRET='sceneledger-test-only-signing-key-not-for-production'
cd server
python -m pytest tests -q -p no:cacheprovider
cd ..
npm test --workspace client -- --maxWorkers=1
npm exec --workspace client -- tsc --noEmit
docker stop sceneledger-test-db
```

PowerShell: pipe Get-Content server/schema.sql into docker exec -i ... psql; set $env:SCENELEDGER_TEST_DATABASE_URL and $env:JWT_SECRET before entering server.

The release adds a test-only guard requiring SCENELEDGER_TEST_DATABASE_URL with a database name ending _test. It overrides DATABASE_URL before app import. This suffix is accident prevention, not a security boundary: the DB must be disposable. --pull=never requires a cached postgres:16 image; deliberately pull that public image first on a fresh machine.

JWT_SECRET must be set before startup because issuance reads it at import. See [deployment](docs/deployment.md) for production gaps.
