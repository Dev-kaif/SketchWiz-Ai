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

export const serverEnv = () =>
  parse(
    shared.extend({
      DATABASE_URL: z.string().min(1),
      JWT_SECRET: z.string().min(32),
      GEMINI_API_KEY: z.string().min(1),
      PORT: z.coerce.number().int().positive().default(5000),
      HOST: z.string().default("0.0.0.0"),
      CORS_ORIGINS: z.string().default("*"),
    }),
    "HTTP server",
  ) as {
    DATABASE_URL: string;
    JWT_SECRET: string;
    GEMINI_API_KEY: string;
    PORT: number;
    HOST: string;
    CORS_ORIGINS: string;
    NODE_ENV: "development" | "test" | "production";
  };

export const websocketEnv = () =>
  parse(
    shared.extend({
      DATABASE_URL: z.string().min(1),
      JWT_SECRET: z.string().min(32),
      PORT: z.coerce.number().int().positive().default(8000),
      HOST: z.string().default("0.0.0.0"),
    }),
    "WebSocket service",
  ) as {
    DATABASE_URL: string;
    JWT_SECRET: string;
    PORT: number;
    HOST: string;
    NODE_ENV: "development" | "test" | "production";
  };
