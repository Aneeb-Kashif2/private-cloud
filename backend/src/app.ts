import { PrismaClient } from "@prisma/client";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { ZodError } from "zod";
import { loadConfig, type Config } from "./config.js";
import { AppError } from "./lib/errors.js";
import { createS3, type S3Service } from "./lib/s3.js";
import authRoutes from "./modules/auth/routes.js";
import fileRoutes from "./modules/files/routes.js";
import folderRoutes from "./modules/folders/routes.js";
import storageRoutes from "./modules/storage/routes.js";
import authPlugin from "./plugins/auth.js";

export async function buildApp(overrides: { config?: Config; prisma?: PrismaClient; s3?: S3Service } = {}) {
  const config = overrides.config ?? loadConfig();
  const app = Fastify({ logger: { level: config.NODE_ENV === "test" ? "silent" : "info", redact: ["req.headers.authorization", "req.headers.cookie", "body.password", "body.confirmPassword"] }, trustProxy: config.NODE_ENV === "production" });
  app.decorate("config", config);
  app.decorate("prisma", overrides.prisma ?? new PrismaClient());
  app.decorate("s3", overrides.s3 ?? createS3(config));
  const allowedOrigins = new Set(config.FRONTEND_ORIGIN.split(",").map(origin => origin.trim()));
  await app.register(helmet);
  await app.register(cookie, { secret: config.AUTH_SECRET });
  await app.register(cors, { origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)), credentials: true, methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"] });
  await app.register(rateLimit, { global: false });
  app.addHook("onRequest", async request => {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      const origin = request.headers.origin;
      if (origin && !allowedOrigins.has(origin)) throw new AppError(403, "Request origin is not allowed", "INVALID_ORIGIN");
    }
  });
  await app.register(authPlugin);
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(storageRoutes, { prefix: "/api/storage" });
  await app.register(fileRoutes, { prefix: "/api/files" });
  await app.register(folderRoutes, { prefix: "/api/folders" });
  app.get("/health", async () => ({ status: "ok" }));
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid request", details: error.issues.map(i => ({ path: i.path.join("."), message: i.message })) } });
    if (error instanceof AppError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
    if ((error as { code?: string }).code === "P2002") return reply.code(409).send({ error: { code: "CONFLICT", message: "A record with that name already exists" } });
    app.log.error(error);
    return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } });
  });
  app.addHook("onClose", async () => { if (!overrides.prisma) await app.prisma.$disconnect(); });
  return app;
}
