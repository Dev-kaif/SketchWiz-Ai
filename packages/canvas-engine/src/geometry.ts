import type { CanvasElement } from "./elements.js";

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

export function boundsOf(element: CanvasElement): Bounds {
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
  const pad = Math.max(element.strokeWidth ?? ("size" in element ? element.size : undefined) ?? 0, 1) / 2;
  return {
    minX: Math.min(...xs) - pad,
    minY: Math.min(...ys) - pad,
    maxX: Math.max(...xs) + pad,
    maxY: Math.max(...ys) + pad,
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
  const b = boundsOf(element);
  return (
    x >= b.minX - tolerance &&
    x <= b.maxX + tolerance &&
    y >= b.minY - tolerance &&
    y <= b.maxY + tolerance
  );
}
