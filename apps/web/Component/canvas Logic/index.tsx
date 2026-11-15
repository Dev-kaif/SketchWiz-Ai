/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable no-case-declarations */
import axios from "../axios/index";
import { BACKEND_URL } from "../Config";
import {
  Camera,
  CanvasRenderer,
  FreehandBuilder,
  PointerToolLifecycle,
  Scene,
  CommandHistory,
  type ElementChange,
  type HistoryEntry,
  hitSelectionHandle,
  selectionBounds,
  translateElement,
  resizeElement,
  rotateElement,
  splitFreehand,
  sweptIntersects,
  traceFreehand,
  type CanvasElement,
  type ToolPoint,
} from "@repo/canvas-engine";

type Point = { x: number; y: number; pressure?: number };

type ShapeStyle = {
  strokeColor?: string;
  strokeWidth?: number;
  rotation?: number;
  opacity?: number;
  fillColor?: string;
  order?: number;
  groupId?: string;
};

export type Shape = ShapeStyle &
  (
    | {
        id: string;
        type: "rectangle";
        x: number;
        y: number;
        width: number;
        height: number;
        strokeColor: string;
        strokeWidth: number;
      }
    | {
        id: string;
        type: "circle";
        x: number;
        y: number;
        radiusX: number;
        radiusY: number;
        strokeColor: string;
        strokeWidth: number;
      }
    | {
        id: string;
        type: "line";
        x1: number;
        y1: number;
        x2: number;
        y2: number;
        strokeColor: string;
        strokeWidth: number;
      }
    | {
        id: string;
        type: "triangle";
        x1: number;
        y1: number;
        x2: number;
        y2: number;
        x3: number;
        y3: number;
        strokeColor: string;
        strokeWidth: number;
      }
    | {
        id: string;
        type: "freehand";
        points: Point[];
        strokeColor: string;
        strokeWidth: number;
      }
    | {
        id: string;
        type: "text";
        x: number;
        y: number;
        content: string;
        strokeColor: string;
        strokeWidth: number;
      }
    | { id: string; type: "eraser"; points: Point[]; size: number }
    | {
        id: string;
        type: "arrow";
        x1: number;
        y1: number;
        x2: number;
        y2: number;
        strokeColor: string;
        strokeWidth: number;
      }
    | {
        id: string;
        type: "image";
        x: number;
        y: number;
        width: number;
        height: number;
        src: string;
      }
  );

interface DrawState {
  shapes: Shape[];
  offsetX: number;
  offsetY: number;
  scale: number;
  isDrawing: boolean;
  isPanning: boolean;
  isFreehandDrawing: boolean;
  isErasing: boolean;
  startX: number;
  startY: number;
  panStartX: number;
  panStartY: number;
  freehandPoints: Point[];
  eraserPoints: Point[];
  currentX?: number;
  currentY?: number;
  textPreview?: {
    x: number;
    y: number;
    text: string;
    showCursor: boolean;
  };
  selectedShapeIds: string[];
  isMarqueeSelecting: boolean; // NEW
  marqueeStartX: number; // NEW
  marqueeStartY: number; // NEW
  marqueeCurrentX: number; // NEW
  marqueeCurrentY: number;
}

// A module-level variable to hold the cleanup function for text input.
let activeTextCleanup: (() => void) | null = null;

interface InitDrawControls {
  cleanup: () => void;
  addShapeLocally: (shape: Shape) => void;
  isCanvasEmpty: () => boolean;
  getSelectedShapesInfo: () => Array<{
    shape: Shape;
    index: number;
    bounds: { x: number; y: number; width: number; height: number };
  }>;
  deleteShapeById: (id: string) => void;
  editSelectionStyle: (
    style: Partial<
      Pick<Shape, "strokeColor" | "strokeWidth" | "fillColor" | "opacity">
    >,
  ) => void;
  runCanvasCommand: (
    command:
      | "undo"
      | "redo"
      | "group"
      | "ungroup"
      | "front"
      | "back"
      | "forward"
      | "backward"
      | "delete",
  ) => void;
  clearLocally: () => void;
  captureSelectedAreaBlob: () => Promise<Blob | null>;
}

export default async function initDraw(
  canvas: HTMLCanvasElement,
  modeRef: React.RefObject<
    | "rect"
    | "circle"
    | "line"
    | "triangle"
    | "freehand"
    | "text"
    | "eraser"
    | "precision-eraser"
    | "arrow"
    | "select"
    | null
  >,
  strokeColorRef: React.RefObject<string>,
  strokeWidthRef: React.RefObject<number>,
  socket: WebSocket,
  params: Promise<{ slug: string }>,
  setAiResponse: (a: string) => void,
): Promise<InitDrawControls> {
  const defaultState: DrawState = {
    shapes: [],
    offsetX: 0,
    offsetY: 0,
    scale: 1,
    isDrawing: false,
    isPanning: false,
    isFreehandDrawing: false,
    isErasing: false,
    startX: 0,
    startY: 0,
    panStartX: 0,
    panStartY: 0,
    freehandPoints: [],
    eraserPoints: [],
    currentX: undefined,
    currentY: undefined,
    textPreview: undefined,
    selectedShapeIds: [],
    isMarqueeSelecting: false, // NEW
    marqueeStartX: 0, // NEW
    marqueeStartY: 0, // NEW
    marqueeCurrentX: 0, // NEW
    marqueeCurrentY: 0,
  };
  const ctx = canvas.getContext("2d");

  // ADDED: Handle case where canvas context might not be available
  if (!ctx) {
    console.error("Canvas context is not available.");
    // Return a dummy object with no-op functions if context is null
    return {
      cleanup: () => {},
      addShapeLocally: () => {},
      isCanvasEmpty: () => true,
      getSelectedShapesInfo: () => [],
      deleteShapeById: () => {},
      editSelectionStyle: () => {},
      runCanvasCommand: () => {},
      clearLocally: () => {},
      captureSelectedAreaBlob: () => Promise.resolve(null),
    };
  }

  // Consolidate all drawing variables in state.
  const state: DrawState = { ...defaultState };
  const scene = new Scene();
  const camera = new Camera();
  const renderer = new CanvasRenderer(canvas, ctx, () => scheduleRender());
  let renderedCamera = { x: Number.NaN, y: Number.NaN, zoom: Number.NaN };
  const setSceneElement = (shape: Shape) => {
    scene.set(shape as unknown as CanvasElement);
    renderer.invalidateScene();
  };
  let roomIdForSync: number | null = null;
  let canvasRevision = 0;
  let requestedSyncRevision: number | null = null;
  let pointerToolActive = false;
  let activePointerTool: "freehand" | "eraser" | "precision-eraser" | null =
    null;
  const history = new CommandHistory(100);
  const transformPreviews = new Map<string, CanvasElement>();
  const hiddenTransformIds = new Set<string>();
  const localOperationIds = new Set<string>();
  const pendingHistoryByOperation = new Map<
    string,
    {
      entry: HistoryEntry;
      action: "push" | "undo" | "redo";
      remaining: Set<string>;
    }
  >();
  let historyBusy = false;
  let activeTransform: {
    kind: "move" | "resize" | "rotate";
    handle: NonNullable<ReturnType<typeof hitSelectionHandle>> | null;
    start: Point;
    bounds: NonNullable<ReturnType<typeof selectionBounds>>;
    center: Point;
    startAngle: number;
    originals: Map<string, Shape>;
  } | null = null;
  let elementClipboard: Shape[] = [];

  // Schedule rendering with requestAnimationFrame.
  let renderRequested = false;
  let renderFrame = 0;
  function scheduleRender() {
    if (!renderRequested) {
      renderRequested = true;
      renderFrame = requestAnimationFrame(() => {
        renderRequested = false;
        renderFrame = 0;
        renderAll();
      });
    }
  }

  // Add this new helper function inside initDraw, after `state` is defined
  function addShapeLocally(shape: Shape) {
    state.shapes.push(shape);
    setSceneElement(shape);
    scheduleRender(); // Request a re-render to display the new shape
  }

  function isCanvasEmpty(): boolean {
    return state.shapes.length === 0;
  }

  function clearLocally() {
    state.shapes = [];
    state.selectedShapeIds = [];
    scene.clear();
    renderer.invalidateScene();
    scheduleRender();
  }

  const imageCache = new Map<string, HTMLImageElement>();

  function getShapeBounds(
    ctx: CanvasRenderingContext2D,
    shape: Shape,
  ): { x: number; y: number; width: number; height: number } | null {
    // Note: Text and Freehand bounds are approximations.
    // For precise text bounds, you might need to render to a temp canvas and measure.
    switch (shape.type) {
      case "rectangle":
        return {
          x: shape.x,
          y: shape.y,
          width: shape.width,
          height: shape.height,
        };
      case "circle":
        return {
          x: shape.x - shape.radiusX,
          y: shape.y - shape.radiusY,
          width: shape.radiusX * 2,
          height: shape.radiusY * 2,
        };
      case "line":
      case "arrow":
        const minX = Math.min(shape.x1, shape.x2);
        const maxX = Math.max(shape.x1, shape.x2);
        const minY = Math.min(shape.y1, shape.y2);
        const maxY = Math.max(shape.y1, shape.y2);
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
      case "triangle":
        const triMinX = Math.min(shape.x1, shape.x2, shape.x3);
        const triMaxX = Math.max(shape.x1, shape.x2, shape.x3);
        const triMinY = Math.min(shape.y1, shape.y2, shape.y3);
        const triMaxY = Math.max(shape.y1, shape.y2, shape.y3);
        return {
          x: triMinX,
          y: triMinY,
          width: triMaxX - triMinX,
          height: triMaxY - triMinY,
        };
      case "freehand":
      case "eraser":
        if (shape.points.length === 0) return null;
        let minFreeX = Infinity,
          maxFreeX = -Infinity,
          minFreeY = Infinity,
          maxFreeY = -Infinity;
        shape.points.forEach((p) => {
          minFreeX = Math.min(minFreeX, p.x);
          maxFreeX = Math.max(maxFreeX, p.x);
          minFreeY = Math.min(minFreeY, p.y);
          maxFreeY = Math.max(maxFreeY, p.y);
        });
        // Add padding for line width/eraser size
        const padding =
          (shape.type === "freehand" ? shape.strokeWidth : shape.size) / 2 + 2; // +2 for extra buffer
        return {
          x: minFreeX - padding,
          y: minFreeY - padding,
          width: maxFreeX - minFreeX + padding * 2,
          height: maxFreeY - minFreeY + padding * 2,
        };
      case "text":
        const fontSize = shape.strokeWidth * 10;
        const lines = shape.content.split("\n");
        // Rough estimate for text width - get max width of lines
        let maxTextWidth = 0;
        // ctx is guaranteed to be non-null here
        lines.forEach((line) => {
          maxTextWidth = Math.max(maxTextWidth, ctx.measureText(line).width);
        });
        const textHeight = lines.length * fontSize * 1.2; // 1.2 for line spacing
        return {
          x: shape.x,
          y: shape.y - fontSize * 0.8,
          width: maxTextWidth,
          height: textHeight,
        }; // Adjust y to be closer to top of text
      case "image":
        return {
          x: shape.x,
          y: shape.y,
          width: shape.width,
          height: shape.height,
        };
      default:
        // ADDED: Default case to ensure all Shape types are handled
        // If a new shape type is added and not handled, this prevents a potential error
        return null;
    }
  }

  function getSelectedShapesInfo(): Array<{
    shape: Shape;
    index: number;
    bounds: { x: number; y: number; width: number; height: number };
  }> {
    const infos: Array<{
      shape: Shape;
      index: number;
      bounds: { x: number; y: number; width: number; height: number };
    }> = [];
    state.selectedShapeIds.forEach((id) => {
      const index = state.shapes.findIndex((s) => s.id === id);
      if (index !== -1) {
        const selectedShape = state.shapes[index];
        if (ctx && selectedShape) {
          const bounds = getShapeBounds(ctx, selectedShape);
          if (bounds) {
            infos.push({ shape: selectedShape, index: index, bounds: bounds });
          }
        }
      }
    });
    return infos;
  }

  function deleteShapeById(id: string) {
    const before = state.shapes.find((shape) => shape.id === id);
    if (!before) return;
    state.selectedShapeIds = state.selectedShapeIds.filter(
      (selectedId) => selectedId !== id,
    );
    setLocalElement(id, null);
    persistHistory(
      {
        label: "Delete",
        changes: [
          { id, before: before as unknown as CanvasElement, after: null },
        ],
      },
      "push",
    );
    scheduleRender();
  }

  function editSelectionStyle(
    style: Partial<
      Pick<Shape, "strokeColor" | "strokeWidth" | "fillColor" | "opacity">
    >,
  ) {
    const changes: ElementChange[] = [];
    for (const id of state.selectedShapeIds) {
      const before = state.shapes.find((shape) => shape.id === id);
      if (!before || before.type === "eraser") continue;
      const after = { ...before, ...style } as Shape;
      changes.push({
        id,
        before: before as unknown as CanvasElement,
        after: after as unknown as CanvasElement,
      });
    }
    if (!changes.length) return;
    for (const change of changes) setLocalElement(change.id, change.after);
    persistHistory({ label: "Style", changes }, "push");
    scheduleRender();
  }

  // Add this function inside initDraw, near getSelectedShapesInfo
  function captureSelectedAreaBlob(): Promise<Blob | null> {
    return new Promise((resolve) => {
      if (!ctx || state.selectedShapeIds.length === 0) {
        resolve(null);
        return;
      }

      // 1. Calculate combined bounding box of all selected shapes
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      const selectedShapes: Shape[] = [];

      state.selectedShapeIds.forEach((id) => {
        const shape = state.shapes.find((s) => s.id === id);
        if (shape) {
          const bounds = getShapeBounds(ctx, shape);
          if (bounds) {
            minX = Math.min(minX, bounds.x);
            minY = Math.min(minY, bounds.y);
            maxX = Math.max(maxX, bounds.x + bounds.width);
            maxY = Math.max(maxY, bounds.y + bounds.height);
            selectedShapes.push(shape); // Collect selected shapes for drawing
          }
        }
      });

      if (selectedShapes.length === 0) {
        // No valid selected shapes found
        resolve(null);
        return;
      }

      const combinedBounds = {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
      };

      const tempCanvas = document.createElement("canvas");
      const tempCtx = tempCanvas.getContext("2d");

      if (!tempCtx) {
        resolve(null);
        return;
      }

      const padding = 10; // Add some padding around the captured area
      tempCanvas.width = combinedBounds.width + 2 * padding;
      tempCanvas.height = combinedBounds.height + 2 * padding;

      tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
      tempCtx.save();

      // Translate the temporary context so that the combinedBounds's top-left
      // corner is at (padding, padding) on the tempCanvas.
      tempCtx.translate(
        -combinedBounds.x + padding,
        -combinedBounds.y + padding,
      );

      // 2. Draw ONLY the selected shapes onto the temporary canvas
      selectedShapes.forEach((shape) => {
        const drawFn = (drawShape as any)[shape.type];
        if (drawFn) {
          // Ensure temporary canvas uses the same scaling logic if any within drawShape
          tempCtx.save();
          tempCtx.lineJoin = "round";
          tempCtx.lineCap = "round";
          tempCtx.shadowBlur = 0;
          drawFn(tempCtx, shape);
          tempCtx.restore();
        }
      });

      tempCtx.restore();

      tempCanvas.toBlob((blob) => {
        resolve(blob);
        tempCanvas.remove(); // Clean up temp canvas
      }, "image/png");
    });
  }

  // --------------------------------------------------
  // Drawing Helper Functions for Permanent Shapes
  // --------------------------------------------------
  const drawShape = {
    rectangle: (
      ctx: CanvasRenderingContext2D,
      shape: Extract<Shape, { type: "rectangle" }>,
    ) => {
      ctx.shadowColor = shape.strokeColor;
      ctx.strokeStyle = shape.strokeColor;
      ctx.lineWidth = shape.strokeWidth;
      ctx.strokeRect(shape.x, shape.y, shape.width, shape.height);
    },
    circle: (
      ctx: CanvasRenderingContext2D,
      shape: Extract<Shape, { type: "circle" }>,
    ) => {
      ctx.shadowColor = shape.strokeColor;
      ctx.strokeStyle = shape.strokeColor;
      ctx.lineWidth = shape.strokeWidth;
      ctx.beginPath();
      ctx.ellipse(
        shape.x,
        shape.y,
        shape.radiusX,
        shape.radiusY,
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    },
    line: (
      ctx: CanvasRenderingContext2D,
      shape: Extract<Shape, { type: "line" }>,
    ) => {
      ctx.shadowColor = shape.strokeColor;
      ctx.strokeStyle = shape.strokeColor;
      ctx.lineWidth = shape.strokeWidth;
      ctx.beginPath();
      ctx.moveTo(shape.x1, shape.y1);
      ctx.lineTo(shape.x2, shape.y2);
      ctx.stroke();
    },
    triangle: (
      ctx: CanvasRenderingContext2D,
      shape: Extract<Shape, { type: "triangle" }>,
    ) => {
      ctx.shadowColor = shape.strokeColor;
      ctx.strokeStyle = shape.strokeColor;
      ctx.lineWidth = shape.strokeWidth;
      ctx.beginPath();
      ctx.moveTo(shape.x1, shape.y1);
      ctx.lineTo(shape.x2, shape.y2);
      ctx.lineTo(shape.x3, shape.y3);
      ctx.closePath();
      ctx.stroke();
    },
    freehand: (
      ctx: CanvasRenderingContext2D,
      shape: Extract<Shape, { type: "freehand" }>,
    ) => {
      ctx.strokeStyle = shape.strokeColor;
      traceFreehand(ctx, shape.points, shape.strokeWidth);
    },
    // For text, split on "\n" and draw each line.
    text: (
      ctx: CanvasRenderingContext2D,
      shape: Extract<Shape, { type: "text" }>,
    ) => {
      const lines = shape.content.split("\n");
      const fontSize = shape.strokeWidth * 10;
      ctx.font = `${fontSize}px Arial`;
      ctx.fillStyle = shape.strokeColor;
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i] as string, shape.x, shape.y + i * fontSize * 1.2);
      }
    },
    eraser: (
      ctx: CanvasRenderingContext2D,
      shape: Extract<Shape, { type: "eraser" }>,
    ) => {
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineWidth = shape.size;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      // ADDED: Nullish coalescing for safety if points array is unexpectedly empty
      ctx.moveTo(shape.points[0]?.x ?? 0, shape.points[0]?.y ?? 0);
      shape.points.forEach((p, i) => {
        if (i > 0) ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
      ctx.restore();
    },
    arrow: (
      ctx: CanvasRenderingContext2D,
      shape: Extract<Shape, { type: "arrow" }>,
    ) => {
      ctx.shadowColor = shape.strokeColor;
      ctx.strokeStyle = shape.strokeColor;
      ctx.lineWidth = shape.strokeWidth;
      ctx.beginPath();
      ctx.moveTo(shape.x1, shape.y1);
      ctx.lineTo(shape.x2, shape.y2);
      ctx.stroke();

      const dx = shape.x2 - shape.x1;
      const dy = shape.y2 - shape.y1;
      const angle = Math.atan2(dy, dx);
      const headLength = Math.max(10, shape.strokeWidth * 5);
      ctx.beginPath();
      ctx.moveTo(shape.x2, shape.y2);
      ctx.lineTo(
        shape.x2 - headLength * Math.cos(angle - Math.PI / 7),
        shape.y2 - headLength * Math.sin(angle - Math.PI / 7),
      );
      ctx.lineTo(
        shape.x2 - headLength * Math.cos(angle + Math.PI / 7),
        shape.y2 - headLength * Math.sin(angle + Math.PI / 7),
      );
      ctx.closePath();
      ctx.fillStyle = shape.strokeColor;
      ctx.fill();
    },
    image: (
      ctx: CanvasRenderingContext2D,
      shape: Extract<Shape, { type: "image" }>,
    ) => {
      let img = imageCache.get(shape.src);
      if (!img) {
        img = new Image();
        img.crossOrigin = "anonymous"; // Important for CORS if images are from external sources
        img.onload = () => {
          // Re-render only after image is loaded to display it
          scheduleRender();
        };
        img.onerror = (err) => {
          console.error("Failed to load image for drawing:", shape.src, err);
          // You might want to draw a placeholder or log an error
        };
        img.src = shape.src;
        imageCache.set(shape.src, img);
        if (imageCache.size > 128)
          imageCache.delete(imageCache.keys().next().value!);
      }

      // Draw only if the image is loaded and ready
      if (img.complete && img.naturalWidth !== 0) {
        ctx.drawImage(img, shape.x, shape.y, shape.width, shape.height);
      }
    },
  };

  // --------------------------------------------------
  // Render Function: Draw Permanent Shapes & Previews
  // --------------------------------------------------
  function renderAll() {
    if (!ctx) return;
    camera.x = state.offsetX;
    camera.y = state.offsetY;
    camera.zoom = state.scale;
    if (
      camera.x !== renderedCamera.x ||
      camera.y !== renderedCamera.y ||
      camera.zoom !== renderedCamera.zoom
    ) {
      renderer.invalidateScene();
      renderedCamera = { x: camera.x, y: camera.y, zoom: camera.zoom };
    }
    renderer.render(
      scene,
      camera,
      new Set(state.selectedShapeIds),
      transformPreviews,
      hiddenTransformIds,
    );
    ctx.save();

    ctx.translate(state.offsetX, state.offsetY);
    ctx.scale(state.scale, state.scale);

    // NEW: Draw marquee selection rectangle
    if (
      state.isMarqueeSelecting &&
      state.marqueeCurrentX !== undefined &&
      state.marqueeCurrentY !== undefined
    ) {
      ctx.save();
      ctx.strokeStyle = "#00aaff"; // Marquee color
      ctx.lineWidth = 1 / state.scale; // Thin line
      ctx.setLineDash([2, 2]); // Dashed line
      const x = Math.min(state.marqueeStartX, state.marqueeCurrentX);
      const y = Math.min(state.marqueeStartY, state.marqueeCurrentY);
      const width = Math.abs(state.marqueeCurrentX - state.marqueeStartX);
      const height = Math.abs(state.marqueeCurrentY - state.marqueeStartY);
      ctx.strokeRect(x, y, width, height);
      ctx.restore();
    }

    // 2. Preview for regular shapes (rect, circle, line, triangle, arrow).
    if (
      state.isDrawing &&
      state.currentX !== undefined &&
      state.currentY !== undefined // Ensure currentX/Y are defined for preview
    ) {
      ctx.save();
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.shadowColor = strokeColorRef.current;
      ctx.strokeStyle = strokeColorRef.current;
      ctx.lineWidth = strokeWidthRef.current;
      const startX = state.startX;
      const startY = state.startY;
      const currentX = state.currentX;
      const currentY = state.currentY;
      if (modeRef.current === "rect") {
        ctx.strokeRect(startX, startY, currentX - startX, currentY - startY);
      } else if (modeRef.current === "circle") {
        const centerX = (startX + currentX) / 2;
        const centerY = (startY + currentY) / 2;
        const radiusX = Math.abs(currentX - startX) / 2;
        const radiusY = Math.abs(currentY - startY) / 2;
        ctx.beginPath();
        ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (modeRef.current === "line" || modeRef.current === "arrow") {
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(currentX, currentY);
        ctx.stroke();
      } else if (modeRef.current === "triangle") {
        const dx = currentX - startX;
        const dy = currentY - startY;
        const midX = (startX + currentX) / 2;
        const midY = (startY + currentY) / 2;
        // This calculates a point for an equilateral triangle.
        // For a more general triangle, it might need to use other points.
        const thirdX = midX - dy * (Math.sqrt(3) / 2);
        const thirdY = midY + dx * (Math.sqrt(3) / 2); // Corrected `+ dx` for rotation
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(currentX, currentY);
        ctx.lineTo(thirdX, thirdY);
        ctx.closePath();
        ctx.stroke();
      }
      ctx.restore();
    }

    // 3. Preview for freehand pencil.
    if (state.isFreehandDrawing && state.freehandPoints.length > 0) {
      ctx.save();
      ctx.strokeStyle = strokeColorRef.current;
      traceFreehand(ctx, state.freehandPoints, strokeWidthRef.current);
      ctx.restore();
    }

    // 4. Preview for eraser.
    if (state.isErasing && state.eraserPoints.length > 0) {
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = "rgba(255,255,255,.8)";
      ctx.lineWidth = 1 / state.scale;
      ctx.beginPath();
      const last = state.eraserPoints.at(-1)!;
      ctx.arc(
        last.x,
        last.y,
        (strokeWidthRef.current * 5) / state.scale,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
      ctx.restore();
    }

    // 5. Preview for text (multiline).
    if (state.textPreview) {
      ctx.save();
      const fontSize = strokeWidthRef.current * 10;
      ctx.font = `${fontSize}px Arial`;
      ctx.fillStyle = strokeColorRef.current;
      const displayText = state.textPreview.showCursor
        ? state.textPreview.text + "|"
        : state.textPreview.text;
      const lines = displayText.split("\n");
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(
          lines[i] as string,
          state.textPreview.x,
          state.textPreview.y + i * fontSize * 1.2,
        );
      }
      ctx.restore();
    }

    ctx.restore();
  }

  // --------------------------------------------------
  // Load Previous Shapes and Setup Socket
  // --------------------------------------------------
  function upsertShape(shape: Shape) {
    const index = state.shapes.findIndex((current) => current.id === shape.id);
    if (index === -1) state.shapes.push(shape);
    else state.shapes[index] = shape;
    setSceneElement(shape);
  }

  function requestCanvasSync() {
    if (roomIdForSync === null || socket.readyState !== WebSocket.OPEN) return;
    if (requestedSyncRevision === canvasRevision) return;
    requestedSyncRevision = canvasRevision;
    socket.send(
      JSON.stringify({
        type: "canvas:sync",
        roomId: roomIdForSync,
        afterRevision: canvasRevision,
      }),
    );
  }

  function applyRevisionedOperation(operation: any) {
    const revision = Number(operation.revision);
    if (!Number.isSafeInteger(revision) || revision <= canvasRevision) return;
    if (revision !== canvasRevision + 1) {
      requestCanvasSync();
      return;
    }
    const type = operation.type ?? operation.kind;
    const payload = operation.payload;
    const elementId =
      operation.elementId ??
      payload?.id ??
      operation.element?.id ??
      payload?.element?.id;
    if (
      typeof elementId === "string" &&
      !localOperationIds.delete(operation.operationId)
    )
      history.invalidate([elementId]);
    if (type === "canvas:clear" || type === "clear") {
      state.shapes = [];
      scene.clear();
      renderer.invalidateScene();
    } else if (
      ["canvas:delete", "canvas:delete_element", "delete_element"].includes(
        type,
      )
    ) {
      const id = operation.elementId ?? payload?.id;
      if (typeof id === "string")
        state.shapes = state.shapes.filter((shape) => shape.id !== id);
      if (typeof id === "string") {
        scene.delete(id);
        renderer.invalidateScene();
      }
    } else {
      const element = operation.element ?? payload?.element ?? payload;
      if (
        element &&
        typeof element.id === "string" &&
        typeof element.type === "string"
      )
        upsertShape(element as Shape);
    }
    canvasRevision = revision;
    scheduleRender();
  }

  function applyServerMessage(data: any) {
    if (data.type === "canvas:ack") {
      if (data.error) {
        const pending = new Set(pendingHistoryByOperation.values());
        for (const group of pending) {
          for (const id of group.remaining)
            pendingHistoryByOperation.delete(id);
          if (group.action === "undo") history.restoreUndo(group.entry);
          else if (group.action === "redo") history.restoreRedo(group.entry);
        }
        historyBusy = false;
        window.dispatchEvent(
          new CustomEvent("canvas:persistence-error", {
            detail: "A canvas change was rejected; syncing saved state",
          }),
        );
      } else if (Array.isArray(data.operationIds)) {
        acknowledgeHistory(data.operationIds);
      }
      // The acknowledgement confirms durability, but another client's operation
      // may precede this revision. Recover from our last applied revision.
      requestCanvasSync();
      return;
    }
    if (data.type === "canvas:sync" && data.mode) {
      requestedSyncRevision = null;
      if (data.mode === "snapshot") {
        history.invalidate([
          ...state.shapes.map((shape) => shape.id),
          ...(Array.isArray(data.elements)
            ? data.elements.map((shape: Shape) => shape.id)
            : []),
        ]);
        localOperationIds.clear();
        state.shapes = Array.isArray(data.elements)
          ? (data.elements as Shape[])
          : [];
        scene.clear();
        renderer.invalidateScene();
        for (const shape of state.shapes) setSceneElement(shape);
        canvasRevision = Number(data.revision) || 0;
        scheduleRender();
      } else if (data.mode === "operations" && Array.isArray(data.operations)) {
        data.operations.forEach(applyRevisionedOperation);
      }
      if (data.hasMore) requestCanvasSync();
      return;
    }
    if (data.type === "canvas:batch" && Array.isArray(data.operations)) {
      data.operations.forEach((operation: any) =>
        applyRevisionedOperation({
          ...operation,
          type: `canvas:${operation.kind}`,
        }),
      );
      return;
    }
    if (
      [
        "canvas:create",
        "canvas:update",
        "canvas:delete",
        "canvas:create_element",
        "canvas:update_element",
        "canvas:delete_element",
      ].includes(data.type)
    ) {
      applyRevisionedOperation(data);
      return;
    }
    if (data.type === "chat" && data.message) {
      upsertShape(data.message as Shape);
      scheduleRender();
    }
    if (data.type === "ai") setAiResponse(data.message);
  }

  socket.onmessage = (event) => {
    try {
      applyServerMessage(JSON.parse(event.data));
    } catch {
      // Ignore malformed server frames without interrupting canvas input.
    }
  };

  async function loadPreviousShapes() {
    const slug = (await params).slug;
    const roomIdRes = await axios.get(`${BACKEND_URL}/api/room/slug/${slug}`);
    const roomId = roomIdRes.data.room.id;
    roomIdForSync = roomId;
    const res = await axios.get(`${BACKEND_URL}/api/room/${roomId}/canvas`);
    state.shapes = Array.isArray(res.data.elements)
      ? (res.data.elements as Shape[])
      : [];
    scene.clear();
    renderer.invalidateScene();
    for (const shape of state.shapes) setSceneElement(shape);
    canvasRevision = Number(res.data.revision) || 0;
    scheduleRender();
    socket.send(JSON.stringify({ type: "join_room", roomId }));
    requestCanvasSync();
    return roomId;
  }

  const roomId = await loadPreviousShapes();

  function sendShapeMessage(shape: Shape) {
    persistHistory(
      {
        label: "Create element",
        changes: [
          {
            id: shape.id,
            before: null,
            after: shape as unknown as CanvasElement,
          },
        ],
      },
      "push",
    );
  }

  function sendPersistent(message: unknown) {
    if (socket.readyState !== WebSocket.OPEN) {
      window.dispatchEvent(
        new CustomEvent("canvas:persistence-error", {
          detail: "Disconnected: drawing change is not saved",
        }),
      );
      return false;
    }
    try {
      socket.send(JSON.stringify(message));
      return true;
    } catch {
      window.dispatchEvent(
        new CustomEvent("canvas:persistence-error", {
          detail: "Drawing change could not be sent",
        }),
      );
      return false;
    }
  }

  function setLocalElement(id: string, element: CanvasElement | null) {
    const index = state.shapes.findIndex((shape) => shape.id === id);
    if (element) {
      const shape = element as unknown as Shape;
      if (index < 0) state.shapes.push(shape);
      else state.shapes[index] = shape;
      scene.set(element);
    } else {
      if (index >= 0) state.shapes.splice(index, 1);
      scene.delete(id);
    }
    renderer.invalidateScene();
  }

  function persistHistory(
    entry: HistoryEntry,
    action: "push" | "undo" | "redo",
  ) {
    if (roomIdForSync === null) return false;
    const operations: Array<Record<string, unknown>> = [];
    for (const change of entry.changes) {
      const source = action === "undo" ? change.after : change.before;
      const target = action === "undo" ? change.before : change.after;
      if (!target) {
        if (source)
          operations.push({
            kind: "delete",
            operationId: crypto.randomUUID(),
            elementId: change.id,
          });
      } else if (!source) {
        operations.push({
          kind: "create",
          operationId: crypto.randomUUID(),
          element: target,
        });
      } else {
        operations.push({
          kind: "update",
          operationId: crypto.randomUUID(),
          element: target,
        });
      }
    }
    if (!operations.length) {
      if (action === "push") history.push(entry);
      else if (action === "undo") history.commitUndo(entry);
      else history.commitRedo(entry);
      return true;
    }
    if (operations.length > 100) {
      window.dispatchEvent(
        new CustomEvent("canvas:persistence-error", {
          detail: "Select fewer than 100 objects for one atomic change",
        }),
      );
      if (action === "push")
        for (const change of entry.changes)
          setLocalElement(change.id, change.before);
      scheduleRender();
      return false;
    }
    const operationIds = operations.map((operation) =>
      String(operation.operationId),
    );
    if (
      !sendPersistent({
        type: "canvas:batch",
        roomId,
        operations,
        ...(action === "push" ? {} : { expectedRevision: canvasRevision }),
      })
    )
      return false;
    if (action !== "push")
      for (const change of entry.changes)
        setLocalElement(
          change.id,
          action === "undo" ? change.before : change.after,
        );
    const pending = { entry, action, remaining: new Set(operationIds) };
    for (const id of operationIds) {
      localOperationIds.add(id);
      pendingHistoryByOperation.set(id, pending);
    }
    scheduleRender();
    return true;
  }

  function acknowledgeHistory(operationIds: Array<{ operationId: string }>) {
    for (const result of operationIds) {
      const pending = pendingHistoryByOperation.get(result.operationId);
      if (!pending) continue;
      pendingHistoryByOperation.delete(result.operationId);
      pending.remaining.delete(result.operationId);
      if (pending.remaining.size) continue;
      if (pending.action === "push") history.push(pending.entry);
      else if (pending.action === "undo") history.commitUndo(pending.entry);
      else history.commitRedo(pending.entry);
      historyBusy = false;
    }
  }

  function performHistory(action: "undo" | "redo") {
    if (historyBusy || pendingHistoryByOperation.size) return;
    const entry = action === "undo" ? history.takeUndo() : history.takeRedo();
    if (!entry) return;
    historyBusy = true;
    if (!persistHistory(entry, action)) {
      if (action === "undo") history.restoreUndo(entry);
      else history.restoreRedo(entry);
      historyBusy = false;
    }
  }

  // --------------------------------------------------
  // Event Handlers
  // --------------------------------------------------

  // Prevent default context menu.
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  const clientToWorld = (clientX: number, clientY: number) => ({
    x: (clientX - state.offsetX) / state.scale,
    y: (clientY - state.offsetY) / state.scale,
  });

  const freehandBuilder = new FreehandBuilder(() => state.scale);
  const drawingInput = new PointerToolLifecycle(
    canvas,
    {
      enabled: () =>
        ["freehand", "eraser", "precision-eraser"].includes(
          modeRef.current ?? "",
        ),
      down: (event, point) => {
        pointerToolActive = true;
        activePointerTool = modeRef.current as typeof activePointerTool;
        state.selectedShapeIds = [];
        state.isMarqueeSelecting = false;
        if (activePointerTool === "freehand") {
          state.isFreehandDrawing = true;
          freehandBuilder.clear();
          freehandBuilder.add(point, event.pointerType);
          state.freehandPoints = freehandBuilder.getRawPoints();
        } else {
          state.isErasing = true;
          state.eraserPoints = [point];
        }
        scheduleRender();
      },
      move: (event, point) => {
        if (activePointerTool === "freehand") {
          freehandBuilder.add(point, event.pointerType);
          state.freehandPoints = freehandBuilder.getRawPoints();
        } else if (activePointerTool && state.eraserPoints.length < 4096) {
          const last = state.eraserPoints.at(-1)!;
          if (
            Math.hypot(point.x - last.x, point.y - last.y) >
            Math.max(0.5, 1 / state.scale)
          )
            state.eraserPoints.push(point);
        }
        scheduleRender();
      },
      up: () => {
        if (activePointerTool === "freehand") finalizeFreehandDrawing();
        else if (activePointerTool) finalizeEraserDrawing();
        activePointerTool = null;
        pointerToolActive = false;
      },
      cancel: () => {
        state.isFreehandDrawing = false;
        state.isErasing = false;
        state.freehandPoints = [];
        state.eraserPoints = [];
        activePointerTool = null;
        pointerToolActive = false;
        freehandBuilder.clear();
        scheduleRender();
      },
    },
    clientToWorld,
  );

  //  new chnages

  function handleMouseDown(e: MouseEvent) {
    if (
      pointerToolActive ||
      ["freehand", "eraser", "precision-eraser"].includes(modeRef.current ?? "")
    )
      return;
    // `ctx` is guaranteed non-null here due to the initial check in initDraw
    const { x: worldX, y: worldY } = clientToWorld(e.clientX, e.clientY);
    if (activeTransform) return;
    const isCtrlOrCmdPressed = e.ctrlKey || e.metaKey;

    // 1. Handle active text preview (highest priority as it's an overlay)
    if (state.textPreview && modeRef.current === "text") {
      activeTextCleanup?.(); // Finalize current text input
      return;
    }

    // 2. Handle right-click for panning (second highest priority)
    if (e.button === 2) {
      state.isPanning = true;
      state.panStartX = e.clientX - state.offsetX;
      state.panStartY = e.clientY - state.offsetY; // FIXED: Corrected this line
      state.selectedShapeIds = []; // Clear selection on pan start
      state.isMarqueeSelecting = false; // Ensure marquee is off
      scheduleRender();
      return;
    }

    // 3. Handle interactions based on the current drawing mode (left-click)
    switch (modeRef.current) {
      case "select":
        handleSelectionStart(worldX, worldY, isCtrlOrCmdPressed);
        break;

      case "freehand":
      case "eraser":
      case "precision-eraser":
        break;

      case "text":
        // Text input is handled by double-click, so single click does nothing specific here
        break;

      case "rect":
      case "circle":
      case "line":
      case "triangle":
      case "arrow":
        startDrawingMode(worldX, worldY);
        break;

      case null: // No mode selected, potentially clear selection
        state.selectedShapeIds = [];
        state.isMarqueeSelecting = false;
        scheduleRender();
        break;
    }
  }

  // Helper for starting selection (single or marquee)
  function handleSelectionStart(
    worldX: number,
    worldY: number,
    additive: boolean,
  ) {
    const selected = state.selectedShapeIds
      .map((id) => scene.get(id))
      .filter((e): e is CanvasElement => !!e);
    const bounds = selectionBounds(selected);
    if (bounds) {
      const handle = hitSelectionHandle(
        bounds,
        { x: worldX, y: worldY },
        state.scale,
      );
      if (handle) {
        beginTransform(
          handle === "rotate" ? "rotate" : "resize",
          { x: worldX, y: worldY },
          handle,
        );
        return;
      }
    }
    const hit = scene.hit(worldX, worldY, 8 / state.scale);
    if (hit) {
      const hitIds = hit.groupId
        ? state.shapes
            .filter((shape) => shape.groupId === hit.groupId)
            .map((shape) => shape.id)
        : [hit.id];
      const alreadySelected = hitIds.every((id) =>
        state.selectedShapeIds.includes(id),
      );
      if (additive) {
        state.selectedShapeIds = alreadySelected
          ? state.selectedShapeIds.filter((id) => !hitIds.includes(id))
          : [...new Set([...state.selectedShapeIds, ...hitIds])];
      } else if (!alreadySelected) state.selectedShapeIds = hitIds;
      state.isMarqueeSelecting = false;
      if (!additive || !alreadySelected)
        beginTransform("move", { x: worldX, y: worldY }, null);
    } else {
      state.isMarqueeSelecting = true;
      state.marqueeStartX = worldX;
      state.marqueeStartY = worldY;
      state.marqueeCurrentX = worldX;
      state.marqueeCurrentY = worldY;
      if (!additive) state.selectedShapeIds = [];
    }
    scheduleRender();
  }

  function beginTransform(
    kind: "move" | "resize" | "rotate",
    start: Point,
    handle: NonNullable<ReturnType<typeof hitSelectionHandle>> | null,
  ) {
    const originals = new Map<string, Shape>();
    for (const id of state.selectedShapeIds) {
      const shape = state.shapes.find((item) => item.id === id);
      if (shape) originals.set(id, structuredClone(shape));
    }
    const bounds = selectionBounds([
      ...originals.values(),
    ] as unknown as CanvasElement[]);
    if (!bounds || !originals.size) return;
    const center = {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    };
    activeTransform = {
      kind,
      handle,
      start,
      bounds,
      center,
      startAngle: Math.atan2(start.y - center.y, start.x - center.x),
      originals,
    };
  }

  function updateTransformPreview(x: number, y: number, snap: boolean) {
    const transform = activeTransform;
    if (!transform) return;
    const dx = x - transform.start.x,
      dy = y - transform.start.y;
    let target = transform.bounds;
    let angle =
      Math.atan2(y - transform.center.y, x - transform.center.x) -
      transform.startAngle;
    if (transform.kind === "resize" && transform.handle)
      target = resizedSelectionBounds(
        transform.bounds,
        transform.handle,
        x,
        y,
        snap,
      );
    if (transform.kind === "rotate" && snap)
      angle = Math.round(angle / (Math.PI / 12)) * (Math.PI / 12);
    transformPreviews.clear();
    hiddenTransformIds.clear();
    for (const [id, original] of transform.originals) {
      const element = original as unknown as CanvasElement;
      const next =
        transform.kind === "move"
          ? translateElement(element, dx, dy)
          : transform.kind === "resize"
            ? resizeElement(element, transform.bounds, target)
            : rotateElement(element, transform.center, angle);
      transformPreviews.set(id, next);
      hiddenTransformIds.add(id);
    }
    renderer.invalidateScene();
    renderer.invalidateOverlay();
    scheduleRender();
  }

  function resizedSelectionBounds(
    original: NonNullable<ReturnType<typeof selectionBounds>>,
    handle: NonNullable<ReturnType<typeof hitSelectionHandle>>,
    x: number,
    y: number,
    proportional: boolean,
  ) {
    const next = { ...original };
    if (handle.includes("w")) next.minX = x;
    if (handle.includes("e")) next.maxX = x;
    if (handle.includes("n")) next.minY = y;
    if (handle.includes("s")) next.maxY = y;
    const min = 2 / state.scale;
    if (next.maxX - next.minX < min) {
      if (handle.includes("w")) next.minX = next.maxX - min;
      else next.maxX = next.minX + min;
    }
    if (next.maxY - next.minY < min) {
      if (handle.includes("n")) next.minY = next.maxY - min;
      else next.maxY = next.minY + min;
    }
    if (proportional) {
      const ratio =
        (original.maxX - original.minX) /
        Math.max(0.001, original.maxY - original.minY);
      let w = next.maxX - next.minX,
        h = next.maxY - next.minY;
      if (
        Math.abs(w / (original.maxX - original.minX) - 1) >=
        Math.abs(h / (original.maxY - original.minY) - 1)
      )
        h = w / ratio;
      else w = h * ratio;
      if (handle.includes("w")) next.minX = next.maxX - w;
      else next.maxX = next.minX + w;
      if (handle.includes("n")) next.minY = next.maxY - h;
      else next.maxY = next.minY + h;
    }
    return next;
  }

  function finishTransform() {
    const transform = activeTransform;
    if (!transform) return;
    const changes: ElementChange[] = [];
    for (const [id, before] of transform.originals) {
      const after = transformPreviews.get(id);
      if (after)
        changes.push({ id, before: before as unknown as CanvasElement, after });
    }
    activeTransform = null;
    transformPreviews.clear();
    hiddenTransformIds.clear();
    for (const change of changes) setLocalElement(change.id, change.after);
    if (changes.length)
      persistHistory({ label: transform.kind, changes }, "push");
    scheduleRender();
  }

  // Helper for starting freehand or eraser drawing
  function startFreehandOrEraser(
    worldX: number,
    worldY: number,
    mode: "freehand" | "eraser",
  ) {
    state.selectedShapeIds = []; // Clear selection when starting a new drawing
    state.isMarqueeSelecting = false; // Ensure marquee is off
    const points = [{ x: worldX, y: worldY }];
    if (mode === "eraser") {
      state.isErasing = true;
      state.eraserPoints = points;
    } else {
      // freehand
      state.isFreehandDrawing = true;
      state.freehandPoints = points;
    }
    scheduleRender();
  }

  // Helper for starting a new shape drawing
  function startDrawingMode(worldX: number, worldY: number) {
    state.selectedShapeIds = []; // Clear selection when starting a new drawing
    state.isMarqueeSelecting = false; // Ensure marquee is off
    state.isDrawing = true;
    state.startX = worldX;
    state.startY = worldY;
    state.currentX = worldX;
    state.currentY = worldY;
    scheduleRender();
  }

  // Mousemove handler.
  function handleMouseMove(e: MouseEvent) {
    if (
      pointerToolActive ||
      ["freehand", "eraser", "precision-eraser"].includes(modeRef.current ?? "")
    )
      return;
    const { x: worldX, y: worldY } = clientToWorld(e.clientX, e.clientY);
    if (activeTransform) {
      updateTransformPreview(worldX, worldY, e.shiftKey);
      return;
    }

    // Prioritize active drawing/panning states
    if (state.isErasing) {
      state.eraserPoints.push({ x: worldX, y: worldY });
    } else if (state.isFreehandDrawing) {
      state.freehandPoints.push({ x: worldX, y: worldY });
    } else if (state.isDrawing) {
      state.currentX = worldX;
      state.currentY = worldY;
    } else if (state.isPanning) {
      state.offsetX = e.clientX - state.panStartX;
      state.offsetY = e.clientY - state.panStartY;
    } else if (modeRef.current === "select" && state.isMarqueeSelecting) {
      state.marqueeCurrentX = worldX;
      state.marqueeCurrentY = worldY;
    } else {
      // No active drawing/panning/marquee, no need to render
      return;
    }
    scheduleRender(); // Only render if a state change occurred
  }

  // Mouseup handler.
  function handleMouseUp(e: MouseEvent) {
    if (
      pointerToolActive ||
      ["freehand", "eraser", "precision-eraser"].includes(modeRef.current ?? "")
    )
      return;
    // `ctx` is guaranteed non-null here due to the initial check in initDraw
    const { x: worldX, y: worldY } = clientToWorld(e.clientX, e.clientY);
    if (activeTransform) {
      finishTransform();
      return;
    }
    const isCtrlOrCmdPressed = e.ctrlKey || e.metaKey;

    // 1. Handle right-click for ending panning
    if (e.button === 2 && state.isPanning) {
      state.isPanning = false;
      // No scheduleRender needed here, as mousemove already did it on last pan
      return;
    }

    // 2. Handle ending actions based on the current drawing mode
    switch (modeRef.current) {
      case "freehand":
        if (state.isFreehandDrawing) {
          finalizeFreehandDrawing();
        }
        break;

      case "eraser":
        if (state.isErasing) {
          finalizeEraserDrawing();
        }
        break;

      case "rect":
      case "circle":
      case "line":
      case "triangle":
      case "arrow":
        if (state.isDrawing) {
          finalizeDrawingMode(worldX, worldY);
        }
        break;

      case "select":
        if (state.isMarqueeSelecting) {
          endMarqueeSelection(worldX, worldY, isCtrlOrCmdPressed);
        }
        // If it was a single click in select mode (not marquee), no action needed here
        break;

      case "text":
      case null:
        // No specific mouseup action for these modes
        break;
    }
  }

  // Helper for finalizing freehand drawing
  function finalizeFreehandDrawing() {
    state.isFreehandDrawing = false;
    if (state.freehandPoints.length > 0) {
      // Only add if points exist
      const newShape: Shape = {
        id: crypto.randomUUID(),
        type: "freehand",
        points: freehandBuilder.getPoints(),
        strokeColor: strokeColorRef.current,
        strokeWidth: strokeWidthRef.current,
      };
      state.shapes.push(newShape);
      setSceneElement(newShape);
      sendShapeMessage(newShape);
    }
    state.freehandPoints = [];
    freehandBuilder.clear();
    scheduleRender();
  }

  // Helper for finalizing eraser drawing
  function finalizeEraserDrawing() {
    state.isErasing = false;
    const trajectory = state.eraserPoints.slice();
    const precise = activePointerTool === "precision-eraser";
    state.eraserPoints = [];
    if (trajectory.length) eraseAlongPath(trajectory, precise);
    scheduleRender();
  }

  function eraseAlongPath(trajectory: Point[], precise: boolean) {
    const radius = (strokeWidthRef.current * 5) / state.scale;
    const bounds = {
      minX: Math.min(...trajectory.map((p) => p.x)) - radius,
      minY: Math.min(...trajectory.map((p) => p.y)) - radius,
      maxX: Math.max(...trajectory.map((p) => p.x)) + radius,
      maxY: Math.max(...trajectory.map((p) => p.y)) + radius,
    };
    const candidates = scene
      .query(bounds)
      .filter((shape) => sweptIntersects(shape, trajectory, radius));
    const shapeIndexes = new Map(
      state.shapes.map((shape, index) => [shape.id, index]),
    );
    const historyChanges: ElementChange[] = [];
    const replacements = new Map<string, Shape[]>();
    const deletions = new Set<string>();
    for (const candidate of candidates) {
      const shape = candidate as unknown as Shape;
      const index = shapeIndexes.get(shape.id);
      if (index === undefined || deletions.has(shape.id)) continue;
      if (precise && shape.type === "freehand") {
        const pieces = splitFreehand(
          shape.points,
          trajectory,
          radius,
          shape.strokeWidth,
        );
        const orderedPieces = pieces.map((points, part) => ({
          ...shape,
          id: crypto.randomUUID(),
          points,
          order: index + (part + 1) / (pieces.length + 1),
        })) as Shape[];
        if (historyChanges.length + 1 + orderedPieces.length > 100) {
          window.dispatchEvent(
            new CustomEvent("canvas:persistence-error", {
              detail: "This stroke produced too many pieces to erase safely",
            }),
          );
          continue;
        }
        historyChanges.push({
          id: shape.id,
          before: shape as unknown as CanvasElement,
          after: null,
        });
        for (const element of orderedPieces)
          historyChanges.push({
            id: element.id,
            before: null,
            after: element as unknown as CanvasElement,
          });
        deletions.add(shape.id);
        replacements.set(shape.id, orderedPieces);
      } else {
        historyChanges.push({
          id: shape.id,
          before: shape as unknown as CanvasElement,
          after: null,
        });
        deletions.add(shape.id);
      }
    }
    if (!deletions.size) return;
    if (historyChanges.length > 100) {
      window.dispatchEvent(
        new CustomEvent("canvas:persistence-error", {
          detail: "Erase fewer objects at once",
        }),
      );
      return;
    }
    const next: Shape[] = [];
    for (const shape of state.shapes) {
      if (!deletions.has(shape.id)) next.push(shape);
      else next.push(...(replacements.get(shape.id) ?? []));
    }
    state.shapes = next;
    for (const id of deletions) scene.delete(id);
    for (const pieces of replacements.values())
      for (const piece of pieces) setSceneElement(piece);
    state.selectedShapeIds = state.selectedShapeIds.filter(
      (id) => !deletions.has(id),
    );
    renderer.invalidateScene();
    persistHistory({ label: "Erase", changes: historyChanges }, "push");
  }

  // Helper for finalizing regular shape drawing
  function finalizeDrawingMode(finalX: number, finalY: number) {
    state.isDrawing = false;
    let newShape: Shape | null = null;

    switch (modeRef.current) {
      case "rect":
        newShape = {
          id: crypto.randomUUID(),
          type: "rectangle",
          x: state.startX,
          y: state.startY,
          width: finalX - state.startX,
          height: finalY - state.startY,
          strokeColor: strokeColorRef.current,
          strokeWidth: strokeWidthRef.current,
        };
        break;
      case "circle":
        const centerX = (state.startX + finalX) / 2;
        const centerY = (state.startY + finalY) / 2;
        newShape = {
          id: crypto.randomUUID(),
          type: "circle",
          x: centerX,
          y: centerY,
          radiusX: Math.abs(finalX - state.startX) / 2,
          radiusY: Math.abs(finalY - state.startY) / 2,
          strokeColor: strokeColorRef.current,
          strokeWidth: strokeWidthRef.current,
        };
        break;
      case "line":
        newShape = {
          id: crypto.randomUUID(),
          type: "line",
          x1: state.startX,
          y1: state.startY,
          x2: finalX,
          y2: finalY,
          strokeColor: strokeColorRef.current,
          strokeWidth: strokeWidthRef.current,
        };
        break;
      case "triangle":
        const dx = finalX - state.startX;
        const dy = finalY - state.startY;
        const midX = (state.startX + finalX) / 2;
        const midY = (state.startY + finalY) / 2;
        const thirdX = midX - dy * (Math.sqrt(3) / 2);
        const thirdY = midY + dx * (Math.sqrt(3) / 2);
        newShape = {
          id: crypto.randomUUID(),
          type: "triangle",
          x1: state.startX,
          y1: state.startY,
          x2: finalX,
          y2: finalY,
          x3: thirdX,
          y3: thirdY,
          strokeColor: strokeColorRef.current,
          strokeWidth: strokeWidthRef.current,
        };
        break;
      case "arrow":
        newShape = {
          id: crypto.randomUUID(),
          type: "arrow",
          x1: state.startX,
          y1: state.startY,
          x2: finalX,
          y2: finalY,
          strokeColor: strokeColorRef.current,
          strokeWidth: strokeWidthRef.current,
        };
        break;
    }

    if (newShape) {
      state.shapes.push(newShape);
      setSceneElement(newShape);
      sendShapeMessage(newShape);
    }
    state.currentX = undefined;
    state.currentY = undefined;
    scheduleRender();
  }

  // Helper for ending marquee selection
  function endMarqueeSelection(
    worldX: number,
    worldY: number,
    isCtrlOrCmdPressed: boolean,
  ) {
    if (!ctx) return;
    state.isMarqueeSelecting = false;

    const rectX = Math.min(state.marqueeStartX, worldX);
    const rectY = Math.min(state.marqueeStartY, worldY);
    const rectWidth = Math.abs(worldX - state.marqueeStartX);
    const rectHeight = Math.abs(worldY - state.marqueeStartY);

    const marqueeBounds = {
      x: rectX,
      y: rectY,
      width: rectWidth,
      height: rectHeight,
    };

    // Clear existing selections IF Ctrl/Cmd was NOT pressed (for new marquee selection)
    if (!isCtrlOrCmdPressed) {
      state.selectedShapeIds = [];
    }

    // Add shapes that intersect with the marquee selection
    scene
      .query({
        minX: marqueeBounds.x,
        minY: marqueeBounds.y,
        maxX: marqueeBounds.x + marqueeBounds.width,
        maxY: marqueeBounds.y + marqueeBounds.height,
      })
      .forEach((shape) => {
        const shapeBounds = getShapeBounds(ctx, shape as unknown as Shape);
        if (shapeBounds) {
          // Check for intersection between marqueeBounds and shapeBounds
          if (
            marqueeBounds.x < shapeBounds.x + shapeBounds.width &&
            marqueeBounds.x + marqueeBounds.width > shapeBounds.x &&
            marqueeBounds.y < shapeBounds.y + shapeBounds.height &&
            marqueeBounds.y + marqueeBounds.height > shapeBounds.y
          ) {
            // Only add if not already selected (important for Ctrl/Cmd mode)
            if (!state.selectedShapeIds.includes(shape.id)) {
              state.selectedShapeIds.push(shape.id);
            }
          }
        }
      });

    // Reset marquee coordinates
    state.marqueeStartX = 0;
    state.marqueeStartY = 0;
    state.marqueeCurrentX = 0;
    state.marqueeCurrentY = 0;

    scheduleRender(); // Rerender to show new selections
  }

  // Wheel (zoom) handler.
  function handleWheel(e: WheelEvent) {
    e.preventDefault();
    let newScale = state.scale * Math.exp(-e.deltaY * 0.001);
    newScale = Math.max(0.05, Math.min(64, newScale));
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const worldX = (mouseX - state.offsetX) / state.scale;
    const worldY = (mouseY - state.offsetY) / state.scale;
    state.offsetX = mouseX - worldX * newScale;
    state.offsetY = mouseY - worldY * newScale;
    state.scale = newScale;
    scheduleRender();
  }

  // --------------------------------------------------
  // Double-click for text input.
  // --------------------------------------------------
  function handleDoubleClick(e: MouseEvent) {
    if (modeRef.current !== "text") return;

    // If a text input session is already active, clean it up first.
    if (activeTextCleanup) {
      activeTextCleanup();
    }

    const worldX = (e.clientX - state.offsetX) / state.scale;
    const worldY = (e.clientY - state.offsetY) / state.scale;
    state.textPreview = { x: worldX, y: worldY, text: "", showCursor: true };
    scheduleRender();

    function updateText(newText: string) {
      if (state.textPreview) {
        state.textPreview.text = newText;
        scheduleRender();
      }
    }

    function toggleCursor() {
      if (state.textPreview) {
        state.textPreview.showCursor = !state.textPreview.showCursor;
        scheduleRender();
      }
    }

    const cursorInterval = setInterval(toggleCursor, 500);

    // pressing Enter inserts a newline.
    function handleKeydown(event: KeyboardEvent) {
      if (!state.textPreview) return;
      if (event.key === "Enter") {
        updateText(state.textPreview.text + "\n");
        event.preventDefault();
      } else if (event.key === "Backspace") {
        updateText(state.textPreview.text.slice(0, -1));
      } else if (event.key.length === 1) {
        // This condition is good for single character keys
        updateText(state.textPreview.text + event.key);
      }
    }

    // This mousedown listener cancels the text input (saving the text) if the user clicks elsewhere.
    function handleTextCancel(e: MouseEvent) {
      cleanup(); // Calls the inner cleanup function
    }

    function cleanup() {
      clearInterval(cursorInterval);
      // Finalize the text if any non-empty content exists.
      if (state.textPreview && state.textPreview.text.trim().length > 0) {
        const newShape: Shape = {
          id: crypto.randomUUID(),
          type: "text",
          x: state.textPreview.x,
          y: state.textPreview.y,
          content: state.textPreview.text,
          strokeColor: strokeColorRef.current,
          strokeWidth: strokeWidthRef.current,
        };
        state.shapes.push(newShape);
        setSceneElement(newShape);
        sendShapeMessage(newShape);
      }
      state.textPreview = undefined;
      document.removeEventListener("keydown", handleKeydown);
      canvas.removeEventListener("mousedown", handleTextCancel);
      scheduleRender();
      activeTextCleanup = null;
    }

    document.addEventListener("keydown", handleKeydown);
    canvas.addEventListener("mousedown", handleTextCancel);
    activeTextCleanup = cleanup; // Store the cleanup function
  }

  function selectedShapes() {
    const selected = new Set(state.selectedShapeIds);
    return state.shapes.filter((shape) => selected.has(shape.id));
  }

  function changeGroup(ungroup: boolean) {
    const selected = selectedShapes();
    if (!selected.length) return;
    const groupId = ungroup ? null : crypto.randomUUID();
    const changes: ElementChange[] = selected.map((before) => {
      const after = { ...before } as Shape;
      if (groupId) after.groupId = groupId;
      else delete after.groupId;
      return {
        id: before.id,
        before: before as unknown as CanvasElement,
        after: after as unknown as CanvasElement,
      };
    });
    for (const change of changes) setLocalElement(change.id, change.after);
    persistHistory({ label: ungroup ? "Ungroup" : "Group", changes }, "push");
    scheduleRender();
  }

  function reorderSelection(
    direction: "front" | "back" | "forward" | "backward",
  ) {
    const ordered = scene.all().map((element) => element as unknown as Shape);
    const selected = new Set(state.selectedShapeIds);
    if (!selected.size) return;
    let next = [...ordered];
    if (direction === "front")
      next = [
        ...next.filter((shape) => !selected.has(shape.id)),
        ...next.filter((shape) => selected.has(shape.id)),
      ];
    else if (direction === "back")
      next = [
        ...next.filter((shape) => selected.has(shape.id)),
        ...next.filter((shape) => !selected.has(shape.id)),
      ];
    else if (direction === "forward") {
      for (let i = next.length - 2; i >= 0; i--)
        if (selected.has(next[i]!.id) && !selected.has(next[i + 1]!.id))
          [next[i], next[i + 1]] = [next[i + 1]!, next[i]!];
    } else {
      for (let i = 1; i < next.length; i++)
        if (selected.has(next[i]!.id) && !selected.has(next[i - 1]!.id))
          [next[i], next[i - 1]] = [next[i - 1]!, next[i]!];
    }
    const changes: ElementChange[] = [];
    next.forEach((before, order) => {
      if (before.order === order) return;
      const after = { ...before, order } as Shape;
      changes.push({
        id: before.id,
        before: before as unknown as CanvasElement,
        after: after as unknown as CanvasElement,
      });
    });
    if (!changes.length) return;
    for (const change of changes) setLocalElement(change.id, change.after);
    persistHistory({ label: "Layer order", changes }, "push");
    scheduleRender();
  }

  function pasteSelection(duplicate = false) {
    const source = duplicate ? selectedShapes() : elementClipboard;
    if (!source.length) return;
    if (!duplicate) elementClipboard = structuredClone(source);
    const groups = new Map<string, string>();
    const copies = source.map((shape, index) => {
      const copy = translateElement(
        shape as unknown as CanvasElement,
        20 / state.scale,
        20 / state.scale,
      ) as unknown as Shape;
      copy.id = crypto.randomUUID();
      copy.order = scene.size + index;
      if (copy.groupId) {
        if (!groups.has(copy.groupId))
          groups.set(copy.groupId, crypto.randomUUID());
        copy.groupId = groups.get(copy.groupId)!;
      }
      return copy;
    });
    const changes: ElementChange[] = copies.map((after) => ({
      id: after.id,
      before: null,
      after: after as unknown as CanvasElement,
    }));
    for (const copy of copies)
      setLocalElement(copy.id, copy as unknown as CanvasElement);
    state.selectedShapeIds = copies.map((shape) => shape.id);
    persistHistory(
      { label: duplicate ? "Duplicate" : "Paste", changes },
      "push",
    );
    scheduleRender();
  }

  function deleteSelection() {
    const changes: ElementChange[] = selectedShapes().map((before) => ({
      id: before.id,
      before: before as unknown as CanvasElement,
      after: null,
    }));
    if (!changes.length) return;
    for (const change of changes) setLocalElement(change.id, null);
    state.selectedShapeIds = [];
    persistHistory({ label: "Delete", changes }, "push");
    scheduleRender();
  }

  function isTypingTarget(target: EventTarget | null) {
    return (
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
    );
  }

  function handleCanvasKeydown(event: KeyboardEvent) {
    if (isTypingTarget(event.target) || activeTextCleanup) return;
    const command = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (command && key === "z") {
      event.preventDefault();
      performHistory(event.shiftKey ? "redo" : "undo");
    } else if (command && key === "y") {
      event.preventDefault();
      performHistory("redo");
    } else if (command && key === "a") {
      event.preventDefault();
      state.selectedShapeIds = state.shapes.map((shape) => shape.id);
      scheduleRender();
    } else if (command && key === "c") {
      if (state.selectedShapeIds.length) {
        event.preventDefault();
        elementClipboard = structuredClone(selectedShapes());
      }
    } else if (command && key === "v") {
      event.preventDefault();
      pasteSelection();
    } else if (command && key === "d") {
      event.preventDefault();
      pasteSelection(true);
    } else if (command && key === "g") {
      event.preventDefault();
      changeGroup(event.shiftKey);
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      deleteSelection();
    } else if (event.key === "Escape") {
      state.selectedShapeIds = [];
      state.isMarqueeSelecting = false;
      scheduleRender();
    } else if (event.altKey && event.key === "ArrowUp") {
      event.preventDefault();
      reorderSelection(event.shiftKey ? "front" : "forward");
    } else if (event.altKey && event.key === "ArrowDown") {
      event.preventDefault();
      reorderSelection(event.shiftKey ? "back" : "backward");
    } else if (
      state.selectedShapeIds.length &&
      ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)
    ) {
      event.preventDefault();
      const step = (event.shiftKey ? 10 : 1) / state.scale;
      const dx =
        event.key === "ArrowLeft"
          ? -step
          : event.key === "ArrowRight"
            ? step
            : 0;
      const dy =
        event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
      const changes: ElementChange[] = selectedShapes().map((before) => ({
        id: before.id,
        before: before as unknown as CanvasElement,
        after: translateElement(before as unknown as CanvasElement, dx, dy),
      }));
      for (const change of changes) setLocalElement(change.id, change.after);
      if (changes.length) persistHistory({ label: "Nudge", changes }, "push");
      scheduleRender();
    }
  }

  function runCanvasCommand(
    command:
      | "undo"
      | "redo"
      | "group"
      | "ungroup"
      | "front"
      | "back"
      | "forward"
      | "backward"
      | "delete",
  ) {
    if (command === "undo" || command === "redo") performHistory(command);
    else if (command === "group" || command === "ungroup")
      changeGroup(command === "ungroup");
    else if (command === "delete") deleteSelection();
    else reorderSelection(command);
  }

  // Register event listeners.
  canvas.addEventListener("mousedown", handleMouseDown);
  window.addEventListener("mousemove", handleMouseMove);
  window.addEventListener("mouseup", handleMouseUp);
  canvas.addEventListener("wheel", handleWheel);
  canvas.addEventListener("dblclick", handleDoubleClick);
  const handleWindowResize = () => scheduleRender();
  window.addEventListener("resize", handleWindowResize);
  document.addEventListener("keydown", handleCanvasKeydown);

  // Initial render.
  scheduleRender();

  return {
    cleanup: function cleanup() {
      drawingInput.dispose();
      canvas.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      canvas.removeEventListener("wheel", handleWheel);
      canvas.removeEventListener("dblclick", handleDoubleClick);
      window.removeEventListener("resize", handleWindowResize);
      document.removeEventListener("keydown", handleCanvasKeydown);
      imageCache.clear();
      if (renderFrame) cancelAnimationFrame(renderFrame);
      renderFrame = 0;
      renderRequested = false;
      renderer.dispose();
      if (activeTextCleanup) {
        activeTextCleanup();
      }
    },
    addShapeLocally: addShapeLocally,
    isCanvasEmpty: isCanvasEmpty,
    getSelectedShapesInfo: getSelectedShapesInfo,
    deleteShapeById: deleteShapeById,
    editSelectionStyle,
    runCanvasCommand,
    clearLocally,
    captureSelectedAreaBlob: captureSelectedAreaBlob,
  };
}
