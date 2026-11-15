import type { Bounds } from "./geometry.js";

export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  constructor(
    public minZoom = 0.05,
    public maxZoom = 64,
  ) {}
  screenToWorld(x: number, y: number) {
    return { x: (x - this.x) / this.zoom, y: (y - this.y) / this.zoom };
  }
  worldToScreen(x: number, y: number) {
    return { x: x * this.zoom + this.x, y: y * this.zoom + this.y };
  }
  pan(dx: number, dy: number) {
    this.x += dx;
    this.y += dy;
  }
  zoomAt(screenX: number, screenY: number, factor: number) {
    const world = this.screenToWorld(screenX, screenY);
    this.zoom = Math.max(
      this.minZoom,
      Math.min(this.maxZoom, this.zoom * factor),
    );
    this.x = screenX - world.x * this.zoom;
    this.y = screenY - world.y * this.zoom;
  }
  viewport(width: number, height: number): Bounds {
    const a = this.screenToWorld(0, 0);
    const b = this.screenToWorld(width, height);
    return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
  }
}
