# Sceneledger data model

## Canonical storage

[server/schema.sql](../server/schema.sql) is the DDL. It creates pgcrypto for UUID generation, then four tables:

| Table | Fields and constraints |
|---|---|
| users | id UUID primary key/default; unique non-null username/email; password_hash; created_at |
| canvases | id UUID primary key/default; name; owner_id references users; created_at |
| canvas_members | composite primary key canvas_id/user_id; both references cascade on deletion |
| shapes | client UUID primary key; canvas_id reference/cascade; type; geometry; styling; optional text/font_size; created_at |

Shape geometry is x/y/width/height (double precision, default 0). Styling is fill (default empty), stroke (#000000), stroke_width (2), opacity (1), border_radius (0). There are no version, versionNonce, rotation or z-index columns. Shapes are queried in created_at/id order, not a persisted layering order.

Indices cover shapes.canvas_id and canvas_members.user_id. Deleting a board cascades its shapes/memberships. Deleting a user does not cascade owned boards: canvases.owner_id uses the default no-action behavior. The application has no account-deletion endpoint.

## Wire representation

Core Shape and ShapePatch definitions live in [client/src/types.ts](../client/src/types.ts) and [server/app/types.py](../server/app/types.py). Those static definitions cover identity, type, geometry, fill/stroke/strokeWidth and optional text/fontSize. Runtime renderer/SQL extensions also handle opacity/borderRadius, but the original static types omit them. TypedDicts and TypeScript annotations are not runtime JSON validators.

Identity/type are excluded from update SQL's column whitelist. Unknown fields are ignored by persistence; the original operation payload may still be echoed. See [protocol](websocket-protocol.md).

Wire names use camelCase:
- strokeWidth <-> stroke_width
- fontSize <-> font_size
- borderRadius <-> border_radius
- ownerId <-> owner_id, createdAt <-> created_at on board HTTP responses
- userId on membership/presence payloads

Optional null text/font size are omitted on load. HTTP canvas detail omits default opacity/radius values; WS init may include them. Default-equivalent payloads can therefore differ without changing stored state.

## Operations

```typescript
type Operation =
  | { kind: "add"; shape: Shape }
  | { kind: "update"; shapeId: string; props: ShapePatch }
  | { kind: "delete"; shapeId: string };
interface UndoEntry { forward: Operation; reverse: Operation; }
```

The database stores current state only. opId and seq correlate live operations; neither is stored as an event history. Deletion is a physical DELETE, not a tombstone. Undo re-add can restore a captured snapshot but cannot arbitrate intervening edits.

## Coordinates and render order

Coordinates use CSS pixels with top-left origin and positive Y downward. Rectangle/ellipse use bounding boxes. A line starts at (x,y) and ends at (x+width,y+height); line deltas may be negative. Text width is estimated on creation and recomputed locally by the renderer; font metrics are not automatically persisted.

The scene array determines ordinary drawing order, except the selected shape is lifted locally for interaction. No shared z-index contract is implemented.

## Persistent boundary

Persisted: accounts, boards, membership, current shapes.
Ephemeral: process seq, mutation locks, presence, cursors, client undo/redo and pending operations.

Consequently a fresh session can restore shapes but not reconstruct historical collaboration or a user's undo stack. The source release includes only schema and synthetic code-owned test fixtures, no real user database.
