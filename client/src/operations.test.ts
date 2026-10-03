import { describe, it, expect } from "vitest";
import type { Shape, Operation } from "./types.ts";
import { applyOp, reverseOp } from "./operations.ts";

const rect: Shape = {
  id: "s1",
  type: "rectangle",
  x: 10,
  y: 20,
  width: 100,
  height: 50,
  fill: "#ff0000",
  stroke: "#000000",
  strokeWidth: 2,
};

const ellipse: Shape = {
  id: "s2",
  type: "ellipse",
  x: 50,
  y: 60,
  width: 80,
  height: 40,
  fill: "#00ff00",
  stroke: "#000000",
  strokeWidth: 1,
};

describe("applyOp", () => {
  it("add appends a shape", () => {
    const result = applyOp([], { kind: "add", shape: rect });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("s1");
  });

  it("add does not mutate original array", () => {
    const original = [rect];
    const result = applyOp(original, { kind: "add", shape: ellipse });
    expect(result).toHaveLength(2);
    expect(original).toHaveLength(1);
  });

  it("update modifies only matching shape", () => {
    const shapes = [rect, ellipse];
    const result = applyOp(shapes, {
      kind: "update",
      shapeId: "s1",
      props: { x: 999 },
    });
    expect(result[0].x).toBe(999);
    expect(result[0].y).toBe(20); // unchanged
    expect(result[1].x).toBe(50); // other shape unchanged
  });

  it("update with non-existent id returns shapes unchanged", () => {
    const result = applyOp([rect], {
      kind: "update",
      shapeId: "nope",
      props: { x: 999 },
    });
    expect(result[0].x).toBe(10);
  });

  it("delete removes matching shape", () => {
    const result = applyOp([rect, ellipse], {
      kind: "delete",
      shapeId: "s1",
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("s2");
  });

  it("delete with non-existent id returns shapes unchanged", () => {
    const result = applyOp([rect], { kind: "delete", shapeId: "nope" });
    expect(result).toHaveLength(1);
  });
});

describe("reverseOp", () => {
  it("reverse of add is delete", () => {
    const rev = reverseOp({ kind: "add", shape: rect }, []);
    expect(rev).toEqual({ kind: "delete", shapeId: "s1" });
  });

  it("reverse of delete is add with snapshot", () => {
    const rev = reverseOp({ kind: "delete", shapeId: "s1" }, [rect]);
    expect(rev).not.toBeNull();
    expect(rev!.kind).toBe("add");
    if (rev!.kind === "add") {
      expect(rev!.shape.id).toBe("s1");
      expect(rev!.shape.x).toBe(10);
    }
  });

  it("reverse of delete returns null when shape is missing", () => {
    const rev = reverseOp({ kind: "delete", shapeId: "gone" }, [rect]);
    expect(rev).toBeNull();
  });

  it("reverse of delete makes a copy, not a reference", () => {
    const rev = reverseOp({ kind: "delete", shapeId: "s1" }, [rect]);
    expect(rev).not.toBeNull();
    if (rev && rev.kind === "add") {
      expect(rev.shape).not.toBe(rect); // different object
      expect(rev.shape).toEqual(rect); // same values
    }
  });

  it("reverse of update captures only changed fields", () => {
    const op: Operation = {
      kind: "update",
      shapeId: "s1",
      props: { fill: "#0000ff" },
    };
    const rev = reverseOp(op, [rect]);
    expect(rev).not.toBeNull();
    if (rev && rev.kind === "update") {
      expect(rev.props).toEqual({ fill: "#ff0000" }); // old value
      // Should NOT include x, y, width, etc
      expect(rev.props).not.toHaveProperty("x");
    }
  });

  it("reverse of update returns null when shape missing", () => {
    const op: Operation = {
      kind: "update",
      shapeId: "gone",
      props: { x: 100 },
    };
    const rev = reverseOp(op, [rect]);
    expect(rev).toBeNull();
  });

  it("reverse of multi-field update captures all changed fields", () => {
    const op: Operation = {
      kind: "update",
      shapeId: "s1",
      props: { x: 999, y: 888, fill: "#0000ff" },
    };
    const rev = reverseOp(op, [rect]);
    expect(rev).not.toBeNull();
    if (rev && rev.kind === "update") {
      expect(rev.props).toEqual({ x: 10, y: 20, fill: "#ff0000" });
    }
  });
});

describe("undo/redo round-trip", () => {
  it("add then undo restores original state", () => {
    const shapes: Shape[] = [];
    const addOp: Operation = { kind: "add", shape: rect };
    const rev = reverseOp(addOp, shapes);

    const afterAdd = applyOp(shapes, addOp);
    expect(afterAdd).toHaveLength(1);

    const afterUndo = applyOp(afterAdd, rev!);
    expect(afterUndo).toHaveLength(0);
  });

  it("delete then undo restores the shape", () => {
    const shapes = [rect];
    const deleteOp: Operation = { kind: "delete", shapeId: "s1" };
    const rev = reverseOp(deleteOp, shapes);

    const afterDelete = applyOp(shapes, deleteOp);
    expect(afterDelete).toHaveLength(0);

    const afterUndo = applyOp(afterDelete, rev!);
    expect(afterUndo).toHaveLength(1);
    expect(afterUndo[0]).toEqual(rect);
  });

  it("update then undo restores original values", () => {
    const shapes = [rect];
    const updateOp: Operation = {
      kind: "update",
      shapeId: "s1",
      props: { x: 500, fill: "#00ff00" },
    };
    const rev = reverseOp(updateOp, shapes);

    const afterUpdate = applyOp(shapes, updateOp);
    expect(afterUpdate[0].x).toBe(500);
    expect(afterUpdate[0].fill).toBe("#00ff00");

    const afterUndo = applyOp(afterUpdate, rev!);
    expect(afterUndo[0].x).toBe(10);
    expect(afterUndo[0].fill).toBe("#ff0000");
  });
});
