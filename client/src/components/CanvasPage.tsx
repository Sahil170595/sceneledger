// Sceneledger release: independent color debounce timers with lifecycle cleanup.
import { useEffect, useRef, useCallback, useState } from "react";
import type {
  Shape,
  ShapeType,
  ShapePatch,
  Operation,
  UndoEntry,
  PresenceUser,
  ServerMessage,
  ClientMessage,
} from "../types.ts";
import { getStoredToken } from "../authStore.ts";
import { getCanvasDetail, ApiError } from "../api.ts";
import { renderScene, hitTest, hitTestHandle } from "../canvasRenderer.ts";
import type { CursorInfo } from "../canvasRenderer.ts";
import { applyOp } from "../operations.ts";
import Toolbar from "./Toolbar.tsx";
import type { Tool } from "./Toolbar.tsx";
import InvitePanel from "./InvitePanel.tsx";

interface CanvasPageProps {
  canvasId: string;
  onBack: () => void;
  onLogout: () => void;
}

// Interaction mode during mouse drag
type DragMode =
  | { kind: "none" }
  | { kind: "draw"; startX: number; startY: number; previewShape: Shape }
  | {
      kind: "move";
      shapeId: string;
      startX: number;
      startY: number;
      origX: number;
      origY: number;
    }
  | {
      kind: "resize";
      shapeId: string;
      corner: string;
      startX: number;
      startY: number;
      origX: number;
      origY: number;
      origW: number;
      origH: number;
    };

export default function CanvasPage({
  canvasId,
  onBack,
  onLogout,
}: CanvasPageProps) {
  // --- State stored in refs for high-frequency access ---
  const shapesRef = useRef<Shape[]>([]);
  const undoStackRef = useRef<UndoEntry[]>([]);
  const redoStackRef = useRef<UndoEntry[]>([]);
  const pendingOpsRef = useRef<Set<string>>(new Set());
  const pendingOpDataRef = useRef<Map<string, Operation>>(new Map());
  const cursorsRef = useRef<Map<string, CursorInfo>>(new Map());
  const onlineUsersRef = useRef<PresenceUser[]>([]);
  const selectedIdRef = useRef<string | null>(null);
  const dragModeRef = useRef<DragMode>({ kind: "none" });
  const wsRef = useRef<WebSocket | null>(null);
  const seqRef = useRef<number>(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastCursorSendRef = useRef<number>(0);
  const mountedRef = useRef(false);
  const wsInitReceivedRef = useRef(false);

  // --- React state for UI that needs re-renders ---
  const [currentTool, setCurrentTool] = useState<Tool>("select");
  const [fillColor, setFillColor] = useState("#3498db");
  const [strokeColor, setStrokeColor] = useState("#000000");
  const [opacity, setOpacity] = useState(1);
  const [fontSize, setFontSize] = useState(20);
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  const [onlineUsers, setOnlineUsers] = useState<PresenceUser[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [wsStatus, setWsStatus] = useState<"connected" | "disconnected" | "reconnecting">("disconnected");
  const [reconnectFailed, setReconnectFailed] = useState(false);
  const [error, setError] = useState("");

  // --- Reconnection state (refs to avoid stale closures) ---
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldReconnectRef = useRef(false);
  const connectWsFnRef = useRef<(() => void) | null>(null);

  // --- Cursor lerp state ---
  const cursorTargetsRef = useRef<Map<string, { x: number; y: number; timestamp: number }>>(new Map());
  const lerpAnimFrameRef = useRef<number>(0);

  // --- Rendering ---
  const scheduleRender = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    const selection = selectedIdRef.current
      ? {
          shapeId: selectedIdRef.current,
          handles: [],
        }
      : null;

    const drag = dragModeRef.current;
    const preview = drag.kind === "draw" ? drag.previewShape : null;

    renderScene(
      ctx,
      shapesRef.current,
      selection,
      cursorsRef.current,
      preview,
      rect.width,
      rect.height,
      dpr
    );
  }, []);

  const renderRef = useRef(scheduleRender);
  renderRef.current = scheduleRender;

  const requestRender = useCallback(() => {
    requestAnimationFrame(() => renderRef.current());
  }, []);

  // --- WebSocket Send Helpers ---
  const sendWs = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const sendOp = useCallback(
    (op: Operation) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return; // drop if not connected
      const opId = crypto.randomUUID();
      // Apply optimistically
      shapesRef.current = applyOp(shapesRef.current, op);
      pendingOpsRef.current.add(opId);
      pendingOpDataRef.current.set(opId, op);
      ws.send(JSON.stringify({ type: "op", op, opId } satisfies ClientMessage));
      requestRender();
    },
    [requestRender]
  );

  const doAction = useCallback(
    (forward: Operation, reverse: Operation) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return; // don't push undo for unsent ops
      undoStackRef.current = [...undoStackRef.current, { forward, reverse }];
      redoStackRef.current = [];
      setUndoCount(undoStackRef.current.length);
      setRedoCount(0);
      sendOp(forward);
    },
    [sendOp]
  );

  // --- Undo/Redo ---
  const undo = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return; // don't burn history while disconnected
    const stack = undoStackRef.current;
    if (stack.length === 0) return;
    const entry = stack[stack.length - 1];
    undoStackRef.current = stack.slice(0, -1);
    redoStackRef.current = [...redoStackRef.current, entry];
    setUndoCount(undoStackRef.current.length);
    setRedoCount(redoStackRef.current.length);
    sendOp(entry.reverse);
  }, [sendOp]);

  const redo = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return; // don't burn history while disconnected
    const stack = redoStackRef.current;
    if (stack.length === 0) return;
    const entry = stack[stack.length - 1];
    redoStackRef.current = stack.slice(0, -1);
    undoStackRef.current = [...undoStackRef.current, entry];
    setUndoCount(undoStackRef.current.length);
    setRedoCount(redoStackRef.current.length);
    sendOp(entry.forward);
  }, [sendOp]);

  // --- Color change for selected shape ---
  // Track the color before the picker opens for a single undo entry
  const colorBeforeRef = useRef<{ fill: string; stroke: string }>({ fill: "", stroke: "" });
  const fillTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const strokeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (fillTimerRef.current !== null) clearTimeout(fillTimerRef.current);
      if (strokeTimerRef.current !== null) clearTimeout(strokeTimerRef.current);
      fillTimerRef.current = null;
      strokeTimerRef.current = null;
      colorBeforeRef.current = { fill: "", stroke: "" };
    };
  }, [canvasId]);

  const handleFillChange = useCallback(
    (color: string) => {
      setFillColor(color);
      const selId = selectedIdRef.current;
      if (!selId) return;
      // Capture original color on first change of a drag
      if (!colorBeforeRef.current.fill) {
        const shape = shapesRef.current.find((s) => s.id === selId);
        if (shape) colorBeforeRef.current.fill = shape.fill;
      }
      // Apply visually immediately
      shapesRef.current = shapesRef.current.map((s) =>
        s.id === selId ? { ...s, fill: color } : s
      );
      requestRender();
      // Debounce: send one op after picker settles
      if (fillTimerRef.current !== null) clearTimeout(fillTimerRef.current);
      fillTimerRef.current = setTimeout(() => {
        fillTimerRef.current = null;
        const origFill = colorBeforeRef.current.fill;
        colorBeforeRef.current.fill = "";
        if (origFill && origFill !== color) {
          // Revert visual, then go through doAction for proper undo entry
          shapesRef.current = shapesRef.current.map((s) =>
            s.id === selId ? { ...s, fill: origFill } : s
          );
          doAction(
            { kind: "update", shapeId: selId, props: { fill: color } },
            { kind: "update", shapeId: selId, props: { fill: origFill } }
          );
        }
      }, 300);
    },
    [doAction, requestRender]
  );

  const handleStrokeChange = useCallback(
    (color: string) => {
      setStrokeColor(color);
      const selId = selectedIdRef.current;
      if (!selId) return;
      if (!colorBeforeRef.current.stroke) {
        const shape = shapesRef.current.find((s) => s.id === selId);
        if (shape) colorBeforeRef.current.stroke = shape.stroke;
      }
      shapesRef.current = shapesRef.current.map((s) =>
        s.id === selId ? { ...s, stroke: color } : s
      );
      requestRender();
      if (strokeTimerRef.current !== null) clearTimeout(strokeTimerRef.current);
      strokeTimerRef.current = setTimeout(() => {
        strokeTimerRef.current = null;
        const origStroke = colorBeforeRef.current.stroke;
        colorBeforeRef.current.stroke = "";
        if (origStroke && origStroke !== color) {
          shapesRef.current = shapesRef.current.map((s) =>
            s.id === selId ? { ...s, stroke: origStroke } : s
          );
          doAction(
            { kind: "update", shapeId: selId, props: { stroke: color } },
            { kind: "update", shapeId: selId, props: { stroke: origStroke } }
          );
        }
      }, 300);
    },
    [doAction, requestRender]
  );

  const handleOpacityChange = useCallback(
    (newOpacity: number) => {
      setOpacity(newOpacity);
      const selId = selectedIdRef.current;
      if (!selId) return;
      const shape = shapesRef.current.find((s) => s.id === selId);
      if (!shape) return;
      const oldOpacity = (shape as any).opacity ?? 1;
      if (oldOpacity === newOpacity) return;
      doAction(
        { kind: "update", shapeId: selId, props: { opacity: newOpacity } as any },
        { kind: "update", shapeId: selId, props: { opacity: oldOpacity } as any }
      );
    },
    [doAction]
  );

  // --- Canvas coordinate helper ---
  const getCanvasCoords = useCallback(
    (e: MouseEvent): { x: number; y: number } => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    },
    []
  );

  // --- Mouse Handlers ---
  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      e.preventDefault(); // prevent text selection during drag
      const { x, y } = getCanvasCoords(e);

      // Text tool: prompt for text and create shape
      if (currentTool === "text") {
        const text = prompt("Enter text:");
        if (!text) return;
        // fontSize comes from toolbar state
        const newShape: Shape = {
          id: crypto.randomUUID(),
          type: "text",
          x,
          y,
          width: text.length * fontSize * 0.6,
          height: fontSize,
          fill: fillColor,
          stroke: strokeColor,
          strokeWidth: 0,
          text,
          fontSize,
          ...(opacity !== 1 ? { opacity } : {}),
        } as Shape;
        const forward: Operation = { kind: "add", shape: newShape };
        const reverse: Operation = { kind: "delete", shapeId: newShape.id };
        doAction(forward, reverse);
        selectedIdRef.current = newShape.id;
        requestRender();
        return;
      }

      // Select tool: hit test
      if (currentTool === "select") {
        // Check if clicking on a resize handle of selected shape
        const selId = selectedIdRef.current;
        if (selId) {
          const selShape = shapesRef.current.find((s) => s.id === selId);
          if (selShape) {
            const corner = hitTestHandle(selShape, x, y);
            if (corner) {
              dragModeRef.current = {
                kind: "resize",
                shapeId: selId,
                corner,
                startX: x,
                startY: y,
                origX: selShape.x,
                origY: selShape.y,
                origW: selShape.width,
                origH: selShape.height,
              };
              return;
            }
          }
        }

        // Hit test shapes
        const hit = hitTest(shapesRef.current, x, y, selectedIdRef.current);
        if (hit) {
          selectedIdRef.current = hit.id;
          setOpacity((hit as any).opacity ?? 1);
          dragModeRef.current = {
            kind: "move",
            shapeId: hit.id,
            startX: x,
            startY: y,
            origX: hit.x,
            origY: hit.y,
          };
          requestRender();
        } else {
          selectedIdRef.current = null;
          setOpacity(1);
          dragModeRef.current = { kind: "none" };
          requestRender();
        }
        return;
      }

      // Drawing tools: start preview shape
      const shapeType = currentTool as ShapeType;
      const previewShape: Shape = {
        id: crypto.randomUUID(),
        type: shapeType,
        x,
        y,
        width: 0,
        height: 0,
        fill: shapeType === "line" ? "" : fillColor,
        stroke: strokeColor,
        strokeWidth: 2,
        ...(opacity !== 1 ? { opacity } : {}),
      } as Shape;
      dragModeRef.current = {
        kind: "draw",
        startX: x,
        startY: y,
        previewShape,
      };
      requestRender();
    },
    [currentTool, fillColor, strokeColor, opacity, getCanvasCoords, doAction, requestRender]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      const { x, y } = getCanvasCoords(e);

      // Send cursor position throttled
      const now = Date.now();
      if (now - lastCursorSendRef.current >= 30) {
        lastCursorSendRef.current = now;
        sendWs({ type: "cursor", x, y });
      }

      const drag = dragModeRef.current;

      if (drag.kind === "draw") {
        const dx = x - drag.startX;
        const dy = y - drag.startY;
        drag.previewShape = {
          ...drag.previewShape,
          x: dx < 0 ? drag.startX + dx : drag.startX,
          y: dy < 0 ? drag.startY + dy : drag.startY,
          width: Math.abs(dx),
          height: Math.abs(dy),
        };
        // For line, keep the original start and use delta as width/height
        if (drag.previewShape.type === "line") {
          drag.previewShape.x = drag.startX;
          drag.previewShape.y = drag.startY;
          drag.previewShape.width = dx;
          drag.previewShape.height = dy;
        }
        requestRender();
        return;
      }

      if (drag.kind === "move") {
        const dx = x - drag.startX;
        const dy = y - drag.startY;
        // Update local shape position for live preview (non-optimistic, just visual)
        shapesRef.current = shapesRef.current.map((s) =>
          s.id === drag.shapeId
            ? { ...s, x: drag.origX + dx, y: drag.origY + dy }
            : s
        );
        requestRender();
        return;
      }

      if (drag.kind === "resize") {
        const dx = x - drag.startX;
        const dy = y - drag.startY;
        let newX = drag.origX;
        let newY = drag.origY;
        let newW = drag.origW;
        let newH = drag.origH;

        if (drag.corner.includes("e")) {
          newW = drag.origW + dx;
        }
        if (drag.corner.includes("w")) {
          newX = drag.origX + dx;
          newW = drag.origW - dx;
        }
        if (drag.corner.includes("s")) {
          newH = drag.origH + dy;
        }
        if (drag.corner.includes("n")) {
          newY = drag.origY + dy;
          newH = drag.origH - dy;
        }

        // Normalize negative dimensions (drag crossed opposite edge)
        if (newW < 0) { newX += newW; newW = -newW; }
        if (newH < 0) { newY += newH; newH = -newH; }

        shapesRef.current = shapesRef.current.map((s) =>
          s.id === drag.shapeId
            ? { ...s, x: newX, y: newY, width: newW, height: newH }
            : s
        );
        requestRender();
        return;
      }
    },
    [getCanvasCoords, sendWs, requestRender]
  );

  const handleMouseUp = useCallback(
    (_e: MouseEvent) => {
      const drag = dragModeRef.current;

      if (drag.kind === "draw") {
        const shape = drag.previewShape;
        // Only add if shape has some size (or is a line with any length)
        if (
          Math.abs(shape.width) > 2 ||
          Math.abs(shape.height) > 2
        ) {
          const forward: Operation = { kind: "add", shape };
          const reverse: Operation = { kind: "delete", shapeId: shape.id };
          doAction(forward, reverse);
          selectedIdRef.current = shape.id;
        }
        dragModeRef.current = { kind: "none" };
        requestRender();
        return;
      }

      if (drag.kind === "move") {
        const shape = shapesRef.current.find((s) => s.id === drag.shapeId);
        if (shape && (shape.x !== drag.origX || shape.y !== drag.origY)) {
          // Revert local change, then do proper action through undo system
          shapesRef.current = shapesRef.current.map((s) =>
            s.id === drag.shapeId
              ? { ...s, x: drag.origX, y: drag.origY }
              : s
          );
          const forward: Operation = {
            kind: "update",
            shapeId: drag.shapeId,
            props: { x: shape.x, y: shape.y },
          };
          const reverse: Operation = {
            kind: "update",
            shapeId: drag.shapeId,
            props: { x: drag.origX, y: drag.origY },
          };
          doAction(forward, reverse);
        }
        dragModeRef.current = { kind: "none" };
        requestRender();
        return;
      }

      if (drag.kind === "resize") {
        const shape = shapesRef.current.find((s) => s.id === drag.shapeId);
        if (shape) {
          const newProps: ShapePatch = {
            x: shape.x,
            y: shape.y,
            width: shape.width,
            height: shape.height,
          };
          const oldProps: ShapePatch = {
            x: drag.origX,
            y: drag.origY,
            width: drag.origW,
            height: drag.origH,
          };
          // Revert local change, then go through undo system
          shapesRef.current = shapesRef.current.map((s) =>
            s.id === drag.shapeId
              ? { ...s, ...oldProps }
              : s
          );
          const forward: Operation = {
            kind: "update",
            shapeId: drag.shapeId,
            props: newProps,
          };
          const reverse: Operation = {
            kind: "update",
            shapeId: drag.shapeId,
            props: oldProps,
          };
          doAction(forward, reverse);
        }
        dragModeRef.current = { kind: "none" };
        requestRender();
        return;
      }
    },
    [doAction, requestRender]
  );

  // --- Keyboard Handlers ---
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Don't hijack shortcuts when typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;

      // Undo: Ctrl+Z (not Shift)
      if (e.ctrlKey && !e.shiftKey && e.key === "z") {
        e.preventDefault();
        undo();
        return;
      }
      // Redo: Ctrl+Shift+Z or Ctrl+Y
      if (
        (e.ctrlKey && e.shiftKey && e.key === "Z") ||
        (e.ctrlKey && e.key === "y")
      ) {
        e.preventDefault();
        redo();
        return;
      }
      // Delete selected shape
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        selectedIdRef.current
      ) {
        e.preventDefault();
        const shapeId = selectedIdRef.current;
        const shape = shapesRef.current.find((s) => s.id === shapeId);
        if (shape) {
          const forward: Operation = { kind: "delete", shapeId };
          const reverse: Operation = { kind: "add", shape: { ...shape } };
          selectedIdRef.current = null;
          doAction(forward, reverse);
          requestRender();
        }
        return;
      }
    },
    [undo, redo, doAction, requestRender]
  );

  // --- Canvas Resize ---
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    requestRender();
  }, [requestRender]);

  // --- WebSocket Connection with Reconnection ---
  useEffect(() => {
    // StrictMode double-mount guard
    if (mountedRef.current) return;
    mountedRef.current = true;

    const token = getStoredToken();
    if (!token) {
      onLogout();
      return;
    }

    // Load initial canvas data via HTTP as fallback — WS init takes precedence
    getCanvasDetail(canvasId)
      .then((detail) => {
        if (!wsInitReceivedRef.current) {
          shapesRef.current = detail.shapes;
          requestRender();
        }
      })
      .catch((err) => {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          setError("Access denied.");
        } else {
          setError("Failed to load canvas.");
        }
      });

    // Reconnection constants
    const MAX_RECONNECT_ATTEMPTS = 10;
    const BACKOFF_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000]; // cap at 30s

    function getBackoffDelay(attempt: number): number {
      const baseDelay = BACKOFF_DELAYS[Math.min(attempt, BACKOFF_DELAYS.length - 1)];
      // Jitter: delay * (0.5 + Math.random() * 0.5)
      return baseDelay * (0.5 + Math.random() * 0.5);
    }

    function connectWebSocket() {
      const currentToken = getStoredToken();
      if (!currentToken) {
        onLogout();
        return;
      }

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}/ws?canvasId=${canvasId}&token=${currentToken}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
        setWsStatus("connected");
        setReconnectFailed(false);
        reconnectAttemptRef.current = 0;
        shouldReconnectRef.current = true;
      };

      ws.onmessage = (event) => {
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(event.data) as Record<string, unknown>;
        } catch {
          return;
        }

        // Handle ping/pong before casting to ServerMessage (ping is not in the typed union)
        if (parsed.type === "ping") {
          const currentWs = wsRef.current;
          if (currentWs && currentWs.readyState === WebSocket.OPEN) {
            currentWs.send(JSON.stringify({ type: "pong" }));
          }
          return;
        }

        const msg = parsed as ServerMessage;

        switch (msg.type) {
          case "init": {
            wsInitReceivedRef.current = true;
            shapesRef.current = msg.shapes;
            seqRef.current = msg.seq;
            onlineUsersRef.current = msg.users;

            // Replay unconfirmed ops from previous session
            const unconfirmed = Array.from(pendingOpDataRef.current.values());

            // Clear stale state from previous session (C3+C4)
            undoStackRef.current = [];
            redoStackRef.current = [];
            pendingOpsRef.current.clear();
            pendingOpDataRef.current.clear();
            // Clear cursor lerp targets on reconnect
            cursorTargetsRef.current.clear();
            cursorsRef.current.clear();
            setUndoCount(0);
            setRedoCount(0);
            setOnlineUsers([...msg.users]);

            // Re-send unconfirmed ops with new opIds
            for (const op of unconfirmed) {
              const newOpId = crypto.randomUUID();
              shapesRef.current = applyOp(shapesRef.current, op);
              pendingOpsRef.current.add(newOpId);
              pendingOpDataRef.current.set(newOpId, op);
              const currentWs = wsRef.current;
              if (currentWs && currentWs.readyState === WebSocket.OPEN) {
                currentWs.send(JSON.stringify({ type: "op", op, opId: newOpId }));
              }
            }

            requestRender();
            break;
          }

          case "op": {
            const isOwnEcho = pendingOpsRef.current.has(msg.opId);
            if (isOwnEcho) {
              pendingOpsRef.current.delete(msg.opId);
              pendingOpDataRef.current.delete(msg.opId);
            }
            // For "add" ops that we sent: skip (shape already in array).
            // For "update"/"delete" ops: ALWAYS re-apply from server to
            // reflect each server echo in arrival order (seq is not enforced).
            if (isOwnEcho && msg.op.kind === "add") {
              // Already added optimistically — skip to avoid duplicate
            } else {
              shapesRef.current = applyOp(shapesRef.current, msg.op);
              requestRender();
            }
            seqRef.current = msg.seq;
            break;
          }

          case "cursor": {
            // Update cursor TARGET for lerp interpolation
            cursorTargetsRef.current.set(msg.userId, {
              x: msg.x,
              y: msg.y,
              timestamp: Date.now(),
            });
            // Ensure current cursor entry exists (first time)
            if (!cursorsRef.current.has(msg.userId)) {
              cursorsRef.current.set(msg.userId, {
                x: msg.x,
                y: msg.y,
                username: msg.username,
                color:
                  onlineUsersRef.current.find((u) => u.userId === msg.userId)
                    ?.color || "#999",
                opacity: 1,
              });
            } else {
              // Update metadata but NOT position (lerp loop handles position)
              const existing = cursorsRef.current.get(msg.userId)!;
              existing.username = msg.username;
              existing.color =
                onlineUsersRef.current.find((u) => u.userId === msg.userId)
                  ?.color || existing.color;
              existing.opacity = 1;
            }
            break;
          }

          case "join":
            onlineUsersRef.current = [
              ...onlineUsersRef.current.filter(
                (u) => u.userId !== msg.user.userId
              ),
              msg.user,
            ];
            setOnlineUsers([...onlineUsersRef.current]);
            break;

          case "leave":
            onlineUsersRef.current = onlineUsersRef.current.filter(
              (u) => u.userId !== msg.userId
            );
            setOnlineUsers([...onlineUsersRef.current]);
            cursorsRef.current.delete(msg.userId);
            cursorTargetsRef.current.delete(msg.userId);
            requestRender();
            break;

          case "error":
            setError(msg.message);
            break;
        }
      };

      ws.onclose = (event) => {
        setWsConnected(false);
        wsRef.current = null;

        // Auth failure or access denied — don't reconnect
        if (event.code === 4001 || event.code === 4003) {
          shouldReconnectRef.current = false;
          if (event.code === 4001) {
            onLogout();
          }
          return;
        }

        // Attempt reconnection — also retry if the very first connection failed
        if ((shouldReconnectRef.current || reconnectAttemptRef.current === 0) && mountedRef.current) {
          shouldReconnectRef.current = true; // ensure flag is set for subsequent attempts
          const attempt = reconnectAttemptRef.current;
          if (attempt < MAX_RECONNECT_ATTEMPTS) {
            setWsStatus("reconnecting");
            const delay = getBackoffDelay(attempt);
            reconnectAttemptRef.current = attempt + 1;
            reconnectTimerRef.current = setTimeout(() => {
              if (mountedRef.current) {
                connectWebSocket();
              }
            }, delay);
          } else {
            // Max attempts exceeded
            setWsStatus("disconnected");
            setReconnectFailed(true);
          }
        } else {
          setWsStatus("disconnected");
        }
      };

      ws.onerror = () => {
        // onclose will fire after onerror and handle reconnection
      };
    }

    connectWsFnRef.current = connectWebSocket;
    connectWebSocket();

    return () => {
      connectWsFnRef.current = null;
      mountedRef.current = false;
      shouldReconnectRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      const ws = wsRef.current;
      if (ws) {
        ws.close();
        wsRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasId]);

  // --- Manual reconnect handler ---
  const handleManualReconnect = useCallback(() => {
    reconnectAttemptRef.current = 0;
    setReconnectFailed(false);
    shouldReconnectRef.current = true;
    setWsStatus("reconnecting");

    if (connectWsFnRef.current) {
      connectWsFnRef.current();
    }
  }, []);

  // --- Cursor Lerp Animation Loop ---
  useEffect(() => {
    const LERP_FACTOR = 0.15;
    const FADE_AFTER_MS = 5000;
    const FADED_OPACITY = 0.3;

    let running = true;

    function lerpLoop() {
      if (!running) return;

      const now = Date.now();
      let needsRender = false;

      for (const [userId, target] of cursorTargetsRef.current) {
        const cursor = cursorsRef.current.get(userId);
        if (!cursor) continue;

        // Lerp position toward target
        const dx = target.x - cursor.x;
        const dy = target.y - cursor.y;
        if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
          cursor.x = cursor.x + dx * LERP_FACTOR;
          cursor.y = cursor.y + dy * LERP_FACTOR;
          needsRender = true;
        } else if (cursor.x !== target.x || cursor.y !== target.y) {
          cursor.x = target.x;
          cursor.y = target.y;
          needsRender = true;
        }

        // Fade opacity after no update for 5 seconds
        const age = now - target.timestamp;
        const desiredOpacity = age > FADE_AFTER_MS ? FADED_OPACITY : 1;
        if (cursor.opacity !== desiredOpacity) {
          cursor.opacity = desiredOpacity;
          needsRender = true;
        }
      }

      if (needsRender) {
        requestRender();
      }

      lerpAnimFrameRef.current = requestAnimationFrame(lerpLoop);
    }

    lerpAnimFrameRef.current = requestAnimationFrame(lerpLoop);

    return () => {
      running = false;
      cancelAnimationFrame(lerpAnimFrameRef.current);
    };
  }, [requestRender]);

  // --- Event Listeners ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.addEventListener("mousedown", handleMouseDown);
    canvas.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", resizeCanvas);

    // Initial size
    resizeCanvas();

    return () => {
      canvas.removeEventListener("mousedown", handleMouseDown);
      canvas.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", resizeCanvas);
    };
  }, [handleMouseDown, handleMouseMove, handleMouseUp, handleKeyDown, resizeCanvas]);

  // Cursor style based on tool
  const getCursorStyle = (): string => {
    if (currentTool === "select") return "default";
    if (currentTool === "text") return "text";
    return "crosshair";
  };

  return (
    <div
      style={{
        position: "relative",
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        fontFamily: "'DM Sans', system-ui, -apple-system, sans-serif",
      }}
    >
      <Toolbar
        currentTool={currentTool}
        onToolChange={setCurrentTool}
        fillColor={fillColor}
        strokeColor={strokeColor}
        onFillChange={handleFillChange}
        onStrokeChange={handleStrokeChange}
        opacity={opacity}
        onOpacityChange={handleOpacityChange}
        fontSize={fontSize}
        onFontSizeChange={(size: number) => {
          setFontSize(size);
          const selId = selectedIdRef.current;
          if (selId) {
            const shape = shapesRef.current.find((s) => s.id === selId);
            if (shape && shape.type === "text") {
              const oldSize = shape.fontSize || 20;
              doAction(
                { kind: "update", shapeId: selId, props: { fontSize: size } },
                { kind: "update", shapeId: selId, props: { fontSize: oldSize } }
              );
            }
          }
        }}
        canUndo={undoCount > 0}
        canRedo={redoCount > 0}
        onUndo={undo}
        onRedo={redo}
        onBack={onBack}
      />

      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
          position: "relative",
          background: "#f8f9fb",
          overflow: "hidden",
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            display: "block",
            cursor: getCursorStyle(),
          }}
        />
        <InvitePanel canvasId={canvasId} onlineUsers={onlineUsers} />

        {/* Connection status indicator */}
        <div
          style={{
            position: "absolute",
            bottom: 8,
            left: 8,
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            color:
              wsStatus === "connected"
                ? "#27ae60"
                : wsStatus === "reconnecting"
                ? "#f39c12"
                : "#e74c3c",
            background: "#fff",
            padding: "3px 8px",
            borderRadius: 4,
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background:
                wsStatus === "connected"
                  ? "#27ae60"
                  : wsStatus === "reconnecting"
                  ? "#f39c12"
                  : "#e74c3c",
            }}
          />
          {wsStatus === "connected"
            ? "Connected"
            : wsStatus === "reconnecting"
            ? "Reconnecting..."
            : "Disconnected"}
        </div>

        {/* Connection lost banner after max reconnect attempts */}
        {reconnectFailed && (
          <div
            onClick={handleManualReconnect}
            style={{
              position: "absolute",
              top: 8,
              left: "50%",
              transform: "translateX(-50%)",
              background: "#e74c3c",
              color: "#fff",
              padding: "8px 20px",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
              zIndex: 100,
            }}
          >
            Connection lost. Click to retry.
          </div>
        )}

        {error && (
          <div
            style={{
              position: "absolute",
              bottom: 8,
              right: 8,
              background: "#fef2f2",
              color: "#e74c3c",
              padding: "6px 12px",
              borderRadius: 4,
              fontSize: 12,
              boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
              cursor: "pointer",
            }}
            onClick={() => setError("")}
          >
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
