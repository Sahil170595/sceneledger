# Sceneledger frontend

App switches between Auth, CanvasList and keyed CanvasPage without a routing library. Auth calls api.ts and stores JWT/profile in localStorage; InvitePanel adds an existing account through HTTP.

## State and input

CanvasPage keeps scene, selection, drag, history, pending operations and cursors in refs; controls/history counts/status use React state. Refs let callbacks read the latest scene; no measured rendering-performance claim follows from this choice.

Its WebSocket effect creates/closes sockets. Cleanup clears the mounted guard, so StrictMode can still connect/close/connect in development. Reconnect and HTTP callbacks need lifecycle stress tests.

Mouse down starts selection/move/resize/draw; mouse move updates previews; mouse up sends an operation and captured inverse. Text is created with a prompt, not an inline editor. Font size can change, but no character-level co-editor exists.

Move/resize restores captured starting fields before sending the final optimistic patch; remote changes during drag are not rebased. Color commits are debounced. The server/renderer support borderRadius, but the UI has no radius control.

## Renderer and geometry

canvasRenderer.ts paints background/grid, unselected shapes, selected shape lifted on top, preview, handles and cursors. Device-pixel-ratio scaling keeps input coordinates in CSS pixels.

Rectangle/text use expanded bounding boxes, ellipse uses its equation, line uses distance to a segment. Handles are 8-pixel corner squares. Rotation and persistent z-index are absent; order is the scene array with selection lifted locally.

Text rendering measures width and changes local width/height for hit testing. It does not automatically persist these measurements, so local geometry may differ from the DB snapshot.

Opacity/borderRadius exist as runtime extensions but are omitted from original Shape/ShapePatch static types, resulting in casts. Type checking is not complete protocol validation.

## Operations/history

applyOp returns a new array. Add appends without ID deduplication. reverseOp captures old changed fields or a deleted snapshot; CanvasPage constructs its UI inverse entries directly.

Undo/redo are local session stacks, not causal or persisted history. New actions clear redo. Same-field undo can overwrite newer remote edits; undoing creation deletes subsequent edits. Unrelated fields are preserved.

## Network and presence

HTTP paths are relative; WS is constructed from the page's origin. VITE_API_URL/VITE_WS_URL configure Vite's proxy, not browser fetch bases.

Own add echoes are skipped; update/delete echoes and remote ops apply in arrival order. seqRef records values without ordering or gap recovery. Init replaces scene/history/cursors, then replays pending ops with new IDs. [Protocol](websocket-protocol.md) documents duplicate-add and no-op consequences.

Cursor sends are throttled to 30ms. An animation loop lerps by 0.15 and fades to 0.3 after 5 seconds idle. Leave removes the cursor; fading is not proof of liveness.

## Coverage

Editing is desktop mouse-based. Responsive layout does not implement touch/pointer editing. Client tests cover pure operations and geometry, not mounted components, auth journeys, reconnect or multiple tabs. No production browser acceptance is claimed by this release.
