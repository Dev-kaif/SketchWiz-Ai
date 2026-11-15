import type { CanvasElement } from "./elements.js";

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

function baseBoundsOf(element: CanvasElement): Bounds {
  let xs: number[];
  let ys: number[];
  switch (element.type) {
    case "rectangle":
    case "image":
      xs = [element.x, element.x + element.width];
      ys = [element.y, element.y + element.height];
      break;
    case "circle":
      xs = [element.x - element.radiusX, element.x + element.radiusX];
      ys = [element.y - element.radiusY, element.y + element.radiusY];
      break;
    case "line":
    case "arrow":
      xs = [element.x1, element.x2];
      ys = [element.y1, element.y2];
      break;
    case "triangle":
      xs = [element.x1, element.x2, element.x3];
      ys = [element.y1, element.y2, element.y3];
      break;
    case "freehand":
    case "eraser":
      xs = element.points.map((p) => p.x);
      ys = element.points.map((p) => p.y);
      if (!xs.length) xs = [0];
      if (!ys.length) ys = [0];
      break;
    case "text":
      xs = [
        element.x,
        element.x +
          Math.max(1, element.content.length * (element.strokeWidth ?? 3) * 5),
      ];
      ys = [element.y - (element.strokeWidth ?? 3) * 10, element.y];
      break;
    default: {
      const legacy = element as CanvasElement & { x?: number; y?: number };
      xs = [legacy.x ?? 0];
      ys = [legacy.y ?? 0];
    }
  }
  const pad =
    Math.max(
      element.strokeWidth ??
        ("size" in element ? element.size : undefined) ??
        0,
      1,
    ) / 2;
  return {
    minX: Math.min(...xs) - pad,
    minY: Math.min(...ys) - pad,
    maxX: Math.max(...xs) + pad,
    maxY: Math.max(...ys) + pad,
  };
}

export function boundsOf(element: CanvasElement): Bounds {
  const unrotated = baseBoundsOf(element);
  if (!element.rotation) return unrotated;
  const cx = (unrotated.minX + unrotated.maxX) / 2;
  const cy = (unrotated.minY + unrotated.maxY) / 2;
  const cos = Math.cos(element.rotation);
  const sin = Math.sin(element.rotation);
  const corners = [
    [unrotated.minX, unrotated.minY],
    [unrotated.maxX, unrotated.minY],
    [unrotated.maxX, unrotated.maxY],
    [unrotated.minX, unrotated.maxY],
  ].map(([x, y]) => ({
    x: cx + (x! - cx) * cos - (y! - cy) * sin,
    y: cy + (x! - cx) * sin + (y! - cy) * cos,
  }));
  return {
    minX: Math.min(...corners.map((p) => p.x)),
    minY: Math.min(...corners.map((p) => p.y)),
    maxX: Math.max(...corners.map((p) => p.x)),
    maxY: Math.max(...corners.map((p) => p.y)),
  };
}

export function intersects(a: Bounds, b: Bounds) {
  return (
    a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY
  );
}

export function hitTest(
  element: CanvasElement,
  x: number,
  y: number,
  tolerance = 6,
) {
  const original = baseBoundsOf(element);
  const rotation = element.rotation ?? 0;
  if (rotation) {
    const center = {
      x: (original.minX + original.maxX) / 2,
      y: (original.minY + original.maxY) / 2,
    };
    const dx = x - center.x,
      dy = y - center.y;
    const cos = Math.cos(-rotation),
      sin = Math.sin(-rotation);
    x = center.x + dx * cos - dy * sin;
    y = center.y + dx * sin + dy * cos;
  }
  if (
    x < original.minX - tolerance ||
    x > original.maxX + tolerance ||
    y < original.minY - tolerance ||
    y > original.maxY + tolerance
  )
    return false;
  const nearSegment = (
    a: { x: number; y: number },
    b: { x: number; y: number },
  ) => {
    const dx = b.x - a.x,
      dy = b.y - a.y,
      len = dx * dx + dy * dy;
    const t = len
      ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len))
      : 0;
    return (
      Math.hypot(x - a.x - t * dx, y - a.y - t * dy) <=
      tolerance + (element.strokeWidth ?? 1) / 2
    );
  };
  switch (element.type) {
    case "rectangle":
    case "image": {
      if (element.fillColor || element.type === "image") return true;
      const x1 = element.x,
        x2 = element.x + element.width,
        y1 = element.y,
        y2 = element.y + element.height;
      return (
        nearSegment({ x: x1, y: y1 }, { x: x2, y: y1 }) ||
        nearSegment({ x: x2, y: y1 }, { x: x2, y: y2 }) ||
        nearSegment({ x: x2, y: y2 }, { x: x1, y: y2 }) ||
        nearSegment({ x: x1, y: y2 }, { x: x1, y: y1 })
      );
    }
    case "circle": {
      const rx = Math.max(0.001, element.radiusX),
        ry = Math.max(0.001, element.radiusY);
      return (
        Math.abs(Math.hypot((x - element.x) / rx, (y - element.y) / ry) - 1) *
          Math.min(rx, ry) <=
        tolerance + (element.strokeWidth ?? 1) / 2
      );
    }
    case "line":
    case "arrow":
      return nearSegment(
        { x: element.x1, y: element.y1 },
        { x: element.x2, y: element.y2 },
      );
    case "triangle":
      return (
        nearSegment(
          { x: element.x1, y: element.y1 },
          { x: element.x2, y: element.y2 },
        ) ||
        nearSegment(
          { x: element.x2, y: element.y2 },
          { x: element.x3, y: element.y3 },
        ) ||
        nearSegment(
          { x: element.x3, y: element.y3 },
          { x: element.x1, y: element.y1 },
        )
      );
    case "freehand":
    case "eraser":
      return element.points.length === 1
        ? Math.hypot(x - element.points[0]!.x, y - element.points[0]!.y) <=
            tolerance +
              (element.strokeWidth ??
                ("size" in element ? (element.size ?? 1) : 1)) /
                2
        : element.points
            .slice(1)
            .some((p, i) => nearSegment(element.points[i]!, p));
    case "text":
      return true;
    default:
      return true;
  }
}
