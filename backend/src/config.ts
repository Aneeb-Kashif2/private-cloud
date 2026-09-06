import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  CACHE_TTL_SECONDS: z.coerce.number().int().min(10).max(3600).default(60),
  AUTH_SECRET: z.string().min(32),
  FRONTEND_ORIGIN: z.string().min(1).refine(value => value === "*" || value.split(",").every(origin => z.string().url().safeParse(origin.trim()).success), "Must be * or comma-separated valid URLs").default("http://localhost:3000"),
  PORT: z.coerce.number().int().positive().default(4000),
  STORAGE_PATH: z.string().startsWith("/").default("/srv/secure-cloud-storage"),
  STORAGE_LIMIT_BYTES: z.coerce.bigint().refine(value => value === 5368709120n, "Quota must be 5 GiB").default(5368709120n),
  MAX_FILE_SIZE_BYTES: z.coerce.bigint().positive().default(5n * 1024n ** 3n),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
});

export type Config = z.infer<typeof schema>;
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return schema.parse(env);
}
