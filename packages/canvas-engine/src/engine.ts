import { Camera } from "./camera.js";
import type { CanvasElement } from "./elements.js";
import { CanvasRenderer } from "./renderer.js";
import { Scene } from "./scene.js";
import { CanvasInput, type WorldPoint } from "./input.js";

export type EngineOptions = {
  onPointerDown?: (event: PointerEvent, world: WorldPoint) => void;
  onPointerMove?: (event: PointerEvent, world: WorldPoint) => void;
  onPointerUp?: (event: PointerEvent, world: WorldPoint) => void;
};
export class CanvasEngine {
  readonly scene = new Scene();
  readonly camera = new Camera();
  readonly selection = new Set<string>();
  readonly previews = new Map<string, CanvasElement>();
  private renderer: CanvasRenderer;
  private frame = 0;
  private disposed = false;
  private observer: ResizeObserver;
  private input: CanvasInput;
  constructor(
    readonly canvas: HTMLCanvasElement,
    private options: EngineOptions = {},
  ) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context is unavailable");
    this.renderer = new CanvasRenderer(canvas, context, () =>
      this.invalidateScene(),
    );
    this.observer = new ResizeObserver(() => this.invalidateScene());
    this.observer.observe(canvas);
    this.input = new CanvasInput(canvas, this.camera, {
      down: options.onPointerDown,
      move: options.onPointerMove,
      up: options.onPointerUp,
      change: () => this.invalidateScene(),
    });
    this.invalidateScene();
  }
  set(element: CanvasElement) {
    this.scene.set(element);
    this.invalidateScene();
  }
  setMany(elements: CanvasElement[]) {
    for (const e of elements) this.scene.set(e);
    this.invalidateScene();
  }
  delete(id: string) {
    if (this.scene.delete(id)) this.invalidateScene();
  }
  select(ids: Iterable<string>) {
    this.selection.clear();
    for (const id of ids) this.selection.add(id);
    this.invalidateOverlay();
  }
  preview(id: string, element?: CanvasElement) {
    if (element) this.previews.set(id, element);
    else this.previews.delete(id);
    this.invalidateOverlay();
  }
  invalidateScene() {
    if (this.disposed) return;
    this.renderer.invalidateScene();
    this.schedule();
  }
  invalidateOverlay() {
    if (this.disposed) return;
    this.renderer.invalidateOverlay();
    this.schedule();
  }
  screenToWorld(clientX: number, clientY: number) {
    const r = this.canvas.getBoundingClientRect();
    return this.camera.screenToWorld(clientX - r.left, clientY - r.top);
  }
  resize() {
    this.invalidateScene();
  }
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.input.dispose();
    this.renderer.dispose();
  }
  private schedule() {
    if (!this.frame)
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        if (!this.disposed)
          this.renderer.render(
            this.scene,
            this.camera,
            this.selection,
            this.previews,
          );
      });
  }
}
