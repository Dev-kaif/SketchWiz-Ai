import type { CanvasElement, Point } from "./elements.js";
import { boundsOf, type Bounds } from "./geometry.js";

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
function pointSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    l = dx * dx + dy * dy;
  if (!l) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
function segmentDistance(a: Point, b: Point, c: Point, d: Point) {
  if (segmentsCross(a, b, c, d)) return 0;
  return Math.min(
    pointSegment(a, c, d),
    pointSegment(b, c, d),
    pointSegment(c, a, b),
    pointSegment(d, a, b),
  );
}
function orient(a: Point, b: Point, c: Point) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}
function segmentsCross(a: Point, b: Point, c: Point, d: Point) {
  const ab1 = orient(a, b, c),
    ab2 = orient(a, b, d),
    cd1 = orient(c, d, a),
    cd2 = orient(c, d, b);
  return (
    ab1 * ab2 <= 0 &&
    cd1 * cd2 <= 0 &&
    Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <=
      Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) &&
    Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <=
      Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y))
  );
}
function edges(points: Point[]) {
  return points.slice(1).map((p, i) => [points[i]!, p] as const);
}
function polygonContains(p: Point, poly: Point[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!,
      b = poly[j]!;
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}
function geometry(element: CanvasElement): {
  edges: readonly (readonly [Point, Point])[];
  polygon?: Point[];
  contains?: (p: Point) => boolean;
} {
  switch (element.type) {
    case "rectangle":
    case "image": {
      const p = [
        { x: element.x, y: element.y },
        { x: element.x + element.width, y: element.y },
        { x: element.x + element.width, y: element.y + element.height },
        { x: element.x, y: element.y + element.height },
      ];
      return { edges: [...edges([...p, p[0]!])], polygon: p };
    }
    case "line":
    case "arrow":
      return {
        edges: [
          [
            { x: element.x1, y: element.y1 },
            { x: element.x2, y: element.y2 },
          ],
        ],
      };
    case "triangle": {
      const p = [
        { x: element.x1, y: element.y1 },
        { x: element.x2, y: element.y2 },
        { x: element.x3, y: element.y3 },
      ];
      return { edges: edges([...p, p[0]!]), polygon: p };
    }
    case "circle": {
      const radiusX = Math.max(Math.abs(element.radiusX), 0.001);
      const radiusY = Math.max(Math.abs(element.radiusY), 0.001);
      const p = Array.from({ length: 33 }, (_, i) => ({
        x: element.x + radiusX * Math.cos((i * Math.PI * 2) / 32),
        y: element.y + radiusY * Math.sin((i * Math.PI * 2) / 32),
      }));
      return {
        edges: edges(p),
        contains: (q) =>
          ((q.x - element.x) / radiusX) ** 2 +
            ((q.y - element.y) / radiusY) ** 2 <=
          1,
      };
    }
    case "freehand":
    case "eraser":
      return {
        edges: edges(element.points),
        contains: (q) =>
          element.points.length === 1 &&
          distance(q, element.points[0]!) <=
            (element.strokeWidth ??
              ("size" in element ? element.size : undefined) ??
              1) /
              2,
      };
    case "text": {
      const b = boundsOf(element);
      const p = [
        { x: b.minX, y: b.minY },
        { x: b.maxX, y: b.minY },
        { x: b.maxX, y: b.maxY },
        { x: b.minX, y: b.maxY },
      ];
      return { edges: edges([...p, p[0]!]), polygon: p };
    }
    default: {
      const b = boundsOf(element);
      const p = [
        { x: b.minX, y: b.minY },
        { x: b.maxX, y: b.minY },
        { x: b.maxX, y: b.maxY },
        { x: b.minX, y: b.maxY },
      ];
      return { edges: edges([...p, p[0]!]), polygon: p };
    }
  }
}

export function sweptIntersects(
  element: CanvasElement,
  trajectory: Point[],
  radius: number,
): boolean {
  if (!trajectory.length) return false;
  const b = boundsOf(element),
    tb = pathBounds(trajectory, radius + (element.strokeWidth ?? 0) / 2);
  if (!overlap(b, tb)) return false;
  const shape = geometry(element),
    sweeps =
      trajectory.length === 1
        ? [[trajectory[0]!, trajectory[0]!] as const]
        : edges(trajectory);
  for (const p of trajectory)
    if (
      shape.contains?.(p) ||
      (shape.polygon && polygonContains(p, shape.polygon))
    )
      return true;
  const reach =
    radius +
    (element.strokeWidth ??
      ("size" in element ? element.size : undefined) ??
      0) /
      2;
  for (const [a, z] of sweeps)
    for (const [c, d] of shape.edges)
      if (segmentDistance(a, z, c, d) <= reach) return true;
  return false;
}

function pathBounds(points: Point[], pad: number): Bounds {
  return {
    minX: Math.min(...points.map((p) => p.x)) - pad,
    minY: Math.min(...points.map((p) => p.y)) - pad,
    maxX: Math.max(...points.map((p) => p.x)) + pad,
    maxY: Math.max(...points.map((p) => p.y)) + pad,
  };
}
function overlap(a: Bounds, b: Bounds) {
  return (
    a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY
  );
}
function pathDistance(p: Point, path: Point[]) {
  if (path.length === 1) return distance(p, path[0]!);
  let d = Infinity;
  for (const [a, b] of edges(path)) d = Math.min(d, pointSegment(p, a, b));
  return d;
}

/** Splits a stroke against the full swept eraser path, including fast pointer moves. */
export function splitFreehand(
  points: Point[],
  trajectory: Point[],
  eraserRadius: number,
  strokeWidth: number,
): Point[][] {
  if (!points.length) return [];
  const threshold = eraserRadius + strokeWidth / 2;
  const output: Point[][] = [];
  let current: Point[] = [];
  const append = (p: Point) => {
    if (!current.length || distance(current.at(-1)!, p) > 0.01) current.push(p);
  };
  const sample = (a: Point, b: Point, t: number) => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    pressure:
      (a.pressure ?? 0.5) + ((b.pressure ?? 0.5) - (a.pressure ?? 0.5)) * t,
  });
  if (points.length === 1)
    return pathDistance(points[0]!, trajectory) > threshold
      ? [[points[0]!]]
      : [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!,
      b = points[i]!,
      steps = Math.max(
        1,
        Math.ceil(distance(a, b) / Math.max(0.5, threshold * 0.45)),
      );
    for (let step = 0; step <= steps; step++) {
      const t = step / steps,
        p = sample(a, b, t),
        outside = pathDistance(p, trajectory) > threshold;
      if (outside) append(p);
      else if (current.length) {
        if (current.length >= 2) output.push(current);
        current = [];
      }
    }
    if (pathDistance(b, trajectory) <= threshold && current.length) {
      if (current.length >= 2) output.push(current);
      current = [];
    }
  }
  if (current.length >= 2) output.push(current);
  return output;
}
