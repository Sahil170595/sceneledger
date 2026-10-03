import { describe, it, expect } from "vitest";
import type { Shape } from "./types.ts";
import { hitTest, hitTestHandle, getHandlePositions } from "./canvasRenderer.ts";

const rect: Shape = {
  id: "r1",
  type: "rectangle",
  x: 100,
  y: 100,
  width: 200,
  height: 100,
  fill: "#ff0000",
  stroke: "#000000",
  strokeWidth: 2,
};

const ellipse: Shape = {
  id: "e1",
  type: "ellipse",
  x: 400,
  y: 400,
  width: 100,
  height: 60,
  fill: "#00ff00",
  stroke: "#000000",
  strokeWidth: 2,
};

const line: Shape = {
  id: "l1",
  type: "line",
  x: 10,
  y: 10,
  width: 100,
  height: 0, // horizontal line
  fill: "",
  stroke: "#000000",
  strokeWidth: 4,
};

describe("hitTest", () => {
  it("returns shape when point is inside rectangle", () => {
    const hit = hitTest([rect], 150, 150);
    expect(hit).not.toBeNull();
    expect(hit!.id).toBe("r1");
  });

  it("returns null when point is outside all shapes", () => {
    const hit = hitTest([rect], 0, 0);
    expect(hit).toBeNull();
  });

  it("returns topmost shape (last in array) for overlapping", () => {
    const overlapping: Shape = {
      ...rect,
      id: "r2",
      x: 150,
      y: 100,
      width: 200,
      height: 100,
    };
    // r2 is later in array = on top
    const hit = hitTest([rect, overlapping], 200, 150);
    expect(hit!.id).toBe("r2");
  });

  it("hits ellipse using elliptical bounds", () => {
    const cx = 400 + 100 / 2; // 450
    const cy = 400 + 60 / 2; // 430
    const hit = hitTest([ellipse], cx, cy);
    expect(hit!.id).toBe("e1");
  });

  it("misses ellipse outside bounds", () => {
    // Corner of bounding box is outside ellipse
    const hit = hitTest([ellipse], 400, 400);
    expect(hit).toBeNull();
  });

  it("hits line within stroke tolerance", () => {
    // Point on the line at (50, 10)
    const hit = hitTest([line], 50, 10);
    expect(hit!.id).toBe("l1");
  });

  it("misses line when far away", () => {
    const hit = hitTest([line], 50, 50);
    expect(hit).toBeNull();
  });

  it("returns null for empty shapes array", () => {
    expect(hitTest([], 100, 100)).toBeNull();
  });
});

describe("getHandlePositions", () => {
  it("returns 4 handles for a shape", () => {
    const handles = getHandlePositions(rect);
    expect(handles).toHaveLength(4);
    const corners = handles.map((h) => h.corner);
    expect(corners).toContain("nw");
    expect(corners).toContain("ne");
    expect(corners).toContain("sw");
    expect(corners).toContain("se");
  });
});

describe("hitTestHandle", () => {
  it("detects NW handle", () => {
    const handles = getHandlePositions(rect);
    const nw = handles.find((h) => h.corner === "nw")!;
    const cx = nw.x + nw.w / 2;
    const cy = nw.y + nw.h / 2;
    expect(hitTestHandle(rect, cx, cy)).toBe("nw");
  });

  it("detects SE handle", () => {
    const handles = getHandlePositions(rect);
    const se = handles.find((h) => h.corner === "se")!;
    const cx = se.x + se.w / 2;
    const cy = se.y + se.h / 2;
    expect(hitTestHandle(rect, cx, cy)).toBe("se");
  });

  it("returns null when not on any handle", () => {
    expect(hitTestHandle(rect, 150, 150)).toBeNull();
  });
});
