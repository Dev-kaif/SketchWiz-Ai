export type Point = { x: number; y: number };

export type ElementStyle = {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  opacity?: number;
  strokeColor?: string;
  strokeWidth?: number;
  fillColor?: string;
  order?: number;
  groupId?: string;
};

export type CanvasElement =
  | (ElementStyle & {
      type: "rectangle";
      x: number;
      y: number;
      width: number;
      height: number;
    })
  | (ElementStyle & {
      type: "circle";
      x: number;
      y: number;
      radiusX: number;
      radiusY: number;
    })
  | (ElementStyle & {
      type: "line" | "arrow";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    })
  | (ElementStyle & {
      type: "triangle";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      x3: number;
      y3: number;
    })
  | (ElementStyle & {
      type: "freehand" | "eraser";
      points: Point[];
      size?: number;
    })
  | (ElementStyle & { type: "text"; x: number; y: number; content: string })
  | (ElementStyle & {
      type: "image";
      x: number;
      y: number;
      width: number;
      height: number;
      src?: string;
      assetId?: string;
    });

export type VersionedElement = { schemaVersion: 1; element: CanvasElement };

/** Preserves legacy geometry as-is; normalization only adds the version envelope. */
export function fromLegacyElement(value: unknown): VersionedElement | null {
  if (!value || typeof value !== "object") return null;
  const element = value as Record<string, unknown>;
  if (typeof element.id !== "string" || typeof element.type !== "string")
    return null;
  // Preserve unknown historical types for a later compatibility renderer.
  return {
    schemaVersion: 1,
    element: structuredClone(element) as CanvasElement,
  };
}
