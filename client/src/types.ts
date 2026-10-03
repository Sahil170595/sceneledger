// Shared contract types - CANONICAL source of truth.
// Server mirrors these in server/app/types.py.
// Sceneledger release: deployment-instruction comment removed; payload types retained.

export type ShapeType = "rectangle" | "ellipse" | "line" | "text";

/**
 * All coordinates are in canvas pixels with a top-left origin.
 * Bounding-box model: (x, y) is the top-left corner.
 * For lines, (x, y) is the start point and (x + width, y + height) is the end point.
 */
export interface Shape {
  id: string;
  type: ShapeType;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  text?: string;
  fontSize?: number;
}

/**
 * Mutable shape fields. Shape identity and type are immutable after creation.
 */
export interface ShapeProps {
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  text?: string;
  fontSize?: number;
}

/**
 * Partial update payload used by update operations.
 */
export type ShapePatch = Partial<ShapeProps>;

export type Operation =
  | { kind: "add"; shape: Shape }
  | { kind: "update"; shapeId: string; props: ShapePatch }
  | { kind: "delete"; shapeId: string };

/**
 * Client maintains per-user undo and redo stacks.
 * Server does not have a separate undo concept; it only processes normal operations.
 */
export interface UndoEntry {
  forward: Operation;
  reverse: Operation;
}

export type ClientMessage =
  | { type: "op"; op: Operation; opId: string }
  | { type: "cursor"; x: number; y: number };

export type ServerMessage =
  | { type: "init"; shapes: Shape[]; users: PresenceUser[]; seq: number }
  | { type: "op"; op: Operation; userId: string; seq: number; opId: string }
  | { type: "cursor"; userId: string; username: string; x: number; y: number }
  | { type: "join"; user: PresenceUser }
  | { type: "leave"; userId: string }
  | { type: "error"; message: string };

export interface PresenceUser {
  userId: string;
  username: string;
  color: string;
}

export const CURSOR_PALETTE = [
  "#e74c3c",
  "#3498db",
  "#2ecc71",
  "#f39c12",
  "#9b59b6",
] as const;

export interface AuthUser {
  id: string;
  username: string;
  email: string;
}

export interface SignupRequest {
  username: string;
  email: string;
  password: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export interface CanvasSummary {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
}

export interface CanvasMember {
  userId: string;
  username: string;
}

export interface CanvasDetail extends CanvasSummary {
  shapes: Shape[];
  members: CanvasMember[];
}

export interface CreateCanvasRequest {
  name: string;
}

export interface InviteRequest {
  identifier: string;
}

export interface ErrorResponse {
  error: string;
}
