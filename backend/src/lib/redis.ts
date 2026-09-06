import { Redis } from "ioredis";
import type { Config } from "../config.js";

const PREFIX = "selfcloud";

export interface RedisService {
  client?: Redis;
  getJson<T>(key: string): Promise<T | null>;
  setJson(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  del(...keys: string[]): Promise<void>;
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
    async close() {
      if (client.status !== "end") await client.quit();
    },
  };
}
