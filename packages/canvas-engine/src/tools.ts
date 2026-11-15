import type { Point } from "./elements.js";

export type ToolPoint = {
  x: number;
  y: number;
  pressure: number;
  time: number;
};

export class PointerToolLifecycle {
  private pointerId: number | null = null;
  constructor(
    private canvas: HTMLCanvasElement,
    private handlers: {
      enabled?: () => boolean;
      down: (event: PointerEvent, point: ToolPoint) => void;
      move: (event: PointerEvent, point: ToolPoint) => void;
      up: (event: PointerEvent, point: ToolPoint) => void;
      cancel: () => void;
    },
    private toWorld: (x: number, y: number) => { x: number; y: number },
  ) {
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointercancel", this.onCancel);
    canvas.addEventListener("lostpointercapture", this.onCancel);
  }
  dispose() {
    this.cancel();
    this.canvas.removeEventListener("pointerdown", this.onDown);
    this.canvas.removeEventListener("pointermove", this.onMove);
    this.canvas.removeEventListener("pointerup", this.onUp);
    this.canvas.removeEventListener("pointercancel", this.onCancel);
    this.canvas.removeEventListener("lostpointercapture", this.onCancel);
  }
  private point(event: PointerEvent): ToolPoint {
    const p = this.toWorld(event.clientX, event.clientY);
    return {
      ...p,
      pressure:
        event.pointerType === "mouse"
          ? 0.5
          : Math.max(0.05, event.pressure || 0.5),
      time: event.timeStamp,
    };
  }
  private onDown = (event: PointerEvent) => {
    if (
      !event.isPrimary ||
      event.button !== 0 ||
      this.pointerId !== null ||
      this.handlers.enabled?.() === false
    )
      return;
    this.pointerId = event.pointerId;
    this.canvas.setPointerCapture(event.pointerId);
    this.handlers.down(event, this.point(event));
  };
  private onMove = (event: PointerEvent) => {
    if (event.pointerId !== this.pointerId) return;
    const samples = event.getCoalescedEvents?.() ?? [event];
    for (const sample of samples)
      this.handlers.move(sample, this.point(sample));
  };
  private onUp = (event: PointerEvent) => {
    if (event.pointerId !== this.pointerId) return;
    this.handlers.up(event, this.point(event));
    this.release();
  };
  private onCancel = (event: Event) => {
    const pointerId =
      "pointerId" in event ? (event as PointerEvent).pointerId : this.pointerId;
    if (pointerId === this.pointerId) this.cancel();
  };
  private cancel() {
    if (this.pointerId === null) return;
    this.handlers.cancel();
    this.release();
  }
  private release() {
    const id = this.pointerId;
    this.pointerId = null;
    if (id !== null && this.canvas.hasPointerCapture(id))
      this.canvas.releasePointerCapture(id);
  }
}

export class FreehandBuilder {
  private points: ToolPoint[] = [];
  private previousAt = 0;
  constructor(
    private zoom: () => number,
    private maxPoints = 8192,
  ) {}
  add(point: ToolPoint, pointerType: string) {
    const last = this.points.at(-1);
    let pressure = point.pressure;
    if (pointerType === "mouse" && last) {
      const speed =
        (Math.hypot(point.x - last.x, point.y - last.y) * this.zoom()) /
        Math.max(1, point.time - this.previousAt);
      pressure = Math.max(0.18, Math.min(0.72, 0.68 - speed * 0.08));
    }
    this.previousAt = point.time;
    if (
      last &&
      Math.hypot(point.x - last.x, point.y - last.y) <
        Math.max(0.25, 0.7 / this.zoom())
    )
      return;
    if (this.points.length >= this.maxPoints) return;
    this.points.push({ ...point, pressure });
  }
  getPoints(): Point[] {
    return simplify(
      this.points.map(({ x, y, pressure }) => ({ x, y, pressure })),
      Math.max(0.15, 0.35 / this.zoom()),
    );
  }
  getRawPoints(): Point[] {
    return this.points;
  }
  clear() {
    this.points.length = 0;
    this.previousAt = 0;
  }
}

export function simplify(points: Point[], tolerance: number) {
  if (points.length < 3) return points.slice();
  const radial: Point[] = [points[0]!];
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!,
      last = radial.at(-1)!;
    if (Math.hypot(p.x - last.x, p.y - last.y) >= tolerance) radial.push(p);
  }
  radial.push(points.at(-1)!);
  const keep = new Uint8Array(radial.length);
  keep[0] = keep[radial.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, radial.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let max = tolerance,
      index = -1;
    const p = radial[a]!,
      q = radial[b]!;
    for (let i = a + 1; i < b; i++) {
      const d = segmentDistance(radial[i]!, p, q);
      if (d > max) {
        max = d;
        index = i;
      }
    }
    if (index >= 0) {
      keep[index] = 1;
      stack.push([a, index], [index, b]);
    }
  }
  return radial.filter((_, i) => keep[i] === 1);
}

function segmentDistance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    l = dx * dx + dy * dy;
  if (!l) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function traceFreehand(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  width: number,
) {
  if (!points.length) return;
  const cached = freehandPaths.get(points);
  const path =
    cached?.length === points.length && cached.width === width
      ? cached.path
      : buildFreehandPath(points, width);
  freehandPaths.set(points, { length: points.length, width, path });
  ctx.fillStyle = ctx.strokeStyle;
  ctx.fill(path);
}

const freehandPaths = new WeakMap<
  Point[],
  { length: number; width: number; path: Path2D }
>();

function buildFreehandPath(points: Point[], width: number) {
  const path = new Path2D();
  if (points.length === 1) {
    path.arc(
      points[0]!.x,
      points[0]!.y,
      (width * (0.35 + (points[0]!.pressure ?? 0.5) * 0.65)) / 2,
      0,
      Math.PI * 2,
    );
    return path;
  }
  const left: Point[] = [],
    right: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!,
      before = points[Math.max(0, i - 1)]!,
      after = points[Math.min(points.length - 1, i + 1)]!,
      dx = after.x - before.x,
      dy = after.y - before.y,
      len = Math.hypot(dx, dy) || 1,
      r = (width * (0.35 + (p.pressure ?? 0.5) * 0.65)) / 2;
    left.push({ x: p.x - (dy / len) * r, y: p.y + (dx / len) * r });
    right.push({ x: p.x + (dy / len) * r, y: p.y - (dx / len) * r });
  }
  const outline = [...left, ...right.reverse()];
  path.moveTo(outline[0]!.x, outline[0]!.y);
  for (let i = 1; i < outline.length; i++) {
    const p = outline[i]!,
      next = outline[(i + 1) % outline.length]!;
    path.quadraticCurveTo(p.x, p.y, (p.x + next.x) / 2, (p.y + next.y) / 2);
  }
  path.closePath();
  for (const p of [points[0]!, points.at(-1)!]) {
    path.moveTo(p.x + (width * (0.35 + (p.pressure ?? 0.5) * 0.65)) / 2, p.y);
    path.arc(
      p.x,
      p.y,
      (width * (0.35 + (p.pressure ?? 0.5) * 0.65)) / 2,
      0,
      Math.PI * 2,
    );
  }
  return path;
}
