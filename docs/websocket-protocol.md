# Sceneledger WebSocket protocol

## Connection

Connect to /ws?canvasId=<uuid>&token=<jwt>. The transport is accepted first, then JWT and canvas membership are checked. Missing/invalid/expired token or invalid UUID closes with 4001; non-membership closes with 4003. No scene data is sent to rejected clients. Query tokens need log redaction at any reverse proxy.

Init follows the current-shape query:
```json
{"type":"init","shapes":[],"users":[{"userId":"00000000-0000-4000-8000-000000000001","username":"synthetic-user","color":"#3498db"}],"seq":0}
```
All users/identifiers here are synthetic.

## Mutations

```json
{"type":"op","opId":"synthetic-op-1","op":{"kind":"add","shape":{"id":"00000000-0000-4000-8000-000000000002","type":"rectangle","x":10,"y":20,"width":100,"height":50,"fill":"#3498db","stroke":"#000000","strokeWidth":2}}}
{"type":"op","opId":"synthetic-op-2","op":{"kind":"update","shapeId":"00000000-0000-4000-8000-000000000002","props":{"fill":"#ef4444"}}}
{"type":"op","opId":"synthetic-op-3","op":{"kind":"delete","shapeId":"00000000-0000-4000-8000-000000000002"}}
```

Processing:
1. Lock the canvas within one process.
2. Execute parameterized INSERT/UPDATE/DELETE.
3. Increment process-local seq if a row was modified.
4. Release the lock.
5. Broadcast to registered users, including the sender.

```json
{"type":"op","opId":"synthetic-op-2","userId":"00000000-0000-4000-8000-000000000001","seq":2,"op":{"kind":"update","shapeId":"00000000-0000-4000-8000-000000000002","props":{"fill":"#ef4444"}}}
```

Add uses ON CONFLICT(id) DO NOTHING. Update/delete include both shape and canvas IDs. Unknown fields are ignored by DB whitelisting, but the **original submitted op** is broadcast, not a normalized authoritative row. A malformed patch with ignored fields can therefore affect another client's local representation. TypedDicts do not validate incoming JSON.

No-ops receive no acknowledgement or seq. An UPDATE to an existing row's current value still counts as modified. opId is correlation metadata, not server deduplication. Operations are not durably stored.

## Ordering limits

Seq increases for successful mutations processed in one server process and resets on restart. There is no object version/versionNonce. Later serialized writes determine the database value for a field; separate field patches preserve unsupplied columns.

Broadcast has no seq-ordered queue. Client seqRef is informational: no buffering, stale rejection or gap recovery. Init's shape query and seq read are not atomic. Strict delivery order, exactly-once replay and arbitrary client convergence are not guaranteed.

Per-connection send locks serialize writes. asyncio.gather starts fan-out concurrently, but the handler awaits all sends and has no send timeout or bounded outbound queue. A slow peer can delay completion and subsequent operations from that sender.

## Optimistic state and reconnect

The client applies locally and keeps each new UUID opId pending until echo. Own add echo is skipped; update/delete echoes and remote ops are applied in arrival order.

Init replaces the scene, clears history/cursors, then reapplies and resends unconfirmed operations with new IDs. sendOp refuses disconnected operations: this is not offline editing. Silent no-ops may remain pending. An add committed before a missed echo can already be in init; replay appends a duplicate locally, while the duplicate SQL insert is silently ignored.

Reconnect attempts use jittered backoff, up to 10 between successful transport opens. An open resets the count. Auth/access close codes are not retried; 4001 logs out.

## Undo

Inverse operations are ordinary new writes. Only captured changed fields are reversed. Undo of fill preserves stroke but can overwrite later fill; undo of creation deletes later moves. Delete undo re-adds a captured snapshot. No tombstones or causal undo log exists.

## Presence and heartbeat

```json
{"type":"cursor","x":120,"y":340}
{"type":"cursor","userId":"00000000-0000-4000-8000-000000000001","username":"synthetic-user","x":120,"y":340}
{"type":"join","user":{"userId":"00000000-0000-4000-8000-000000000001","username":"synthetic-user","color":"#3498db"}}
{"type":"leave","userId":"00000000-0000-4000-8000-000000000001"}
{"type":"ping"}
{"type":"pong"}
{"type":"error","message":"internal server error"}
```

Cursors/join go to other users. Cursor sends are throttled to 30ms, lerped at 0.15 per frame, and faded to opacity 0.3 after 5 seconds idle; fade is not disconnect detection. Presence has one entry per user, so a second tab replaces the registered socket.

The server sends JSON ping every 30 seconds, waits 10 seconds for pong, then closes on timeout. Heartbeat tasks are cancelled in cleanup. Presence/cursors/history/seq are ephemeral; only current shapes persist.

Membership is checked at connect, not per operation. WS size/rate/value validation is incomplete. Malformed JSON is ignored; some malformed structures error and end the session. See [deployment](deployment.md).
