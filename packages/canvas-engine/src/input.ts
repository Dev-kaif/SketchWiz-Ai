import type { Camera } from "./camera.js";

export type WorldPoint = { x: number; y: number };
export class CanvasInput {
  private spaceDown = false;
  private panning = false;
  private last = { x: 0, y: 0 };
  constructor(
    private canvas: HTMLCanvasElement,
    private camera: Camera,
    private handlers: {
      down?: (event: PointerEvent, world: WorldPoint) => void;
      move?: (event: PointerEvent, world: WorldPoint) => void;
      up?: (event: PointerEvent, world: WorldPoint) => void;
      change?: () => void;
    } = {},
  ) {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
  }
  dispose() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
  }
  private world(x: number, y: number) {
    const rect = this.canvas.getBoundingClientRect();
    return this.camera.screenToWorld(x - rect.left, y - rect.top);
  }
  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code === "Space") this.spaceDown = true;
  };
  private onKeyUp = (e: KeyboardEvent) => {
    if (e.code === "Space") this.spaceDown = false;
  };
  private onPointerDown = (e: PointerEvent) => {
    if (this.spaceDown || e.button === 1) {
      this.panning = true;
      this.last = { x: e.clientX, y: e.clientY };
      this.canvas.setPointerCapture(e.pointerId);
    }
    this.handlers.down?.(e, this.world(e.clientX, e.clientY));
  };
  private onPointerMove = (e: PointerEvent) => {
    if (this.panning) {
      this.camera.pan(e.clientX - this.last.x, e.clientY - this.last.y);
      this.last = { x: e.clientX, y: e.clientY };
      this.handlers.change?.();
    }
    this.handlers.move?.(e, this.world(e.clientX, e.clientY));
  };
  private onPointerUp = (e: PointerEvent) => {
    this.panning = false;
    this.handlers.up?.(e, this.world(e.clientX, e.clientY));
  };
  private onWheel = (e: WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    this.camera.zoomAt(
      e.clientX - rect.left,
      e.clientY - rect.top,
      Math.exp(-e.deltaY * 0.001),
    );
    this.handlers.change?.();
  };
}
