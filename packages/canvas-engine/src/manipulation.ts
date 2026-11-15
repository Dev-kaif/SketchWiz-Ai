import type { CanvasElement, Point } from "./elements.js";
import { boundsOf, type Bounds } from "./geometry.js";

export type SelectionHandle =
  "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "rotate";

export function selectionBounds(elements: CanvasElement[]): Bounds | null {
  if (!elements.length) return null;
  const bounds = elements.map(boundsOf);
  return {
    minX: Math.min(...bounds.map((b) => b.minX)),
    minY: Math.min(...bounds.map((b) => b.minY)),
    maxX: Math.max(...bounds.map((b) => b.maxX)),
    maxY: Math.max(...bounds.map((b) => b.maxY)),
  };
}

export function selectionHandles(bounds: Bounds, zoom = 1) {
  const { minX, minY, maxX, maxY } = bounds;
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  const lift = 24 / Math.max(zoom, 0.01);
  return [
    { handle: "nw", x: minX, y: minY },
    { handle: "n", x: midX, y: minY },
    { handle: "ne", x: maxX, y: minY },
    { handle: "e", x: maxX, y: midY },
    { handle: "se", x: maxX, y: maxY },
    { handle: "s", x: midX, y: maxY },
    { handle: "sw", x: minX, y: maxY },
    { handle: "w", x: minX, y: midY },
    { handle: "rotate", x: midX, y: minY - lift },
  ] as const;
}

export function hitSelectionHandle(
  bounds: Bounds,
  point: Point,
  zoom = 1,
): SelectionHandle | null {
  const radius = 8 / Math.max(zoom, 0.01);
  const handles = selectionHandles(bounds, zoom);
  for (const { handle, x, y } of handles)
    if (Math.abs(point.x - x) <= radius && Math.abs(point.y - y) <= radius)
      return handle;
  return null;
}

export function translateElement(
  element: CanvasElement,
  dx: number,
  dy: number,
): CanvasElement {
  const copy = structuredClone(element);
  if ("points" in copy) {
    copy.points = copy.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));
  } else if ("x1" in copy && "x2" in copy && !("x3" in copy)) {
    copy.x1 += dx;
    copy.x2 += dx;
    copy.y1 += dy;
    copy.y2 += dy;
  } else if ("x3" in copy) {
    copy.x1 += dx;
    copy.x2 += dx;
    copy.x3 += dx;
    copy.y1 += dy;
    copy.y2 += dy;
    copy.y3 += dy;
  } else {
    copy.x = (copy.x ?? 0) + dx;
    copy.y = (copy.y ?? 0) + dy;
  }
  return copy;
}

export function resizeElement(
  element: CanvasElement,
  before: Bounds,
  after: Bounds,
): CanvasElement {
  const sx =
    (after.maxX - after.minX) / Math.max(0.0001, before.maxX - before.minX);
  const sy =
    (after.maxY - after.minY) / Math.max(0.0001, before.maxY - before.minY);
  const map = (x: number, y: number) => ({
    x: after.minX + (x - before.minX) * sx,
    y: after.minY + (y - before.minY) * sy,
  });
  const copy = structuredClone(element);
  if ("points" in copy) {
    copy.points = copy.points.map((p) => ({ ...p, ...map(p.x, p.y) }));
  } else if ("x1" in copy && "x2" in copy && !("x3" in copy)) {
    const a = map(copy.x1, copy.y1),
      b = map(copy.x2, copy.y2);
    copy.x1 = a.x;
    copy.y1 = a.y;
    copy.x2 = b.x;
    copy.y2 = b.y;
  } else if ("x3" in copy) {
    const a = map(copy.x1, copy.y1),
      b = map(copy.x2, copy.y2),
      c = map(copy.x3, copy.y3);
    copy.x1 = a.x;
    copy.y1 = a.y;
    copy.x2 = b.x;
    copy.y2 = b.y;
    copy.x3 = c.x;
    copy.y3 = c.y;
  } else if (copy.type === "circle") {
    const center = map(copy.x ?? 0, copy.y ?? 0);
    copy.x = center.x;
    copy.y = center.y;
    copy.radiusX *= Math.abs(sx);
    copy.radiusY *= Math.abs(sy);
  } else if (copy.type === "rectangle" || copy.type === "image") {
    const x = copy.x ?? 0;
    const y = copy.y ?? 0;
    const width = copy.width ?? 0;
    const height = copy.height ?? 0;
    const a = map(x, y),
      b = map(x + width, y + height);
    copy.x = Math.min(a.x, b.x);
    copy.y = Math.min(a.y, b.y);
    copy.width = Math.abs(b.x - a.x);
    copy.height = Math.abs(b.y - a.y);
  } else {
    const point = map(element.x ?? 0, element.y ?? 0);
    copy.x = point.x;
    copy.y = point.y;
    if (copy.type === "text")
      copy.strokeWidth =
        (copy.strokeWidth ?? 1) * Math.max(Math.abs(sx), Math.abs(sy));
  }
  return copy;
}

export function rotateElement(
  element: CanvasElement,
  center: Point,
  radians: number,
): CanvasElement {
  const b = boundsOf(element);
  const ownCenter = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  const dx = ownCenter.x - center.x,
    dy = ownCenter.y - center.y;
  const c = Math.cos(radians),
    s = Math.sin(radians);
  const nextCenter = {
    x: center.x + dx * c - dy * s,
    y: center.y + dx * s + dy * c,
  };
  const copy = translateElement(
    element,
    nextCenter.x - ownCenter.x,
    nextCenter.y - ownCenter.y,
  );
  copy.rotation = (copy.rotation ?? 0) + radians;
  return copy;
}

export type ElementChange = {
  id: string;
  before: CanvasElement | null;
  after: CanvasElement | null;
};
export type HistoryEntry = { label: string; changes: ElementChange[] };

/** Bounded operation history; callers commit entries only after server acknowledgement. */
export class CommandHistory {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  constructor(private readonly limit = 100) {}
  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }
  push(entry: HistoryEntry) {
    if (!entry.changes.length) return;
    this.undoStack.push(entry);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }
  takeUndo() {
    return this.undoStack.pop() ?? null;
  }
  takeRedo() {
    return this.redoStack.pop() ?? null;
  }
  commitUndo(entry: HistoryEntry) {
    this.redoStack.push(entry);
  }
  commitRedo(entry: HistoryEntry) {
    this.undoStack.push(entry);
  }
  invalidate(ids: Iterable<string>) {
    const touched = new Set(ids);
    this.undoStack = this.undoStack.filter(
      (entry) => !entry.changes.some((change) => touched.has(change.id)),
    );
    this.redoStack = this.redoStack.filter(
      (entry) => !entry.changes.some((change) => touched.has(change.id)),
    );
  }
  restoreUndo(entry: HistoryEntry) {
    this.undoStack.push(entry);
  }
  restoreRedo(entry: HistoryEntry) {
    this.redoStack.push(entry);
  }
}
