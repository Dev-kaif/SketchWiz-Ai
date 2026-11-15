import "dotenv/config";
import { z } from "zod";

const shared = z.object({
  DATABASE_URL: z.string().url().optional(),
  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET must be at least 32 characters")
    .optional(),
  GEMINI_API_KEY: z.string().min(1).optional(),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

function parse(schema: z.ZodTypeAny, service: string) {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid ${service} environment: ${details}`);
  }
  return result.data;
}

export const serverEnv = () => {
  const env = parse(
    shared.extend({
      DATABASE_URL: z.string().min(1),
      JWT_SECRET: z.string().min(32),
      GEMINI_API_KEY: z.string().min(1),
      PORT: z.coerce.number().int().positive().default(5000),
      HOST: z.string().default("0.0.0.0"),
      CORS_ORIGINS: z.string().default("*"),
      AI_RATE_LIMIT: z.coerce.number().int().positive().default(10),
      AI_RATE_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
      AI_MAX_CONCURRENT_PER_USER: z.coerce.number().int().positive().default(2),
      WS_MAX_PAYLOAD_BYTES: z.coerce
        .number()
        .int()
        .positive()
        .max(100 * 1024 * 1024)
        .default(20 * 1024 * 1024),
      WS_MESSAGE_RATE_LIMIT: z.coerce.number().int().positive().default(500),
      WS_MESSAGE_RATE_WINDOW_MS: z.coerce
        .number()
        .int()
        .positive()
        .default(10_000),
    }),
    "HTTP server",
  ) as {
    DATABASE_URL: string;
    JWT_SECRET: string;
    GEMINI_API_KEY: string;
    PORT: number;
    HOST: string;
    CORS_ORIGINS: string;
    AI_RATE_LIMIT: number;
    AI_RATE_WINDOW_MS: number;
    AI_MAX_CONCURRENT_PER_USER: number;
    WS_MAX_PAYLOAD_BYTES: number;
    WS_MESSAGE_RATE_LIMIT: number;
    WS_MESSAGE_RATE_WINDOW_MS: number;
    NODE_ENV: "development" | "test" | "production";
  };
  if (env.NODE_ENV === "production" && env.CORS_ORIGINS.trim() === "*") {
    throw new Error(
      "Invalid HTTP server environment: CORS_ORIGINS must list trusted origins in production",
    );
  }
  return env;
};

export const websocketEnv = () =>
  parse(
    shared.extend({
      DATABASE_URL: z.string().min(1),
      JWT_SECRET: z.string().min(32),
      PORT: z.coerce.number().int().positive().default(8000),
      HOST: z.string().default("0.0.0.0"),
      WS_MAX_PAYLOAD_BYTES: z.coerce
        .number()
        .int()
        .positive()
        .max(100 * 1024 * 1024)
        .default(20 * 1024 * 1024),
      WS_MESSAGE_RATE_LIMIT: z.coerce.number().int().positive().default(500),
      WS_MESSAGE_RATE_WINDOW_MS: z.coerce
        .number()
        .int()
        .positive()
        .default(10_000),
    }),
    "WebSocket service",
  ) as {
    DATABASE_URL: string;
    JWT_SECRET: string;
    PORT: number;
    HOST: string;
    WS_MAX_PAYLOAD_BYTES: number;
    WS_MESSAGE_RATE_LIMIT: number;
    WS_MESSAGE_RATE_WINDOW_MS: number;
    NODE_ENV: "development" | "test" | "production";
  };
