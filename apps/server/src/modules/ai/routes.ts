import {
  Router,
  type NextFunction,
  type Request,
  type Response,
  type Router as ExpressRouter,
} from "express";
import multer from "multer";
import { GoogleGenAI, Modality } from "@google/genai";
import { FixedWindowLimiter } from "@repo/backend/config";
import { serverEnv } from "@repo/backend/env";
import { roomRoleForUser } from "@repo/db/access";
import { auth } from "../../middleware/auth.js";
import { AppError } from "../../errors.js";

const router: ExpressRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 5, parts: 6 },
});
const env = serverEnv();
const limiter = new FixedWindowLimiter(
  env.AI_RATE_LIMIT,
  env.AI_RATE_WINDOW_MS,
);
const activeByUser = new Map<number, number>();
const ai = () =>
  new GoogleGenAI({
    apiKey: env.GEMINI_API_KEY,
    httpOptions: { timeout: 60_000, retryOptions: { attempts: 1 } },
  });
const toPart = (buffer: Buffer, mimeType: string) => ({
  inlineData: { data: buffer.toString("base64"), mimeType },
});
const analysisPrompt = `Analyze this canvas image. Solve visible math or explain the drawing. Return only valid JSON: an array of objects with expr and result fields. Add steps for complex math and suggestion when useful.`;
const enhancePrompt = `Create a detailed, polished pencil sketch interpretation of the supplied image. Preserve its key content and colors. Return a sketch suitable for a digital whiteboard.`;

router.use(auth);
router.use((req, res, next) => {
  const userId = req.user!.id;
  const rate = limiter.consume(String(userId));
  if (!rate.allowed) {
    res.setHeader("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
    res.status(429).json({ error: "AI request limit reached" });
    return;
  }
  const active = activeByUser.get(userId) ?? 0;
  if (active >= env.AI_MAX_CONCURRENT_PER_USER) {
    res.status(429).json({ error: "Too many AI requests are already running" });
    return;
  }
  activeByUser.set(userId, active + 1);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    const count = (activeByUser.get(userId) ?? 1) - 1;
    if (count <= 0) activeByUser.delete(userId);
    else activeByUser.set(userId, count);
  };
  res.once("finish", release);
  res.once("close", release);
  next();
});

function validateImage(req: Request) {
  const file = req.file;
  if (!file) throw new AppError(400, "No image provided", "IMAGE_REQUIRED");
  const buffer = file.buffer;
  const png =
    buffer.length >= 8 &&
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg =
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff;
  const webp =
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP";
  const detected = png
    ? "image/png"
    : jpeg
      ? "image/jpeg"
      : webp
        ? "image/webp"
        : null;
  if (!detected || file.mimetype !== detected)
    throw new AppError(
      415,
      "Only valid PNG, JPEG, or WebP images are supported",
      "UNSUPPORTED_IMAGE",
    );
  return { buffer, mimeType: detected };
}

async function verifyOptionalRoomAccess(req: Request) {
  const roomId = req.body?.roomId;
  if (roomId === undefined || roomId === "") return;
  const id = Number(roomId);
  if (!Number.isSafeInteger(id) || id < 1)
    throw new AppError(400, "Invalid room ID", "INVALID_ROOM_ID");
  const role = await roomRoleForUser(id, req.user!.id);
  if (!role) throw new AppError(404, "Room not found", "ROOM_NOT_FOUND");
}

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res).catch(next);
  };
}

router.post(
  "/analyze/ai",
  upload.single("image"),
  asyncRoute(async (req, res) => {
    const image = validateImage(req);
    await verifyOptionalRoomAccess(req);
    try {
      const result = await ai().models.generateContent({
        model: "gemini-3.8-flash",
        config: { systemInstruction: analysisPrompt },
        contents: toPart(image.buffer, image.mimeType),
      });
      const text = result.text ?? "[]";
      try {
        res.json({
          analysisResult: JSON.parse(
            text.replace(/^```(?:json)?\s*|\s*```$/g, ""),
          ),
        });
      } catch {
        res.json({ analysisResult: [{ cleanedResponse: text }] });
      }
    } catch {
      throw new AppError(
        502,
        "AI analysis is temporarily unavailable",
        "AI_PROVIDER_ERROR",
      );
    }
  }),
);

router.post(
  "/improve/ai",
  upload.single("image"),
  asyncRoute(async (req, res) => {
    const image = validateImage(req);
    await verifyOptionalRoomAccess(req);
    try {
      const promptResult = await ai().models.generateContent({
        model: "gemini-3.8-flash",
        config: { systemInstruction: enhancePrompt },
        contents: toPart(image.buffer, image.mimeType),
      });
      const imageResult = await ai().models.generateContent({
        model: "gemini-3.1-flash-image",
        contents: [
          {
            text: `${enhancePrompt}\n\nSpecific image prompt: ${promptResult.text ?? "Enhance the input sketch."}`,
          },
          toPart(image.buffer, image.mimeType),
        ],
        config: { responseModalities: [Modality.TEXT, Modality.IMAGE] },
      });
      const generated = imageResult.candidates?.[0]?.content?.parts?.find(
        (part) => part.inlineData?.data,
      )?.inlineData;
      if (!generated?.data)
        throw new AppError(
          502,
          "Image generation returned no image",
          "AI_EMPTY_IMAGE",
        );
      const outputType = ["image/png", "image/jpeg", "image/webp"].includes(
        generated.mimeType ?? "",
      )
        ? generated.mimeType!
        : "image/png";
      res.type(outputType).send(Buffer.from(generated.data, "base64"));
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        502,
        "AI image generation is temporarily unavailable",
        "AI_PROVIDER_ERROR",
      );
    }
  }),
);

export default router;
