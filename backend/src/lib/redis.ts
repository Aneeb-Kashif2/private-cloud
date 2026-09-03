import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import type { Config } from "../config.js";
import { AppError } from "./errors.js";

const PREFIX = "selfcloud";

export interface RedisService {
  client?: Redis;
  getJson<T>(key: string): Promise<T | null>;
  setJson(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  del(...keys: string[]): Promise<void>;
  withLock<T>(key: string, ttlMs: number, task: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function createRedis(config: Config): RedisService {
  const client = new Redis(config.REDIS_URL, {
    enableReadyCheck: true,
    maxRetriesPerRequest: 2,
    lazyConnect: true,
  });
  client.on("error", () => undefined);

  const fullKey = (key: string) => `${PREFIX}:${key}`;
  return {
    client,
    async getJson<T>(key: string) {
      const value = await client.get(fullKey(key));
      return value ? JSON.parse(value) as T : null;
    },
    async setJson(key, value, ttlSeconds) {
      await client.set(fullKey(key), JSON.stringify(value), "EX", ttlSeconds);
    },
    async del(...keys) {
      if (keys.length) await client.del(...keys.map(fullKey));
    },
    async withLock<T>(key: string, ttlMs: number, task: () => Promise<T>) {
      const lockKey = fullKey(`lock:${key}`);
      const token = randomUUID();
      const acquired = await client.set(lockKey, token, "PX", ttlMs, "NX");
      if (!acquired) throw new AppError(409, "Another upload operation is in progress", "UPLOAD_BUSY");
      try {
        return await task();
      } finally {
        await client.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, lockKey, token);
      }
    },
    async close() {
      if (client.status !== "end") await client.quit();
    },
  };
}
