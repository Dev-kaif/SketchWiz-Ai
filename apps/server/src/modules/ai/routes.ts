import { Router, type Router as ExpressRouter } from "express";
import multer from "multer";
import { GoogleGenAI, Modality } from "@google/genai";
import { serverEnv } from "@repo/backend/env";

const router: ExpressRouter = Router();
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
const ai = () => new GoogleGenAI({ apiKey: serverEnv().GEMINI_API_KEY });
const toPart = (buffer: Buffer, mimeType: string) => ({
  inlineData: { data: buffer.toString("base64"), mimeType },
});
const analysisPrompt = `Analyze this canvas image. Solve visible math or explain the drawing. Return only valid JSON: an array of objects with expr and result fields. Add steps for complex math and suggestion when useful.`;
const enhancePrompt = `Create a detailed, polished pencil sketch interpretation of the supplied image. Preserve its key content and colors. Return a sketch suitable for a digital whiteboard.`;

router.post("/analyze/ai", upload.single("image"), async (req, res, next) => {
  if (!req.file) {
    res.status(400).json({ error: "No image provided" });
    return;
  }
  try {
    const result = await ai().models.generateContent({
      model: "gemini-3.8-flash",
      config: { systemInstruction: analysisPrompt },
      contents: toPart(req.file.buffer, req.file.mimetype),
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
  } catch (error) {
    next(error);
  }
});

router.post("/improve/ai", upload.single("image"), async (req, res, next) => {
  if (!req.file) {
    res.status(400).json({ error: "No image provided" });
    return;
  }
  try {
    const promptResult = await ai().models.generateContent({
      model: "gemini-3.8-flash",
      config: { systemInstruction: enhancePrompt },
      contents: toPart(req.file.buffer, req.file.mimetype),
    });
    const imageResult = await ai().models.generateContent({
      model: "gemini-3.1-flash-image",
      contents: [
        {
          text: `${enhancePrompt}\n\nSpecific image prompt: ${promptResult.text ?? "Enhance the input sketch."}`,
        },
        toPart(req.file.buffer, req.file.mimetype),
      ],
      config: { responseModalities: [Modality.TEXT, Modality.IMAGE] },
    });
    const image = imageResult.candidates?.[0]?.content?.parts?.find(
      (part) => part.inlineData?.data,
    )?.inlineData;
    if (!image?.data) {
      res.status(502).json({ error: "Image generation returned no image" });
      return;
    }
    res
      .type(image.mimeType ?? "image/png")
      .send(Buffer.from(image.data, "base64"));
  } catch (error) {
    next(error);
  }
});
export default router;
