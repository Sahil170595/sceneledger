import type { Shape, Operation, ShapePatch } from "./types.ts";

/**
 * Apply an operation to a shapes array, returning a new array.
 */
export function applyOp(shapes: Shape[], op: Operation): Shape[] {
  switch (op.kind) {
    case "add":
      return [...shapes, op.shape];
    case "update":
      return shapes.map((s) =>
        s.id === op.shapeId ? { ...s, ...op.props } : s
      );
    case "delete":
      return shapes.filter((s) => s.id !== op.shapeId);
  }
}

/**
 * Build the reverse operation for undo.
 * For update ops, only captures the fields that were changed (field-level LWW).
 */
/**
 * Build the reverse operation for undo.
 * Returns null if the reverse cannot be constructed (e.g. shape already gone).
 * Callers must skip pushing to the undo stack when null is returned.
 */
export function reverseOp(op: Operation, shapes: Shape[]): Operation | null {
  switch (op.kind) {
    case "add":
      return { kind: "delete", shapeId: op.shape.id };

    case "delete": {
      const shape = shapes.find((s) => s.id === op.shapeId);
      if (!shape) {
        // Shape already gone — cannot build a valid reverse without a snapshot.
        return null;
      }
      return { kind: "add", shape: { ...shape } };
    }

    case "update": {
      const shape = shapes.find((s) => s.id === op.shapeId);
      if (!shape) {
        // Shape not found — reverse would be a no-op, skip undo entry.
        return null;
      }
      // Only capture the old values of fields that are being changed
      const reverseProps: ShapePatch = {};
      for (const key of Object.keys(op.props) as (keyof ShapePatch)[]) {
        if (op.props[key] !== undefined) {
          (reverseProps as Record<string, unknown>)[key] = shape[key];
        }
      }
      return { kind: "update", shapeId: op.shapeId, props: reverseProps };
    }
  }
}
