/** Legacy exports retained for existing workspace consumers. Prefer serviceEnv(). */
import "dotenv/config";
export const JWT_SECRET = process.env.JWT_SECRET;
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
export { serverEnv, websocketEnv } from "./env.js";
export { logger } from "./logger.js";
export {
  signAccessToken,
  verifyAccessToken,
  type AuthenticatedUser,
} from "./auth.js";
export { FixedWindowLimiter } from "./rateLimit.js";
