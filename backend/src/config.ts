import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  AWS_REGION: z.string().min(1),
  AWS_S3_BUCKET: z.string().min(1),
  AUTH_SECRET: z.string().min(32),
  FRONTEND_ORIGIN: z.string().min(1).refine(value => value.split(",").every(origin => z.string().url().safeParse(origin.trim()).success), "Must contain comma-separated valid URLs").default("http://localhost:3000"),
  PORT: z.coerce.number().int().positive().default(4000),
  DEFAULT_STORAGE_LIMIT_BYTES: z.coerce.bigint().positive().default(10n * 1024n ** 3n),
  MAX_FILE_SIZE_BYTES: z.coerce.bigint().positive().default(5n * 1024n ** 3n),
  PRESIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(600),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
});

export type Config = z.infer<typeof schema>;
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return schema.parse(env);
}
