# Sceneledger tests

| Suite | Coverage |
|---|---|
| operations.test.ts | Immutable operations, missing targets, inverses and local round trips |
| canvasRenderer.test.ts | Shape hit testing, overlapping objects and resize handles |
| test_auth.py | Signup/login/me, duplicates, wrong credentials, invalid/missing tokens |
| test_canvas.py | Board lifecycle, membership filtering, invitations and isolation |
| test_ws.py | Access close codes, init, echoes, sequential seq, persistence, no-ops, two clients, cursors/presence |

From the repository root:
```bash
npm ci
npm test --workspace client -- --maxWorkers=1
npm exec --workspace client -- tsc --noEmit
```

Backend tests require an isolated PostgreSQL DB. Follow [SETUP.md](../SETUP.md), set SCENELEDGER_TEST_DATABASE_URL to a dedicated database ending _test, then from server:
```bash
python -m pytest tests -q -p no:cacheprovider
python -m ruff check --no-cache app tests
```

## Destructive fixtures

Autouse fixtures reset pool/rate limits and **TRUNCATE all application tables after each test**. Never use real user data. The release adds an explicit test URL/suffix guard before app import. Test users are synthetic.

HTTP uses httpx ASGITransport; WS uses Starlette TestClient. Tests invoke actual handlers and SQL, not a browser or deployed service.

## Limits of a passing result

Sequential seq does not prove ordered delivery with concurrent delayed broadcasts. The two-client case observes an ordinary add, not adversarial same-field convergence. The leave test permits WebSocketDisconnect/AssertionError as best-effort, so green does not certify reliable leave delivery.

Client tests do not mount CanvasPage or exercise real input/reconnect/StrictMode. Local undo arithmetic does not preserve later same-field remote edits. No historic performance results are carried forward. Fresh counts/outcomes belong in the release handoff, not production acceptance claims.

Release preparation ran 38 backend tests against an isolated PostgreSQL 16 database and 28 client tests with one Vitest worker; both passed, as did TypeScript checking. Existing local Python/Node runtimes were reused without installs. Ruff 0.16.2 reported 29 inherited issues under its isolated default rules; full lint is not claimed clean. No Docker application build, production build or browser acceptance run was performed.
