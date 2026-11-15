"use client";

import { useEffect, useRef, useState } from "react";
import initDraw from "../../../Component/canvas Logic";
import { Shape } from "../../../Component/canvas Logic";
import {
  Circle,
  Eraser,
  Minus,
  MoveRight,
  Pencil,
  RectangleHorizontal,
  Triangle,
  TypeOutline,
  Settings as SettingsIcon,
  Trash,
  LogOut,
  X,
  Play,
  TextCursor,
  Scissors,
  ZoomIn,
  ZoomOut,
  Undo2,
  Redo2,
} from "lucide-react";
import useSocket from "../../../Component/socket/useSocket";
import axios from "axios";
import { BACKEND_URL } from "../../../Component/Config";
import { useNotification } from "../../../Component/notification/notification";
import { useRouter } from "next/navigation";

// Define available drawing modes
type DrawingMode =
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
  | null;

interface Param {
  params: Promise<{ slug: string }>;
}

type CanvasViewport = {
  zoom: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  content: { minX: number; minY: number; maxX: number; maxY: number } | null;
  items: Array<{ minX: number; minY: number; maxX: number; maxY: number }>;
};

const Page = ({ params }: Param) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const eraserCursorRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef<DrawingMode>(null);
  const [mode, setMode] = useState<DrawingMode>(null);
  const [dimensions, setDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [viewport, setViewport] = useState<CanvasViewport | null>(null);

  const { addNotification } = useNotification();
  // Stroke settings (default: white & 3)
  const [strokeColor, setStrokeColor] = useState("#ffffff");
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [fillColor, setFillColor] = useState("#ffffff");
  const [elementOpacity, setElementOpacity] = useState(1);

  // New state for storing the AI response
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [runningAi, setRunningAi] = useState(false);
  const [improvingAi, setImprovingAi] = useState(false);

  // Refs to hold dynamic stroke settings so they’re used in drawing operations.
  const strokeColorRef = useRef(strokeColor);
  const strokeWidthRef = useRef(strokeWidth);
  const router = useRouter();
  const socket = useSocket();
  const latestSocketRef = useRef<WebSocket | null>(socket);
  latestSocketRef.current = socket;
  const currentUserIdRef = useRef<number | null>(null);
  const canvasInitStartedRef = useRef(false);
  const canvasAliveRef = useRef(true);
  const [connectionStatus, setConnectionStatus] = useState("connecting");
  const [pendingSaves, setPendingSaves] = useState(0);
  const [canvasInitRetry, setCanvasInitRetry] = useState(0);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [collaborators, setCollaborators] = useState<
    Array<{
      userId: number;
      name: string;
      color: string;
      x?: number;
      y?: number;
    }>
  >([]);
  const [roomId, setRoomId] = useState();
  const [roomRole, setRoomRole] = useState<string | null>(null);
  const [roomOwnerId, setRoomOwnerId] = useState<number | null>(null);

  useEffect(() => {
    let lastUpdate = 0;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let latest: CanvasViewport | undefined;
    const onViewport = (event: Event) => {
      latest = (event as CustomEvent<CanvasViewport>).detail;
      const elapsed = performance.now() - lastUpdate;
      if (elapsed >= 80) {
        lastUpdate = performance.now();
        setViewport(latest);
      } else if (!timeout) {
        timeout = setTimeout(() => {
          if (latest) setViewport(latest);
          lastUpdate = performance.now();
          timeout = undefined;
        }, 80 - elapsed);
      }
    };
    window.addEventListener("canvas:viewport", onViewport);
    return () => {
      window.removeEventListener("canvas:viewport", onViewport);
      if (timeout) clearTimeout(timeout);
    };
  }, []);

  useEffect(() => {
    const onToolChange = (event: Event) => {
      const nextMode = (event as CustomEvent<DrawingMode>).detail;
      modeRef.current = nextMode;
      setMode(nextMode);
    };
    window.addEventListener("canvas:tool-change", onToolChange);
    return () => window.removeEventListener("canvas:tool-change", onToolChange);
  }, []);

  useEffect(() => {
    async function getRoomId() {
      const slug = (await params).slug;
      const roomIdRes = await axios.get(`${BACKEND_URL}/api/room/slug/${slug}`);
      const room = roomIdRes.data.room.id;
      setRoomId(room);
      setRoomRole(roomIdRes.data.role ?? null);
      setRoomOwnerId(roomIdRes.data.room.adminId ?? null);
    }
    getRoomId();
  }, [params]);

  // Helper function that formats the AI response by removing curly braces and quotes.
  const formatAIResponse = (response: string) => {
    try {
      const parsed = JSON.parse(response);
      return Object.entries(parsed)
        .map(([key, value]) => {
          // If the value is an object, stringify it with indentation.
          const formattedValue =
            typeof value === "object" && value !== null
              ? JSON.stringify(value, null, 2)
              : value;
          return `${key}: ${formattedValue}`;
        })
        .join("\n");
    } catch (error: any) {
      return response;
    }
  };

  // AI send handler
  const handleSend = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setRunningAi(true);
    // Convert the canvas content to a Blob.
    canvas.toBlob(async (blob) => {
      if (!blob || !socket) {
        return;
      }

      // Prepare FormData and append the blob.
      const formData = new FormData();
      formData.append("image", blob, "canvas.png");

      try {
        // Send a POST request to the /analyze endpoint using Axios.
        const response = await axios.post(
          `${BACKEND_URL}/api/analyze/ai`,
          formData,
          {
            headers: {
              "Content-Type": "multipart/form-data",
            },
          },
        );

        // Store the first analysis result as a string in state.
        setAiResponse(JSON.stringify(response.data.analysisResult[0]));
        const message = {
          type: "ai",
          roomId,
          message: JSON.stringify(response.data.analysisResult[0]),
        };
        socket.send(JSON.stringify(message));
      } catch (error: any) {
        setAiResponse(JSON.stringify(error.rawData[0]));
      } finally {
        setRunningAi(false);
      }
    }, "image/png");
  };

  const cleanupRef = useRef<
    | {
        cleanup: () => void;
        setSocket: (socket: WebSocket | null) => void;
        addShapeLocally: (shape: Shape) => void;
        isCanvasEmpty: () => boolean;
        getSelectedShapesInfo: () => Array<{
          shape: Shape;
          index: number;
          bounds: { x: number; y: number; width: number; height: number };
        }>;
        deleteShapeById: (id: string) => void;
        editSelectionStyle: (style: {
          strokeColor?: string;
          strokeWidth?: number;
          fillColor?: string;
          opacity?: number;
        }) => void;
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
        setZoom: (zoom: number) => void;
        zoomBy: (factor: number) => void;
        setViewportCenter: (x: number, y: number) => void;
        clearCanvas: () => boolean;
        resetView: (fallback?: { x: number; y: number }) => void;
        captureSelectedAreaBlob: () => Promise<Blob | null>;
      }
    | undefined
  >(undefined);

  const handleImprove = () => {
    const canvas = canvasRef.current;
    if (!canvas) {
      addNotification("error", "Canvas element not found.");
      return;
    }

    if (!cleanupRef.current) {
      addNotification("error", "Canvas drawing controls not initialized.");
      return;
    }

    const selectedShapesInfoArray = cleanupRef.current.getSelectedShapesInfo();
    if (selectedShapesInfoArray.length === 0) {
      addNotification("info", "Please select shapes to improve.");
      return;
    }

    setImprovingAi(true);

    cleanupRef.current.captureSelectedAreaBlob().then(async (blob) => {
      if (!blob) {
        addNotification("error", "Failed to capture selected area content.");
        setImprovingAi(false);
        return;
      }

      const formData = new FormData();
      formData.append("image", blob, "canvas.png");

      try {
        // Tell axios to get raw binary data
        const response = await axios.post(
          `${BACKEND_URL}/api/improve/ai`,
          formData,
          {
            responseType: "arraybuffer",
          },
        );

        // Convert arraybuffer to base64 string
        const base64 = arrayBufferToBase64(response.data);
        const base64DataUri = `data:image/png;base64,${base64}`;

        // Validate base64 string
        if (!base64DataUri.startsWith("data:image")) {
          throw new Error("Invalid base64 image format.");
        }

        // Calculate combined bounding box
        let minX = Infinity,
          minY = Infinity,
          maxX = -Infinity,
          maxY = -Infinity;
        selectedShapesInfoArray.forEach((info) => {
          minX = Math.min(minX, info.bounds.x);
          minY = Math.min(minY, info.bounds.y);
          maxX = Math.max(maxX, info.bounds.x + info.bounds.width);
          maxY = Math.max(maxY, info.bounds.y + info.bounds.height);
        });
        const combinedBounds = {
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY,
        };

        const newImageShape: Shape = {
          id: crypto.randomUUID(),
          type: "image",
          x: combinedBounds.x,
          y: combinedBounds.y,
          width: combinedBounds.width,
          height: combinedBounds.height,
          src: base64DataUri,
        };

        // Delete old shapes, add new one locally
        selectedShapesInfoArray.forEach((info) => {
          cleanupRef.current!.deleteShapeById(info.shape.id);
        });
        cleanupRef.current!.addShapeLocally(newImageShape);

        // Send over socket
        if (socket && roomId) {
          socket.send(
            JSON.stringify({
              type: "canvas:create",
              roomId,
              operationId: crypto.randomUUID(),
              element: newImageShape,
            }),
          );
        } else {
          console.warn("Socket or Room ID not available.");
        }
      } catch (error) {
        console.error("Improve Error:", error);
        addNotification("error", "Failed to fetch improved canvas.");
      } finally {
        setImprovingAi(false);
      }
    });
  };

  // Helper to convert ArrayBuffer to Base64
  function arrayBufferToBase64(buffer: ArrayBuffer) {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]!);
    }
    return window.btoa(binary);
  }

  useEffect(() => {
    strokeColorRef.current = strokeColor;
  }, [strokeColor]);

  useEffect(() => {
    strokeWidthRef.current = strokeWidth;
  }, [strokeWidth]);

  // State to toggle the settings panel.
  const [showSettings, setShowSettings] = useState(false);

  // Define the eraser size (in pixels)
  const eraserSize = strokeWidth * 10;

  // Handle window resize and set canvas dimensions.
  useEffect(() => {
    if (typeof window !== "undefined") {
      const updateDimensions = () => {
        setDimensions({ width: window.innerWidth, height: window.innerHeight });
      };
      updateDimensions();
      window.addEventListener("resize", updateDimensions);
      return () => window.removeEventListener("resize", updateDimensions);
    }
  }, []);

  // Sync mode state with modeRef.
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // Keep the engine alive while the collaboration socket reconnects.
  useEffect(() => {
    cleanupRef.current?.setSocket(socket);
  }, [socket]);

  useEffect(() => {
    try {
      const token = localStorage.getItem("authorization");
      const payload = token?.split(".")[1];
      if (payload) {
        const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
        const decoded = JSON.parse(
          atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")),
        );
        if (Number.isSafeInteger(decoded.id)) {
          currentUserIdRef.current = decoded.id;
          setCurrentUserId(decoded.id);
        }
      }
    } catch {
      // The server remains the authority; this ID is only used to hide our own cursor.
    }
    const onConnection = (event: Event) => {
      const detail = (
        event as CustomEvent<{ connection: string; pending: number }>
      ).detail;
      setConnectionStatus(detail.connection);
      setPendingSaves(detail.pending);
    };
    const onPresence = (event: Event) => {
      const data = (event as CustomEvent<any>).detail;
      if (data.userId === currentUserIdRef.current) return;
      setCollaborators((current) => {
        if (data.type === "presence:leave" || data.presence?.active === false)
          return current.filter((user) => user.userId !== data.userId);
        if (!Number.isFinite(data.userId)) return current;
        const user = {
          userId: data.userId,
          name: String(data.presence?.name ?? `User ${data.userId}`),
          color: String(data.presence?.color ?? "#818cf8"),
          ...(Number.isFinite(data.presence?.x) ? { x: data.presence.x } : {}),
          ...(Number.isFinite(data.presence?.y) ? { y: data.presence.y } : {}),
        };
        return [
          ...current.filter((candidate) => candidate.userId !== user.userId),
          user,
        ];
      });
    };
    window.addEventListener("canvas:connection-status", onConnection);
    window.addEventListener("canvas:remote-presence", onPresence);
    return () => {
      window.removeEventListener("canvas:connection-status", onConnection);
      window.removeEventListener("canvas:remote-presence", onPresence);
    };
  }, []);

  // Initialize the engine once. Socket replacement only updates its adapter.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !socket || canvasInitStartedRef.current) return;
    canvasInitStartedRef.current = true;
    canvasAliveRef.current = true;
    void initDraw(
      canvas,
      modeRef,
      strokeColorRef,
      strokeWidthRef,
      socket,
      params,
      setAiResponse,
    )
      .then((controls) => {
        if (!canvasAliveRef.current) {
          controls.cleanup();
          return;
        }
        cleanupRef.current = controls;
        if (latestSocketRef.current !== socket)
          controls.setSocket(latestSocketRef.current);
      })
      .catch(() => {
        canvasInitStartedRef.current = false;
        if (canvasAliveRef.current) {
          setConnectionStatus("reconnecting");
          window.setTimeout(() => {
            if (canvasAliveRef.current)
              setCanvasInitRetry((attempt) => attempt + 1);
          }, 1000);
        }
      });
  }, [canvasInitRetry, params, socket]);

  useEffect(
    () => () => {
      canvasAliveRef.current = false;
      cleanupRef.current?.cleanup();
      cleanupRef.current = undefined;
    },
    [],
  );

  // Update the eraser cursor position.
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (
        (mode === "eraser" || mode === "precision-eraser") &&
        eraserCursorRef.current
      ) {
        eraserCursorRef.current.style.left = `${e.clientX - eraserSize / 2}px`;
        eraserCursorRef.current.style.top = `${e.clientY - eraserSize / 2}px`;
        eraserCursorRef.current.style.display = "block";
      } else if (eraserCursorRef.current) {
        eraserCursorRef.current.style.display = "none";
      }
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [mode, eraserSize]);

  useEffect(() => {
    const onPersistenceError = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      addNotification("error", detail || "Canvas change was not saved.");
    };
    window.addEventListener("canvas:persistence-error", onPersistenceError);
    return () =>
      window.removeEventListener(
        "canvas:persistence-error",
        onPersistenceError,
      );
  }, [addNotification]);

  if (!dimensions) return null;

  // Basic color swatches for quick selection.
  const basicColors = [
    "#ffffff",
    "#ff4d4d",
    "#4dff4d",
    "#4d9fff",
    "#ffeb3b",
    "#ff66ff",
    "#00e5ff",
  ];

  function deleteAllContent() {
    if (!cleanupRef.current?.clearCanvas()) {
      addNotification("error", "Canvas could not be cleared or saved.");
      return;
    }
    addNotification("success", "Canvas cleared.");
  }

  const minimap = (() => {
    if (!viewport) return null;
    const zoom = Math.max(0.001, viewport.zoom);
    const visible = {
      minX: -viewport.offsetX / zoom,
      minY: -viewport.offsetY / zoom,
      maxX: (viewport.width - viewport.offsetX) / zoom,
      maxY: (viewport.height - viewport.offsetY) / zoom,
    };
    const world = {
      minX: Math.min(viewport.content?.minX ?? visible.minX, visible.minX),
      minY: Math.min(viewport.content?.minY ?? visible.minY, visible.minY),
      maxX: Math.max(viewport.content?.maxX ?? visible.maxX, visible.maxX),
      maxY: Math.max(viewport.content?.maxY ?? visible.maxY, visible.maxY),
    };
    const worldWidth = Math.max(1, world.maxX - world.minX);
    const worldHeight = Math.max(1, world.maxY - world.minY);
    const scale = Math.min(204 / worldWidth, 104 / worldHeight);
    const mapWidth = worldWidth * scale;
    const mapHeight = worldHeight * scale;
    const originX = (220 - mapWidth) / 2;
    const originY = (120 - mapHeight) / 2;
    const point = (x: number, y: number) => ({
      x: originX + (x - world.minX) * scale,
      y: originY + (y - world.minY) * scale,
    });
    const rect = (bounds: CanvasViewport["content"]) => {
      if (!bounds) return null;
      const a = point(bounds.minX, bounds.minY);
      const b = point(bounds.maxX, bounds.maxY);
      return {
        x: a.x,
        y: a.y,
        width: Math.max(1.2, b.x - a.x),
        height: Math.max(1.2, b.y - a.y),
      };
    };
    const visibleRect = rect(visible)!;
    const centerAt = (event: React.PointerEvent<SVGSVGElement>) => {
      const bounds = event.currentTarget.getBoundingClientRect();
      const x = ((event.clientX - bounds.left) / bounds.width) * 220;
      const y = ((event.clientY - bounds.top) / bounds.height) * 120;
      cleanupRef.current?.setViewportCenter(
        world.minX + (x - originX) / scale,
        world.minY + (y - originY) / scale,
      );
    };
    return { visibleRect, rect, centerAt, items: viewport.items };
  })();

  return (
    <div className="relative">
      <div className="fixed left-16 top-4 z-40 flex items-center gap-2 rounded-full border border-gray-700 bg-gray-900/90 px-3 py-1.5 text-xs text-gray-200 shadow-lg">
        <span
          className={`h-2 w-2 rounded-full ${connectionStatus === "connected" ? "bg-emerald-400" : "bg-amber-400"}`}
        />
        <span>
          {connectionStatus === "connected" ? "Connected" : "Reconnecting"}
        </span>
        <span className="text-gray-400">
          {pendingSaves ? `Saving ${pendingSaves}` : "Saved"}
        </span>
        {collaborators
          .filter((user) => user.userId !== currentUserId)
          .map((user) => (
            <span
              key={user.userId}
              title={user.name}
              className="flex h-6 w-6 items-center justify-center rounded-full font-semibold text-black"
              style={{ backgroundColor: user.color }}
            >
              {user.name.slice(0, 1).toUpperCase()}
            </span>
          ))}
      </div>
      {collaborators
        .filter((user) => user.userId !== currentUserId)
        .filter((user) => user.x !== undefined && user.y !== undefined)
        .map((user) => {
          const bounds = canvasRef.current?.getBoundingClientRect();
          if (!bounds || !viewport) return null;
          const x = bounds.left + viewport.offsetX + user.x! * viewport.zoom;
          const y = bounds.top + viewport.offsetY + user.y! * viewport.zoom;
          return (
            <div
              key={`cursor-${user.userId}`}
              className="pointer-events-none fixed z-30"
              style={{ left: x, top: y, color: user.color }}
            >
              <svg
                width="18"
                height="22"
                viewBox="0 0 18 22"
                aria-hidden="true"
              >
                <path
                  d="M1 1v17l5-5 3 7 3-1-3-7h7L1 1Z"
                  fill={user.color}
                  stroke="white"
                  strokeWidth="1.2"
                />
              </svg>
              <span
                className="ml-3 rounded px-1.5 py-0.5 text-[11px] text-white"
                style={{ backgroundColor: user.color }}
              >
                {user.name}
              </span>
            </div>
          );
        })}
      {/* AI Response Overlay at Bottom Right */}
      {aiResponse && (
        <div className="fixed right-0 bottom-0 z-50 bg-gray-800 p-6 rounded-lg shadow-lg max-w-md w-full m-4">
          {/* Cross Button to Dismiss */}
          <button
            onClick={() => setAiResponse(null)}
            className="absolute top-2 right-2 text-gray-300 hover:text-white"
          >
            <X size={24} />
          </button>
          <pre className="text-white whitespace-pre-wrap">
            {formatAIResponse(aiResponse)}
          </pre>
        </div>
      )}
      {/* Toggle Settings Button */}
      <button
        onClick={() => setShowSettings(!showSettings)}
        className="absolute z-30 top-4 left-4 p-2 rounded-full bg-gray-800 text-gray-300 hover:bg-indigo-600 hover:text-white transition-colors duration-200"
      >
        <SettingsIcon size={24} />
      </button>
      <section className="fixed bottom-4 left-4 z-40 w-[260px] rounded-xl border border-gray-700 bg-gray-900/95 p-3 text-gray-200 shadow-xl backdrop-blur">
        <svg
          viewBox="0 0 220 120"
          className="h-[130px] w-full touch-none rounded-lg bg-black/70"
          role="img"
          aria-label="Canvas minimap. Drag to move the viewport."
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            minimap?.centerAt(event);
          }}
          onPointerMove={(event) => {
            if (event.buttons) minimap?.centerAt(event);
          }}
        >
          {minimap?.items.map((bounds, index) => {
            const rect = minimap.rect(bounds);
            return rect ? (
              <rect
                key={index}
                {...rect}
                rx="0.8"
                fill="#8892a6"
                opacity="0.65"
              />
            ) : null;
          })}
          {minimap && (
            <rect
              {...minimap.visibleRect}
              rx="1.5"
              fill="#6366f1"
              fillOpacity="0.12"
              stroke="#818cf8"
              strokeWidth="1.5"
            />
          )}
        </svg>
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 rounded-lg bg-gray-800 px-1">
            <button
              title="Zoom out"
              aria-label="Zoom out"
              className="rounded p-1.5 hover:bg-gray-700"
              onClick={() => cleanupRef.current?.zoomBy(1 / 1.2)}
            >
              <ZoomOut size={16} />
            </button>
            <button
              title="Reset zoom to 100%"
              className="min-w-12 px-1 text-sm tabular-nums hover:text-white"
              onClick={() => {
                const collaborator = collaborators.find(
                  (user) =>
                    user.userId !== currentUserId &&
                    user.x !== undefined &&
                    user.y !== undefined,
                );
                cleanupRef.current?.resetView(
                  collaborator
                    ? { x: collaborator.x!, y: collaborator.y! }
                    : undefined,
                );
              }}
            >
              {Math.round((viewport?.zoom ?? 1) * 100)}%
            </button>
            <button
              title="Zoom in"
              aria-label="Zoom in"
              className="rounded p-1.5 hover:bg-gray-700"
              onClick={() => cleanupRef.current?.zoomBy(1.2)}
            >
              <ZoomIn size={16} />
            </button>
          </div>
          <div className="flex items-center gap-1 rounded-lg bg-gray-800 px-1">
            <button
              title="Undo"
              aria-label="Undo"
              className="rounded p-1.5 hover:bg-gray-700"
              onClick={() => cleanupRef.current?.runCanvasCommand("undo")}
            >
              <Undo2 size={16} />
            </button>
            <button
              title="Redo"
              aria-label="Redo"
              className="rounded p-1.5 hover:bg-gray-700"
              onClick={() => cleanupRef.current?.runCanvasCommand("redo")}
            >
              <Redo2 size={16} />
            </button>
          </div>
        </div>
      </section>
      <div className="absolute z-30 top-4 right-4 gap-3 flex items-center">
        <button
          onClick={() => handleImprove()}
          className={`${runningAi ? "bg-gray-900" : "bg-gray-800 hover:bg-indigo-600 hover:text-white"} border border-gray-700 shadow-md font-bold px-3 py-1 gap-1 flex items-center rounded-full  text-gray-300 transition-colors duration-200`}
        >
          <div>{improvingAi ? "Improving..." : "Improve"}</div>
          {!improvingAi && <Play size={14} />}
        </button>
        <button
          onClick={() => handleSend()}
          className={`${runningAi ? "bg-gray-900" : "bg-gray-800 hover:bg-indigo-600 hover:text-white"} border border-gray-700 shadow-md font-bold px-3 py-1 gap-1 flex items-center rounded-full  text-gray-300 transition-colors duration-200`}
        >
          <div>{runningAi ? "Solving..." : "Solve"}</div>
          {!runningAi && <Play size={14} />}
        </button>
        <button
          onClick={() => router.push("/Dashboard")}
          className=" p-2 rounded-full  bg-gray-800 text-gray-300 hover:bg-indigo-600 hover:text-white transition-colors duration-200"
        >
          <LogOut size={18} />
        </button>
      </div>

      {/* Dynamic Settings Panel */}
      {showSettings && (
        <div className="absolute z-50 top-16 left-4 w-60 p-4 bg-gray-900 border border-gray-700 rounded-lg shadow-lg text-white">
          <h2 className="mb-4 text-xl font-bold">Stroke Settings</h2>
          <div className="mb-4">
            <label htmlFor="strokeWidth" className="block text-sm mb-1">
              Stroke Width: {strokeWidth}px
            </label>
            <input
              type="range"
              id="strokeWidth"
              min="1"
              max="10"
              value={strokeWidth}
              onChange={(e) => setStrokeWidth(parseInt(e.target.value))}
              onPointerUp={() =>
                cleanupRef.current?.editSelectionStyle({ strokeWidth })
              }
              className="w-full"
            />
          </div>
          {mode !== "eraser" && mode !== "precision-eraser" && (
            <div>
              <div className="mb-4">
                <label htmlFor="strokeColor" className="block text-sm mb-1">
                  Choose Color:
                </label>
                <input
                  type="color"
                  id="strokeColor"
                  value={strokeColor}
                  onChange={(e) => {
                    setStrokeColor(e.target.value);
                    cleanupRef.current?.editSelectionStyle({
                      strokeColor: e.target.value,
                    });
                  }}
                  className="w-full h-10 p-0 border-none bg-gray-700"
                />
              </div>
              <div>
                <p className="text-sm mb-1">Basic Colors:</p>
                <div className="flex space-x-2">
                  {basicColors.map((col) => (
                    <button
                      key={col}
                      onClick={() => {
                        setStrokeColor(col);
                        cleanupRef.current?.editSelectionStyle({
                          strokeColor: col,
                        });
                      }}
                      style={{ backgroundColor: col }}
                      className={`w-6 h-6 rounded-full border border-gray-600 ${
                        strokeColor.toLowerCase() === col.toLowerCase()
                          ? "ring-2 ring-indigo-600"
                          : ""
                      }`}
                    />
                  ))}
                </div>
              </div>
              <div className="mt-3">
                <label htmlFor="fillColor" className="block text-sm mb-1">
                  Fill color:
                </label>
                <input
                  id="fillColor"
                  type="color"
                  value={fillColor}
                  onChange={(event) => {
                    setFillColor(event.target.value);
                    cleanupRef.current?.editSelectionStyle({
                      fillColor: event.target.value,
                    });
                  }}
                  className="w-full h-8 bg-gray-700"
                />
              </div>
              <div className="mt-3">
                <label htmlFor="elementOpacity" className="block text-sm mb-1">
                  Selected opacity: {Math.round(elementOpacity * 100)}%
                </label>
                <input
                  id="elementOpacity"
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.05"
                  value={elementOpacity}
                  onChange={(event) =>
                    setElementOpacity(Number(event.target.value))
                  }
                  onPointerUp={() =>
                    cleanupRef.current?.editSelectionStyle({
                      opacity: elementOpacity,
                    })
                  }
                  className="w-full"
                />
              </div>
            </div>
          )}
          <div className="mt-4 grid grid-cols-2 gap-2">
            {[
              ["undo", "Undo"],
              ["redo", "Redo"],
              ["group", "Group"],
              ["ungroup", "Ungroup"],
              ["backward", "Backward"],
              ["forward", "Forward"],
              ["back", "Send to back"],
              ["front", "Bring to front"],
            ].map(([command, label]) => (
              <button
                key={command}
                type="button"
                onClick={() =>
                  cleanupRef.current?.runCanvasCommand(
                    command as
                      | "undo"
                      | "redo"
                      | "group"
                      | "ungroup"
                      | "front"
                      | "back"
                      | "forward"
                      | "backward",
                  )
                }
                className="rounded bg-gray-800 px-2 py-1 text-xs hover:bg-indigo-600"
              >
                {label}
              </button>
            ))}
          </div>
          {(roomRole === "OWNER" ||
            (roomOwnerId !== null && roomOwnerId === currentUserId)) && (
            <button
              type="button"
              onClick={deleteAllContent}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded border border-red-700/70 bg-red-950/60 px-3 py-2 text-sm text-red-200 hover:bg-red-900"
            >
              <Trash size={16} />
              Clear canvas
            </button>
          )}
        </div>
      )}

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        width={dimensions.width}
        height={dimensions.height}
        className="absolute top-0 left-0 bg-black"
        style={{ width: "100vw", height: "100vh" }}
      />
      {/* Eraser Cursor Overlay */}
      <div
        ref={eraserCursorRef}
        style={{
          position: "fixed",
          width: `${eraserSize}px`,
          height: `${eraserSize}px`,
          border: "1px solid white",
          backgroundColor: "white",
          borderRadius: "50%",
          pointerEvents: "none",
          display: "none",
          zIndex: 20,
        }}
      />
      {/* Drawing Mode Toolbar */}
      <div className="absolute z-40 top-4 left-1/2 transform -translate-x-1/2 flex items-center space-x-3 px-4 py-2 rounded-full bg-gray-900 border border-gray-700 shadow-md">
        {[
          { name: "select", symbol: <img src={"/cursor.png"} /> },
          { name: "rect", symbol: <RectangleHorizontal /> },
          { name: "circle", symbol: <Circle /> },
          { name: "line", symbol: <Minus /> },
          { name: "arrow", symbol: <MoveRight /> },
          { name: "triangle", symbol: <Triangle /> },
          { name: "freehand", symbol: <Pencil /> },
          { name: "text", symbol: <TypeOutline /> },
          { name: "eraser", symbol: <Eraser /> },
          { name: "precision-eraser", symbol: <Scissors /> },
        ].map((shapeObj) => (
          <button
            key={shapeObj.name}
            title={
              shapeObj.name === "eraser"
                ? "Erase whole objects"
                : shapeObj.name === "precision-eraser"
                  ? "Erase part of freehand strokes"
                  : shapeObj.name
            }
            aria-label={
              shapeObj.name === "eraser"
                ? "Erase whole objects"
                : shapeObj.name === "precision-eraser"
                  ? "Erase part of freehand strokes"
                  : shapeObj.name
            }
            onClick={() => {
              setShowSettings(true);
              setMode(shapeObj.name as DrawingMode);
            }}
            className={`flex items-center justify-center w-10 h-10 rounded-full transition-colors duration-200 
              ${
                mode === shapeObj.name
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-800 text-gray-300 hover:bg-indigo-600 hover:text-white"
              }`}
          >
            {shapeObj.symbol}
          </button>
        ))}
      </div>
    </div>
  );
};

export default Page;
