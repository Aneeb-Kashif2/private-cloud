import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { AppError } from "../../lib/errors.js";
import { jsonSafe } from "../../lib/serialize.js";
import { cacheKeys, invalidateUserMetadata } from "../../lib/cache.js";

const allowedMime = /^(image\/|video\/|audio\/|text\/|application\/(pdf|zip|gzip|json|xml|msword|vnd\.|octet-stream))/i;
const idParams = z.object({ id: z.string().uuid() });

const routes: FastifyPluginAsync = async app => {
  app.post("/upload-url", { preHandler: app.authenticate }, async (request, reply) => {
    const input = z.object({ filename: z.string().trim().min(1).max(255), size: z.coerce.bigint().positive(), mimeType: z.string().min(1).max(150), folderId: z.string().cuid() }).parse(request.body);
    if (input.size > app.config.MAX_FILE_SIZE_BYTES) throw new AppError(413, "File exceeds the maximum upload size", "FILE_TOO_LARGE");
    if (!allowedMime.test(input.mimeType)) throw new AppError(415, "This file type is not allowed", "INVALID_FILE_TYPE");
    const folder = await app.prisma.folder.findFirst({ where: { id: input.folderId, userId: request.user.id }, select: { id: true } });
    if (!folder) throw new AppError(404, "Folder not found", "NOT_FOUND");
    const fileId = randomUUID();
    const cleanName = input.filename.replace(/[^A-Za-z0-9._ -]/g, "_");
    const s3Key = `users/${request.user.id}/files/${fileId}-${cleanName}`;
    const expiresAt = new Date(Date.now() + 15 * 60_000);
    const intent = await app.redis.withLock(`upload:user:${request.user.id}`, app.config.UPLOAD_LOCK_TTL_MS, () => app.prisma.$transaction(async tx => {
      const updated = await tx.user.updateMany({
        where: { id: request.user.id, storageUsed: { lte: request.user.storageLimit - input.size }, storageReserved: { lte: request.user.storageLimit - request.user.storageUsed - input.size } },
        data: { storageReserved: { increment: input.size } },
      });
      if (updated.count !== 1) throw new AppError(413, "Not enough available storage", "QUOTA_EXCEEDED");
      return tx.uploadIntent.create({ data: { id: fileId, userId: request.user.id, folderId: folder.id, originalName: input.filename, s3Key, mimeType: input.mimeType, size: input.size, expiresAt } });
    }));
    try {
      const uploadUrl = await app.s3.uploadUrl(s3Key, input.mimeType);
      return reply.code(201).send(jsonSafe({ uploadId: intent.id, uploadUrl, expiresAt }));
    } catch (error) {
      await app.prisma.$transaction([app.prisma.uploadIntent.delete({ where: { id: intent.id } }), app.prisma.user.update({ where: { id: request.user.id }, data: { storageReserved: { decrement: input.size } } })]);
      throw error;
    }
  });

  app.post("/complete", { preHandler: app.authenticate }, async request => {
    const { uploadId } = z.object({ uploadId: z.string().uuid() }).parse(request.body);
    const file = await app.redis.withLock(`upload:user:${request.user.id}`, app.config.UPLOAD_LOCK_TTL_MS, async () => {
      const intent = await app.prisma.uploadIntent.findFirst({ where: { id: uploadId, userId: request.user.id, status: "PENDING" } });
      if (!intent || intent.expiresAt <= new Date()) throw new AppError(404, "Upload is invalid or expired", "UPLOAD_NOT_FOUND");
      let object;
      try { object = await app.s3.head(intent.s3Key); } catch { throw new AppError(409, "Upload has not reached storage", "UPLOAD_INCOMPLETE"); }
      if (BigInt(object.ContentLength ?? -1) !== intent.size || object.ContentType !== intent.mimeType) {
        await app.s3.remove(intent.s3Key).catch(() => undefined);
        throw new AppError(409, "Uploaded object does not match the request", "UPLOAD_MISMATCH");
      }
      return app.prisma.$transaction(async tx => {
        const claimed = await tx.uploadIntent.updateMany({ where: { id: intent.id, userId: request.user.id, status: "PENDING" }, data: { status: "COMPLETED" } });
        if (claimed.count !== 1) throw new AppError(409, "Upload was already completed", "UPLOAD_COMPLETED");
        const created = await tx.file.create({ data: { id: intent.id, userId: intent.userId, folderId: intent.folderId, originalName: intent.originalName, s3Key: intent.s3Key, mimeType: intent.mimeType, size: intent.size } });
        await tx.user.update({ where: { id: request.user.id }, data: { storageReserved: { decrement: intent.size }, storageUsed: { increment: intent.size } } });
        return created;
      });
    });
    await invalidateUserMetadata(app, request.user.id, cacheKeys.folder(request.user.id, file.folderId));
    return jsonSafe({ file });
  });

  app.get("/", { preHandler: app.authenticate }, async request => {
    const q = z.object({ search: z.string().max(100).default(""), folderId: z.string().cuid().optional(), type: z.enum(["all", "image", "video", "audio", "document", "archive"]).default("all"), sort: z.enum(["name", "size", "createdAt"]).default("createdAt"), order: z.enum(["asc", "desc"]).default("desc"), page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(30) }).parse(request.query);
    const typeMap: Record<string, object> = { image: { startsWith: "image/" }, video: { startsWith: "video/" }, audio: { startsWith: "audio/" }, document: { in: ["application/pdf", "application/msword", "text/plain"] }, archive: { in: ["application/zip", "application/gzip"] } };
    const where = { userId: request.user.id, ...(q.folderId && { folderId: q.folderId }), ...(q.search && { originalName: { contains: q.search, mode: "insensitive" as const } }), ...(q.type !== "all" && { mimeType: typeMap[q.type] }) };
    const [files, total] = await app.prisma.$transaction([app.prisma.file.findMany({ where, include: { folder: { select: { id: true, name: true } } }, orderBy: { [q.sort]: q.order }, skip: (q.page - 1) * q.limit, take: q.limit }), app.prisma.file.count({ where })]);
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
  app.get("/:id/download", { preHandler: app.authenticate }, async request => {
    const { id } = idParams.parse(request.params);
    const file = await app.prisma.file.findFirst({ where: { id, userId: request.user.id } });
    if (!file) throw new AppError(404, "File not found", "NOT_FOUND");
    return { url: await app.s3.downloadUrl(file.s3Key, file.originalName), expiresIn: app.config.PRESIGNED_URL_TTL_SECONDS };
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
    try { await app.s3.remove(file.s3Key); } catch { throw new AppError(502, "Storage service could not delete the file", "STORAGE_ERROR"); }
    await app.prisma.$transaction(async tx => {
      const removed = await tx.file.deleteMany({ where: { id, userId: request.user.id } });
      if (removed.count) await tx.user.update({ where: { id: request.user.id }, data: { storageUsed: { decrement: file.size } } });
    });
    await invalidateUserMetadata(app, request.user.id, cacheKeys.file(request.user.id, id), cacheKeys.folder(request.user.id, file.folderId));
    return reply.code(204).send();
  });
};
export default routes;
