import type { PrismaClient, User } from "@prisma/client";
import type { Config } from "./config.js";
import type { S3Service } from "./lib/s3.js";
import type { RedisService } from "./lib/redis.js";

declare module "fastify" {
  interface FastifyInstance { prisma: PrismaClient; config: Config; s3: S3Service; redis: RedisService; authenticate: (request: FastifyRequest) => Promise<void>; }
  interface FastifyRequest { user: Pick<User, "id" | "name" | "email" | "storageLimit" | "storageUsed" | "storageReserved">; sessionId: string; }
}
