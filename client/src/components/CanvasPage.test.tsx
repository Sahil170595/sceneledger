import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement } from "react";
import type { ComponentProps, EffectCallback, ReactNode } from "react";
import CanvasPage from "./CanvasPage.tsx";
import Toolbar from "./Toolbar.tsx";
import { applyOp } from "../operations.ts";
import type { ClientMessage, Shape } from "../types.ts";

const lifecycle = vi.hoisted(() => ({ effects: [] as EffectCallback[] }));

// Run the real event callbacks and effect cleanups without a browser or DOM library.
// This harness does not simulate React reconciliation or browser input delivery.
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useRef: <T,>(initial: T) => ({ current: initial }),
  useState: <T,>(initial: T) => [initial, vi.fn()],
  useCallback: <T,>(callback: T) => callback,
  useEffect: (effect: EffectCallback) => lifecycle.effects.push(effect),
}));
vi.mock("../authStore.ts", () => ({ getStoredToken: () => "synthetic-token" }));
vi.mock("../api.ts", () => ({
  getCanvasDetail: async () => ({ shapes: [] }),
  ApiError: class extends Error {},
}));

const fixture: Shape = {
  id: "synthetic-rectangle", type: "rectangle", x: 10, y: 10,
  width: 100, height: 50, fill: "#3498db", stroke: "#000000", strokeWidth: 2,
};

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = Socket.OPEN;
  onmessage?: (event: { data: string }) => void;
  send = vi.fn<(data: string) => void>();
  close = () => { this.readyState = 3; };
  constructor() { Socket.instances.push(this); }
}

let cleanups: (() => void)[] = [];

function unmount() {
  for (const cleanup of cleanups.splice(0)) cleanup();
}

function mountCanvas() {
  const listeners = new Map<string, (event: MouseEvent) => void>();
  const surface = {
    style: {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    getContext: () => null,
    addEventListener: (name: string, handler: (event: MouseEvent) => void) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  let toolbar: ComponentProps<typeof Toolbar> | undefined;
  function attach(node: ReactNode): void {
    if (Array.isArray(node)) { node.forEach(attach); return; }
    if (!isValidElement<{ ref?: { current: unknown }; children?: ReactNode }>(node)) return;
    if (node.type === Toolbar) toolbar = node.props as ComponentProps<typeof Toolbar>;
    if (node.props.ref) node.props.ref.current = surface;
    attach(node.props.children);
  }
  attach(CanvasPage({ canvasId: "synthetic-board", onBack: vi.fn(), onLogout: vi.fn() }));
  for (const effect of lifecycle.effects) {
    const cleanup = effect();
    if (cleanup) cleanups.push(cleanup);
  }
  const socket = Socket.instances[0];
  socket.onmessage!({ data: JSON.stringify({ type: "init", shapes: [fixture], users: [], seq: 0 }) });
  listeners.get("mousedown")!({ clientX: 50, clientY: 30, preventDefault: vi.fn() } as unknown as MouseEvent);
  if (!toolbar) throw new Error("Toolbar callbacks were not found");
  const operations = () => socket.send.mock.calls.flatMap(([data]) => {
    const message = JSON.parse(data) as ClientMessage;
    return message.type === "op" ? [message.op] : [];
  });
  return { toolbar, operations, persisted: () => operations().reduce(applyOp, [fixture]) };
}

beforeEach(() => {
  vi.useFakeTimers();
  lifecycle.effects = [];
  Socket.instances = [];
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("window", {
    devicePixelRatio: 1, location: { protocol: "http:", host: "localhost" },
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  });
});

afterEach(() => {
  unmount();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("CanvasPage color debounce", () => {
  it.each(["fill-first", "stroke-first"])("persists both colors within 300 ms and supports undo/redo: %s", (order) => {
    const { toolbar, operations, persisted } = mountCanvas();
    const changes = order === "fill-first"
      ? [() => toolbar.onFillChange("#ff0000"), () => toolbar.onStrokeChange("#00ff00")]
      : [() => toolbar.onStrokeChange("#00ff00"), () => toolbar.onFillChange("#ff0000")];
    changes[0]();
    vi.advanceTimersByTime(100);
    changes[1]();
    vi.advanceTimersByTime(199);
    expect(operations()).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(operations()).toHaveLength(1);
    vi.advanceTimersByTime(100);
    expect(operations()).toHaveLength(2);
    expect(persisted()[0]).toMatchObject({ fill: "#ff0000", stroke: "#00ff00" });

    toolbar.onUndo();
    expect(persisted()[0]).toMatchObject(order === "fill-first"
      ? { fill: "#ff0000", stroke: fixture.stroke }
      : { fill: fixture.fill, stroke: "#00ff00" });
    toolbar.onUndo();
    expect(persisted()).toEqual([fixture]);
    toolbar.onRedo();
    toolbar.onRedo();
    expect(persisted()[0]).toMatchObject({ fill: "#ff0000", stroke: "#00ff00" });
  });

  it("coalesces a picker burst into one operation with the original undo value", () => {
    const { toolbar, operations, persisted } = mountCanvas();
    toolbar.onFillChange("#ff0000");
    vi.advanceTimersByTime(100);
    toolbar.onFillChange("#ffffff");
    vi.advanceTimersByTime(299);
    expect(operations()).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(operations()).toHaveLength(1);
    expect(persisted()[0].fill).toBe("#ffffff");
    toolbar.onUndo();
    expect(persisted()).toEqual([fixture]);
  });

  it("does not record a picker burst that returns to its original color", () => {
    const { toolbar, operations } = mountCanvas();
    toolbar.onFillChange("#ff0000");
    toolbar.onFillChange(fixture.fill);
    vi.advanceTimersByTime(300);
    expect(operations()).toHaveLength(0);
    toolbar.onUndo();
    expect(operations()).toHaveLength(0);
  });

  it("cancels every pending color timer on unmount", () => {
    const { toolbar, operations } = mountCanvas();
    toolbar.onFillChange("#ff0000");
    toolbar.onStrokeChange("#00ff00");
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(300);
    expect(operations()).toHaveLength(0);
  });
});
