import type { Shape } from "./types.ts";

export interface CursorInfo {
  x: number;
  y: number;
  username: string;
  color: string;
  opacity?: number;
}

export interface SelectionState {
  shapeId: string;
  handles: { x: number; y: number; w: number; h: number }[];
}

const HANDLE_SIZE = 8;

export function renderScene(
  ctx: CanvasRenderingContext2D,
  shapes: Shape[],
  selection: SelectionState | null,
  cursors: Map<string, CursorInfo>,
  previewShape: Shape | null,
  canvasWidth: number,
  canvasHeight: number,
  dpr: number
): void {
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Background
  ctx.fillStyle = "#f8f9fb";
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // Dot grid
  ctx.fillStyle = "#d4d5db";
  const gridSpacing = 20;
  const dotSize = 1;
  for (let gx = gridSpacing; gx < canvasWidth; gx += gridSpacing) {
    for (let gy = gridSpacing; gy < canvasHeight; gy += gridSpacing) {
      ctx.fillRect(gx - dotSize / 2, gy - dotSize / 2, dotSize, dotSize);
    }
  }

  // Draw shapes with selected shape rendered last (on top) for visual "lift"
  const selectedShapeId = selection?.shapeId ?? null;
  let selectedShape: Shape | null = null;

  for (const shape of shapes) {
    if (shape.id === selectedShapeId) {
      selectedShape = shape;
      continue; // skip — will draw last
    }
    drawShape(ctx, shape);
  }

  // Draw selected shape on top of all others
  if (selectedShape) {
    drawShape(ctx, selectedShape);
  }

  // Draw preview shape
  if (previewShape) {
    drawShape(ctx, previewShape);
  }

  // Draw selection box over the (already-drawn) selected shape
  if (selection && selectedShape) {
    drawSelectionBox(ctx, selectedShape);
  }

  // Draw remote cursors
  for (const [, cursor] of cursors) {
    drawCursor(ctx, cursor);
  }

  ctx.restore();
}

function drawShape(ctx: CanvasRenderingContext2D, shape: Shape): void {
  ctx.save();
  ctx.globalAlpha = (shape as any).opacity ?? 1;
  ctx.fillStyle = shape.fill || "transparent";
  ctx.strokeStyle = shape.stroke || "#000000";
  ctx.lineWidth = shape.strokeWidth;

  switch (shape.type) {
    case "rectangle": {
      const br = (shape as any).borderRadius || 0;
      if (br > 0) {
        ctx.beginPath();
        ctx.roundRect(shape.x, shape.y, shape.width, shape.height, br);
        if (shape.fill) ctx.fill();
        ctx.stroke();
      } else {
        if (shape.fill) ctx.fillRect(shape.x, shape.y, shape.width, shape.height);
        ctx.strokeRect(shape.x, shape.y, shape.width, shape.height);
      }
      break;
    }

    case "ellipse": {
      const cx = shape.x + shape.width / 2;
      const cy = shape.y + shape.height / 2;
      const rx = Math.abs(shape.width / 2);
      const ry = Math.abs(shape.height / 2);
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      if (shape.fill) {
        ctx.fill();
      }
      ctx.stroke();
      break;
    }

    case "line":
      ctx.beginPath();
      ctx.moveTo(shape.x, shape.y);
      ctx.lineTo(shape.x + shape.width, shape.y + shape.height);
      ctx.stroke();
      break;

    case "text": {
      const fontSize = shape.fontSize || 16;
      ctx.font = `${fontSize}px sans-serif`;
      const measured = ctx.measureText(shape.text || "");
      // Update stored width to match actual rendered width for hit-testing
      shape.width = measured.width;
      shape.height = fontSize * 1.2; // line height
      ctx.fillStyle = shape.fill || "#000000";
      ctx.fillText(shape.text || "", shape.x, shape.y + fontSize);
      if (shape.stroke && shape.strokeWidth > 0) {
        ctx.strokeStyle = shape.stroke;
        ctx.lineWidth = shape.strokeWidth;
        ctx.strokeText(shape.text || "", shape.x, shape.y + fontSize);
      }
      break;
    }
  }

  ctx.restore();
}

function drawSelectionBox(ctx: CanvasRenderingContext2D, shape: Shape): void {
  ctx.save();
  ctx.strokeStyle = "#0088ff";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(shape.x - 2, shape.y - 2, shape.width + 4, shape.height + 4);
  ctx.setLineDash([]);

  // Draw handles at corners
  const handles = getHandlePositions(shape);
  ctx.fillStyle = "#0088ff";
  for (const h of handles) {
    ctx.fillRect(h.x, h.y, h.w, h.h);
  }

  ctx.restore();
}

export function getHandlePositions(
  shape: Shape
): { x: number; y: number; w: number; h: number; corner: string }[] {
  const hs = HANDLE_SIZE;
  const half = hs / 2;
  return [
    { x: shape.x - half - 2, y: shape.y - half - 2, w: hs, h: hs, corner: "nw" },
    { x: shape.x + shape.width - half + 2, y: shape.y - half - 2, w: hs, h: hs, corner: "ne" },
    { x: shape.x - half - 2, y: shape.y + shape.height - half + 2, w: hs, h: hs, corner: "sw" },
    {
      x: shape.x + shape.width - half + 2,
      y: shape.y + shape.height - half + 2,
      w: hs,
      h: hs,
      corner: "se",
    },
  ];
}

function drawCursor(ctx: CanvasRenderingContext2D, cursor: CursorInfo): void {
  ctx.save();
  ctx.globalAlpha = cursor.opacity ?? 1;

  // Draw cursor arrow
  ctx.fillStyle = cursor.color;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1;

  ctx.beginPath();
  ctx.moveTo(cursor.x, cursor.y);
  ctx.lineTo(cursor.x, cursor.y + 16);
  ctx.lineTo(cursor.x + 5, cursor.y + 12);
  ctx.lineTo(cursor.x + 10, cursor.y + 12);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Draw username label
  ctx.font = "11px sans-serif";
  const metrics = ctx.measureText(cursor.username);
  const labelX = cursor.x + 12;
  const labelY = cursor.y + 10;
  const padding = 3;

  ctx.fillStyle = cursor.color;
  const rx = labelX - padding;
  const ry2 = labelY - 10 - padding;
  const rw = metrics.width + padding * 2;
  const rh = 14 + padding * 2;
  const r = 3;
  ctx.beginPath();
  ctx.moveTo(rx + r, ry2);
  ctx.lineTo(rx + rw - r, ry2);
  ctx.arcTo(rx + rw, ry2, rx + rw, ry2 + r, r);
  ctx.lineTo(rx + rw, ry2 + rh - r);
  ctx.arcTo(rx + rw, ry2 + rh, rx + rw - r, ry2 + rh, r);
  ctx.lineTo(rx + r, ry2 + rh);
  ctx.arcTo(rx, ry2 + rh, rx, ry2 + rh - r, r);
  ctx.lineTo(rx, ry2 + r);
  ctx.arcTo(rx, ry2, rx + r, ry2, r);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.fillText(cursor.username, labelX, labelY);

  ctx.restore();
}

export function hitTest(shapes: Shape[], x: number, y: number, selectedId?: string | null): Shape | null {
  // Check selected shape first (it renders on top, so it should hit-test on top)
  if (selectedId) {
    const sel = shapes.find((s) => s.id === selectedId);
    if (sel && isPointInShape(sel, x, y)) return sel;
  }
  // Then reverse z-order for the rest
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    if (isPointInShape(s, x, y)) {
      return s;
    }
  }
  return null;
}

function isPointInShape(shape: Shape, px: number, py: number): boolean {
  const margin = 4;
  switch (shape.type) {
    case "rectangle":
    case "text":
      return (
        px >= shape.x - margin &&
        px <= shape.x + shape.width + margin &&
        py >= shape.y - margin &&
        py <= shape.y + shape.height + margin
      );

    case "ellipse": {
      const cx = shape.x + shape.width / 2;
      const cy = shape.y + shape.height / 2;
      const rx = Math.abs(shape.width / 2) + margin;
      const ry = Math.abs(shape.height / 2) + margin;
      if (rx === 0 || ry === 0) return false;
      const dx = px - cx;
      const dy = py - cy;
      return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1;
    }

    case "line": {
      // Check distance from point to line segment
      const x1 = shape.x;
      const y1 = shape.y;
      const x2 = shape.x + shape.width;
      const y2 = shape.y + shape.height;
      const dist = distToSegment(px, py, x1, y1, x2, y2);
      return dist <= shape.strokeWidth / 2 + margin + 4;
    }

    default:
      return false;
  }
}

function distToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
}

export function hitTestHandle(
  shape: Shape,
  x: number,
  y: number
): string | null {
  const handles = getHandlePositions(shape);
  for (const h of handles) {
    if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) {
      return h.corner;
    }
  }
  return null;
}
