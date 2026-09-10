import type { PrismaClient, User } from "@prisma/client";
import type { Config } from "./config.js";
import type { LocalStorage } from "./lib/storage.js";
import type { RedisService } from "./lib/redis.js";

declare module "fastify" {
  interface FastifyInstance { metrics: import("@prometheus-io/client").Registry; prisma: PrismaClient; config: Config; storage: LocalStorage; redis: RedisService; authenticate: (request: FastifyRequest) => Promise<void>; }
  interface FastifyRequest { user: Pick<User, "id" | "name" | "email" | "storageLimit" | "storageUsed" | "storageReserved">; sessionId: string; }
}
