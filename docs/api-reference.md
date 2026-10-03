# API Reference

All HTTP routes are prefixed with `/api`. All request and response bodies are JSON. Auth-protected routes require the header `Authorization: Bearer <token>`. Known route/HTTPException errors return `{ "error": "<code>" }`. Request validation uses FastAPI's default 422 detail payload; unexpected failures need not use this envelope.

---

## Authentication Endpoints

### POST /api/auth/signup

Register a new user account.

**Request body:**

```json
{
  "username": "alice",
  "email": "alice@example.com",
  "password": "s3cret"
}
```

**Success response (200):**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "username": "alice",
    "email": "alice@example.com"
  }
}
```

**Error responses:**

| Status | Body | Condition |
|--------|------|-----------|
| 409 | `{ "error": "username_taken" }` | Username already exists |
| 409 | `{ "error": "email_taken" }` | Email already exists |

**Implementation notes:** Password is hashed with bcrypt before storage. JWT is signed with HS256 using `JWT_SECRET`, expires in 24 hours. Payload includes `sub` (user UUID), `username`, `email`, and `exp`.

---

### POST /api/auth/login

Authenticate an existing user.

**Request body:**

```json
{
  "username": "alice",
  "password": "s3cret"
}
```

**Success response (200):**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "username": "alice",
    "email": "alice@example.com"
  }
}
```

**Error responses:**

| Status | Body | Condition |
|--------|------|-----------|
| 401 | `{ "error": "invalid_credentials" }` | Username not found or password mismatch |

**Implementation notes:** Lookup is by username only. The same error is returned whether the username does not exist or the password is wrong (avoids user enumeration).

---

### GET /api/auth/me

Return the authenticated user's profile. Requires `Authorization: Bearer <token>`.

**Success response (200):**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "username": "alice",
  "email": "alice@example.com"
}
```

**Error responses:**

| Status | Body | Condition |
|--------|------|-----------|
| 401 | `{ "error": "unauthorized" }` | Missing, expired, or invalid token |

---

## Canvas Endpoints

All canvas endpoints require `Authorization: Bearer <token>`.

### GET /api/canvases

List all canvases where the authenticated user is a member.

**Success response (200):**

```json
[
  {
    "id": "a1b2c3d4-...",
    "name": "Sprint Review Board",
    "ownerId": "550e8400-...",
    "createdAt": "2026-04-01T14:30:00+00:00"
  }
]
```

Returns an empty array `[]` if the user has no canvases. Ordered by `created_at DESC`.

---

### POST /api/canvases

Create a new canvas. The creator is automatically added as a member.

**Request body:**

```json
{
  "name": "Sprint Review Board"
}
```

**Success response (200):**

```json
{
  "id": "a1b2c3d4-...",
  "name": "Sprint Review Board",
  "ownerId": "550e8400-...",
  "createdAt": "2026-04-01T14:30:00+00:00"
}
```

**Implementation notes:** Canvas creation and membership insertion happen in a single database transaction.

---

### GET /api/canvases/{canvasId}

Get full canvas detail including shapes and members.

**Success response (200):**

```json
{
  "id": "a1b2c3d4-...",
  "name": "Sprint Review Board",
  "ownerId": "550e8400-...",
  "createdAt": "2026-04-01T14:30:00+00:00",
  "shapes": [
    {
      "id": "shape-uuid-...",
      "type": "rectangle",
      "x": 100,
      "y": 200,
      "width": 300,
      "height": 150,
      "fill": "#3498db",
      "stroke": "#000000",
      "strokeWidth": 2
    }
  ],
  "members": [
    {
      "userId": "550e8400-...",
      "username": "alice"
    }
  ]
}
```

**Error responses:**

| Status | Body | Condition |
|--------|------|-----------|
| 401 | `{ "error": "unauthorized" }` | Missing or invalid token |
| 403 | `{ "error": "not_a_member" }` | User is not a member of this canvas |
| 404 | `{ "error": "not_found" }` | Canvas does not exist (or invalid UUID) |

**Implementation notes:** Optional shape fields (`text`, `fontSize`) are omitted from the response when `null` in the database.

---

### POST /api/canvases/{canvasId}/invite

Invite a user to a canvas by username or email.

**Request body:**

```json
{
  "identifier": "bob"
}
```

The `identifier` field is matched against `username` first, then `email`.

**Success response (200):**

```json
{
  "ok": true
}
```

**Error responses:**

| Status | Body | Condition |
|--------|------|-----------|
| 401 | `{ "error": "unauthorized" }` | Missing or invalid token |
| 403 | `{ "error": "not_a_member" }` | Requester is not a member of this canvas |
| 404 | `{ "error": "canvas_not_found" }` | Canvas does not exist |
| 404 | `{ "error": "user_not_found" }` | No user matches the identifier |

**Implementation notes:** The invite is idempotent -- if the user is already a member, the `INSERT ... ON CONFLICT DO NOTHING` succeeds silently and `{ "ok": true }` is returned.

---

### DELETE /api/canvases/{canvasId}

Delete a canvas. Only the canvas owner may perform this action. Deleting a canvas cascades to remove all associated shapes and memberships (via foreign key `ON DELETE CASCADE`).

**Success response (200):**

```json
{
  "ok": true
}
```

**Error responses:**

| Status | Body | Condition |
|--------|------|-----------|
| 401 | `{ "error": "unauthorized" }` | Missing or invalid token |
| 403 | `{ "error": "not_owner" }` | Authenticated user is not the canvas owner |
| 404 | `{ "error": "not_found" }` | Canvas does not exist (or invalid UUID) |

**Implementation notes:** Ownership is checked by comparing `canvases.owner_id` against the authenticated user's ID. Non-owners who are members still receive 403 `not_owner`.

---

## WebSocket Protocol

### Connection

```
WS /ws?canvasId=<uuid>&token=<jwt>
```

The server calls `ws.accept()` first, then validates JWT and canvas membership before sending scene data or entering the operation loop. Rejected clients are closed with the codes below.

**Rejection close codes:**

| Code | Meaning |
|------|---------|
| 4001 | Auth failure (missing/invalid/expired token, missing canvasId) |
| 4003 | Not a member of the specified canvas |

### Client-to-Server Messages

#### `op` -- Board Operation

```json
{
  "type": "op",
  "op": {
    "kind": "add",
    "shape": {
      "id": "uuid",
      "type": "rectangle",
      "x": 100, "y": 200,
      "width": 300, "height": 150,
      "fill": "#3498db", "stroke": "#000000",
      "strokeWidth": 2
    }
  },
  "opId": "client-generated-uuidv4"
}
```

The `op` field is a discriminated union on `kind`:

| kind | Additional fields | DB action |
|------|-------------------|-----------|
| `"add"` | `shape: Shape` | `INSERT INTO shapes ... ON CONFLICT DO NOTHING` |
| `"update"` | `shapeId: string, props: ShapePatch` | `UPDATE shapes SET ... WHERE id = $N AND canvas_id = $M` |
| `"delete"` | `shapeId: string` | `DELETE FROM shapes WHERE id = $N AND canvas_id = $M` |

#### `cursor` -- Cursor Position

```json
{
  "type": "cursor",
  "x": 450.5,
  "y": 312.0
}
```

Coordinates are in canvas pixel space. Never persisted.

### Server-to-Client Messages

#### `init` -- Connection Initialization

Sent after JWT/membership checks and a database query. Contains a current-state snapshot, but the snapshot and seq read are not an atomic commit stream.

```json
{
  "type": "init",
  "shapes": [ ... ],
  "users": [
    { "userId": "uuid", "username": "alice", "color": "#e74c3c" }
  ],
  "seq": 42
}
```

| Field | Type | Description |
|-------|------|-------------|
| `shapes` | `Shape[]` | All shapes currently on the canvas |
| `users` | `PresenceUser[]` | All users currently connected to the canvas |
| `seq` | `number` | Current per-canvas sequence number |

#### `op` -- Operation Broadcast

Sent to ALL clients on the canvas (including the sender) after a successful op.

```json
{
  "type": "op",
  "op": { "kind": "update", "shapeId": "uuid", "props": { "x": 150 } },
  "userId": "sender-uuid",
  "seq": 43,
  "opId": "client-generated-uuidv4"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `op` | `Operation` | The operation that was applied |
| `userId` | `string` | UUID of the user who sent the op |
| `seq` | `number` | Monotonically increasing per-canvas sequence number |
| `opId` | `string` | Echoed from the client message, used for optimistic reconciliation |

#### `cursor` -- Remote Cursor Position

Sent to all clients EXCEPT the sender.

```json
{
  "type": "cursor",
  "userId": "uuid",
  "username": "alice",
  "x": 450.5,
  "y": 312.0
}
```

#### `join` -- User Connected

Broadcast to all OTHER clients when a new user connects.

```json
{
  "type": "join",
  "user": {
    "userId": "uuid",
    "username": "bob",
    "color": "#3498db"
  }
}
```

#### `leave` -- User Disconnected

Broadcast to remaining clients when a user disconnects.

```json
{
  "type": "leave",
  "userId": "uuid"
}
```

#### `error` -- Server Error

```json
{
  "type": "error",
  "message": "human-readable error text"
}
```

---

## Error Envelope

Known HTTP route and HTTPException error responses use the shape:

```json
{
  "error": "<snake_case_code>"
}
```

A global `HTTPException` handler in `main.py` converts those exceptions, not all errors. Missing/invalid request fields can return the default 422 validation detail; unexpected failures are not normalized by that handler. WebSocket errors use `{ "type": "error", "message": "<text>" }` instead.

### Known Route Error Codes

| Code | HTTP Status | Endpoint |
|------|-------------|----------|
| `unauthorized` | 401 | All auth-protected routes |
| `invalid_credentials` | 401 | POST /api/auth/login |
| `username_taken` | 409 | POST /api/auth/signup |
| `email_taken` | 409 | POST /api/auth/signup |
| `not_found` | 404 | GET /api/canvases/{id}, DELETE /api/canvases/{id} |
| `not_owner` | 403 | DELETE /api/canvases/{id} |
| `not_a_member` | 403 | GET /api/canvases/{id}, POST .../invite |
| `canvas_not_found` | 404 | POST .../invite |
| `user_not_found` | 404 | POST .../invite |
