import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { AppError } from "../../lib/errors.js";
import { jsonSafe } from "../../lib/serialize.js";
import { cacheKeys, invalidateUserMetadata } from "../../lib/cache.js";

const allowedMime = /^(image\/|video\/|audio\/|text\/|application\/(pdf|zip|gzip|json|xml|msword|vnd\.|octet-stream))/i;
const idParams = z.object({ id: z.string().uuid() });

const routes: FastifyPluginAsync = async app => {
  // Pass binary bodies through without buffering them in memory.
  app.addContentTypeParser("application/octet-stream", (_request, payload, done) => done(null, payload));
  app.post("/upload", { onRequest: app.authenticate }, async (request, reply) => {
    if (request.headers["content-type"] !== "application/octet-stream") throw new AppError(415, "Use application/octet-stream", "INVALID_CONTENT_TYPE");
    const input = z.object({ filename: z.string().trim().min(1).max(255), size: z.coerce.bigint().nonnegative(), mimeType: z.string().min(1).max(150), folderId: z.string().cuid() }).parse(request.query);
    if (input.size > app.config.MAX_FILE_SIZE_BYTES) throw new AppError(413, "File exceeds the maximum upload size", "FILE_TOO_LARGE");
    if (!allowedMime.test(input.mimeType)) throw new AppError(415, "This file type is not allowed", "INVALID_FILE_TYPE");
    if (!await app.prisma.folder.findFirst({ where: { id: input.folderId, userId: request.user.id } })) throw new AppError(404, "Folder not found", "NOT_FOUND");
    const id = randomUUID();
    const storageKey = id;
    // PostgreSQL evaluates this condition against the locked current row, never cached session counters.
    const reserved = await app.prisma.$executeRaw`UPDATE "User" SET "storageReserved" = "storageReserved" + ${input.size} WHERE id = ${request.user.id} AND "storageUsed" + "storageReserved" + ${input.size} <= ${app.config.STORAGE_LIMIT_BYTES}`;
    if (!reserved) throw new AppError(413, "Not enough available storage", "QUOTA_EXCEEDED");
    let committed = false;
    let written = false;
    try {
      await app.storage.write(storageKey, request.body as NodeJS.ReadableStream, input.size);
      written = true;
      const file = await app.prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${request.user.id} FOR UPDATE`;
        const created = await tx.file.create({ data: { id, storageKey, userId: request.user.id, folderId: input.folderId, size: input.size, mimeType: input.mimeType, originalName: input.filename } });
        await tx.user.update({ where: { id: request.user.id }, data: { storageReserved: { decrement: input.size }, storageUsed: { increment: input.size } } });
        return created;
      });
      committed = true;
      await invalidateUserMetadata(app, request.user.id, cacheKeys.folder(request.user.id, file.folderId));
      return reply.code(201).send(jsonSafe({ file }));
    } finally {
      if (!committed) {
        try { if (written) await app.storage.remove(storageKey); }
        finally { await app.prisma.user.update({ where: { id: request.user.id }, data: { storageReserved: { decrement: input.size } } }); }
      }
    }
  });

  app.get("/", { preHandler: app.authenticate }, async request => {
    const q = z.object({ search: z.string().max(100).default(""), folderId: z.string().cuid().optional(), type: z.enum(["all", "image", "video", "audio", "document", "archive"]).default("all"), sort: z.enum(["name", "size", "createdAt"]).default("createdAt"), order: z.enum(["asc", "desc"]).default("desc"), page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(30) }).parse(request.query);
    const typeMap: Record<string, object> = { image: { startsWith: "image/" }, video: { startsWith: "video/" }, audio: { startsWith: "audio/" }, document: { in: ["application/pdf", "application/msword", "text/plain"] }, archive: { in: ["application/zip", "application/gzip"] } };
    const where = { userId: request.user.id, ...(q.folderId && { folderId: q.folderId }), ...(q.search && { originalName: { contains: q.search, mode: "insensitive" as const } }), ...(q.type !== "all" && { mimeType: typeMap[q.type] }) };
    const [files, total] = await app.prisma.$transaction([app.prisma.file.findMany({ where, include: { folder: { select: { id: true, name: true } } }, orderBy: { [q.sort === "name" ? "originalName" : q.sort]: q.order }, skip: (q.page - 1) * q.limit, take: q.limit }), app.prisma.file.count({ where })]);
    return jsonSafe({ files, pagination: { page: q.page, limit: q.limit, total, pages: Math.ceil(total / q.limit) } });
  });

  app.get("/:id", { preHandler: app.authenticate }, async request => {
    const { id } = idParams.parse(request.params);
    const key = cacheKeys.file(request.user.id, id);
    const cached = await app.redis.getJson<{ file: unknown }>(key).catch(() => null);
    if (cached) return cached;
    const file = await app.prisma.file.findFirst({ where: { id, userId: request.user.id }, include: { folder: { select: { id: true, name: true } } } });
    if (!file) throw new AppError(404, "File not found", "NOT_FOUND");
    const response = jsonSafe({ file });
    await app.redis.setJson(key, response, app.config.CACHE_TTL_SECONDS).catch(() => undefined);
    return response;
  });
  app.get("/:id/download", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const file = await app.prisma.file.findFirst({ where: { id, userId: request.user.id } });
    if (!file) throw new AppError(404, "File not found", "NOT_FOUND");
    const stream = await app.storage.read(file.storageKey);
    return reply.header("Content-Disposition", `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(file.originalName).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16)}`)}`)
      .header("Cache-Control", "private, no-store").header("Content-Length", file.size.toString())
      .type("application/octet-stream").send(stream);
  });
  app.patch("/:id", { preHandler: app.authenticate }, async request => {
    const { id } = idParams.parse(request.params);
    const { folderId } = z.object({ folderId: z.string().cuid() }).parse(request.body);
    const folder = await app.prisma.folder.findFirst({ where: { id: folderId, userId: request.user.id } });
    if (!folder) throw new AppError(404, "Folder not found", "NOT_FOUND");
    const result = await app.prisma.file.updateMany({ where: { id, userId: request.user.id }, data: { folderId } });
    if (!result.count) throw new AppError(404, "File not found", "NOT_FOUND");
    await invalidateUserMetadata(app, request.user.id, cacheKeys.file(request.user.id, id), cacheKeys.folder(request.user.id, folderId));
    return { success: true };
  });
  app.delete("/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const file = await app.prisma.file.findFirst({ where: { id, userId: request.user.id } });
    if (!file) throw new AppError(404, "File not found", "NOT_FOUND");
    try { await app.storage.remove(file.storageKey); } catch { throw new AppError(502, "Storage service could not delete the file", "STORAGE_ERROR"); }
    await app.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${request.user.id} FOR UPDATE`;
      const removed = await tx.file.deleteMany({ where: { id, userId: request.user.id } });
      if (removed.count) await tx.user.update({ where: { id: request.user.id }, data: { storageUsed: { decrement: file.size } } });
    });
    await invalidateUserMetadata(app, request.user.id, cacheKeys.file(request.user.id, id), cacheKeys.folder(request.user.id, file.folderId));
    return reply.code(204).send();
  });
};
export default routes;
