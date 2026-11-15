import type { CanvasElement } from "./elements.js";
import { Camera } from "./camera.js";
import { Scene } from "./scene.js";
import { ImageResources } from "./resources.js";
import { traceFreehand } from "./tools.js";
import { selectionBounds, selectionHandles } from "./manipulation.js";
import { boundsOf } from "./geometry.js";

export class CanvasRenderer {
  private sceneCanvas = document.createElement("canvas");
  private overlayCanvas = document.createElement("canvas");
  private sceneDirty = true;
  private resources: ImageResources;
  private paths = new Map<string, { element: CanvasElement; path: Path2D }>();
  constructor(
    private canvas: HTMLCanvasElement,
    private context: CanvasRenderingContext2D,
    onResourceLoad: () => void = () => {},
  ) {
    this.resources = new ImageResources(128, onResourceLoad);
  }
  invalidateScene() {
    this.sceneDirty = true;
  }
  invalidateOverlay() {}
  render(
    scene: Scene,
    camera: Camera,
    selection: ReadonlySet<string>,
    previews: ReadonlyMap<string, CanvasElement>,
    hidden: ReadonlySet<string> = new Set(),
  ) {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    for (const surface of [this.canvas, this.sceneCanvas, this.overlayCanvas]) {
      if (surface.width !== width || surface.height !== height) {
        surface.width = width;
        surface.height = height;
        this.sceneDirty = true;
      }
    }
    const sceneContext = this.sceneCanvas.getContext("2d")!;
    if (this.sceneDirty) {
      sceneContext.setTransform(1, 0, 0, 1, 0, 0);
      sceneContext.clearRect(0, 0, width, height);
      sceneContext.setTransform(
        dpr * camera.zoom,
        0,
        0,
        dpr * camera.zoom,
        dpr * camera.x,
        dpr * camera.y,
      );
      for (const element of scene.query(
        camera.viewport(rect.width, rect.height),
      ))
        if (!hidden.has(element.id)) this.drawElement(sceneContext, element);
      this.sceneDirty = false;
    }
    const overlay = this.overlayCanvas.getContext("2d")!;
    overlay.setTransform(1, 0, 0, 1, 0, 0);
    overlay.clearRect(0, 0, width, height);
    overlay.setLineDash([]);
    overlay.setTransform(
      dpr * camera.zoom,
      0,
      0,
      dpr * camera.zoom,
      dpr * camera.x,
      dpr * camera.y,
    );
    for (const element of previews.values()) this.drawElement(overlay, element);
    overlay.setLineDash([5, 4]);
    overlay.lineWidth = 1 / camera.zoom;
    overlay.strokeStyle = "#00aaff";
    const selected = [...selection]
      .map((id) => previews.get(id) ?? scene.get(id))
      .filter((e): e is CanvasElement => !!e);
    const bounds = selectionBounds(selected);
    if (bounds) {
      overlay.strokeRect(
        bounds.minX,
        bounds.minY,
        bounds.maxX - bounds.minX,
        bounds.maxY - bounds.minY,
      );
      const handles = selectionHandles(bounds, camera.zoom);
      overlay.beginPath();
      overlay.moveTo(handles[1].x, handles[1].y);
      overlay.lineTo(handles[8].x, handles[8].y);
      overlay.strokeStyle = "#00aaff";
      overlay.lineWidth = 1 / camera.zoom;
      overlay.stroke();
      for (const { x, y } of handles) {
        const size = 8 / camera.zoom;
        overlay.fillStyle = "#ffffff";
        overlay.strokeStyle = "#0088dd";
        overlay.lineWidth = 1 / camera.zoom;
        overlay.fillRect(x - size / 2, y - size / 2, size, size);
        overlay.strokeRect(x - size / 2, y - size / 2, size, size);
      }
    }
    const output = this.context;
    output.setTransform(1, 0, 0, 1, 0, 0);
    output.clearRect(0, 0, width, height);
    output.drawImage(this.sceneCanvas, 0, 0);
    output.drawImage(this.overlayCanvas, 0, 0);
  }
  private drawElement(ctx: CanvasRenderingContext2D, e: CanvasElement) {
    ctx.save();
    if (e.rotation) {
      const b = boundsOf(e),
        cx = (b.minX + b.maxX) / 2,
        cy = (b.minY + b.maxY) / 2;
      ctx.translate(cx, cy);
      ctx.rotate(e.rotation);
      ctx.translate(-cx, -cy);
    }
    ctx.globalAlpha = e.opacity ?? 1;
    ctx.strokeStyle = e.strokeColor ?? "#fff";
    ctx.fillStyle = e.fillColor ?? "transparent";
    ctx.lineWidth = e.strokeWidth ?? 1;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    if (e.type === "eraser") ctx.globalCompositeOperation = "destination-out";
    switch (e.type) {
      case "rectangle": {
        const path = this.pathFor(e);
        ctx.fill(path);
        ctx.stroke(path);
        break;
      }
      case "circle": {
        const path = this.pathFor(e);
        ctx.fill(path);
        ctx.stroke(path);
        break;
      }
      case "line":
      case "arrow":
        ctx.beginPath();
        ctx.moveTo(e.x1, e.y1);
        ctx.lineTo(e.x2, e.y2);
        ctx.stroke();
        if (e.type === "arrow") {
          const a = Math.atan2(e.y2 - e.y1, e.x2 - e.x1),
            l = Math.max(10, ctx.lineWidth * 5);
          ctx.beginPath();
          ctx.moveTo(e.x2, e.y2);
          ctx.lineTo(
            e.x2 - l * Math.cos(a - Math.PI / 7),
            e.y2 - l * Math.sin(a - Math.PI / 7),
          );
          ctx.lineTo(
            e.x2 - l * Math.cos(a + Math.PI / 7),
            e.y2 - l * Math.sin(a + Math.PI / 7),
          );
          ctx.closePath();
          ctx.fillStyle = e.strokeColor ?? "#fff";
          ctx.fill();
        }
        break;
      case "triangle":
        ctx.beginPath();
        ctx.moveTo(e.x1, e.y1);
        ctx.lineTo(e.x2, e.y2);
        ctx.lineTo(e.x3, e.y3);
        ctx.closePath();
        this.paint(ctx, e);
        break;
      case "freehand":
        traceFreehand(ctx, e.points, e.strokeWidth ?? 1);
        break;
      case "eraser":
        if (e.points.length) {
          ctx.beginPath();
          ctx.moveTo(e.points[0]!.x, e.points[0]!.y);
          for (const p of e.points.slice(1)) ctx.lineTo(p.x, p.y);
          ctx.lineWidth =
            e.type === "eraser"
              ? (e.size ?? e.strokeWidth ?? 10)
              : ctx.lineWidth;
          ctx.stroke();
        }
        break;
      case "text":
        ctx.font = `${(e.strokeWidth ?? 3) * 10}px sans-serif`;
        ctx.fillStyle = e.strokeColor ?? "#fff";
        ctx.fillText(e.content, e.x, e.y);
        break;
      case "image": {
        const src = e.src;
        if (src) {
          const image = this.resources.get(src);
          if (image.complete && image.naturalWidth)
            ctx.drawImage(image, e.x, e.y, e.width, e.height);
        }
        break;
      }
      default:
        // Opaque legacy elements stay in the scene until a renderer is available.
        break;
    }
    ctx.restore();
  }
  private paint(ctx: CanvasRenderingContext2D, e: CanvasElement) {
    if (e.fillColor) ctx.fill();
    if (e.strokeColor) ctx.stroke();
  }
  private pathFor(e: CanvasElement) {
    const cached = this.paths.get(e.id);
    if (cached?.element === e) return cached.path;
    const path = new Path2D();
    if (e.type === "rectangle") path.rect(e.x, e.y, e.width, e.height);
    else if (e.type === "circle")
      path.ellipse(e.x, e.y, e.radiusX, e.radiusY, 0, 0, Math.PI * 2);
    this.paths.delete(e.id);
    this.paths.set(e.id, { element: e, path });
    if (this.paths.size > 2048)
      this.paths.delete(this.paths.keys().next().value!);
    return path;
  }
  dispose() {
    this.resources.dispose();
    this.paths.clear();
    this.sceneCanvas.width = 0;
    this.sceneCanvas.height = 0;
    this.overlayCanvas.width = 0;
    this.overlayCanvas.height = 0;
  }
}
