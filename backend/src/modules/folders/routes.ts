import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { AppError } from "../../lib/errors.js";
import { jsonSafe } from "../../lib/serialize.js";
import { cacheKeys, invalidateUserMetadata } from "../../lib/cache.js";
const params = z.object({ id: z.string().cuid() });

const routes: FastifyPluginAsync = async app => {
  app.get("/", { preHandler: app.authenticate }, async request => {
    const key = cacheKeys.folders(request.user.id);
    const cached = await app.redis.getJson<{ folders: unknown[] }>(key).catch(() => null);
    if (cached) return cached;
    const response = jsonSafe({ folders: await app.prisma.folder.findMany({ where: { userId: request.user.id }, orderBy: [{ isRoot: "desc" }, { name: "asc" }] }) });
    await app.redis.setJson(key, response, app.config.CACHE_TTL_SECONDS).catch(() => undefined);
    return response;
  });
  app.post("/", { preHandler: app.authenticate }, async (request, reply) => {
    const input = z.object({ name: z.string().trim().min(1).max(100), parentId: z.string().cuid().nullable().optional() }).parse(request.body);
    let parentId = input.parentId;
    if (!parentId) parentId = (await app.prisma.folder.findFirstOrThrow({ where: { userId: request.user.id, isRoot: true } })).id;
    if (!await app.prisma.folder.findFirst({ where: { id: parentId, userId: request.user.id } })) throw new AppError(404, "Parent folder not found", "NOT_FOUND");
    const folder = await app.prisma.folder.create({ data: { userId: request.user.id, parentId, name: input.name } });
    await invalidateUserMetadata(app, request.user.id, cacheKeys.folder(request.user.id, parentId));
    return reply.code(201).send(jsonSafe({ folder }));
  });
  app.get("/:id", { preHandler: app.authenticate }, async request => {
    const { id } = params.parse(request.params);
    const key = cacheKeys.folder(request.user.id, id);
    const cached = await app.redis.getJson<{ folder: unknown }>(key).catch(() => null);
    if (cached) return cached;
    const folder = await app.prisma.folder.findFirst({ where: { id, userId: request.user.id }, include: { children: { orderBy: { name: "asc" } }, files: { orderBy: { originalName: "asc" } } } });
    if (!folder) throw new AppError(404, "Folder not found", "NOT_FOUND");
    const response = jsonSafe({ folder });
    await app.redis.setJson(key, response, app.config.CACHE_TTL_SECONDS).catch(() => undefined);
    return response;
  });
  app.patch("/:id", { preHandler: app.authenticate }, async request => {
    const { id } = params.parse(request.params);
    const { name } = z.object({ name: z.string().trim().min(1).max(100) }).parse(request.body);
    const result = await app.prisma.folder.updateMany({ where: { id, userId: request.user.id, isRoot: false }, data: { name } });
    if (!result.count) throw new AppError(404, "Folder not found", "NOT_FOUND");
    await invalidateUserMetadata(app, request.user.id, cacheKeys.folder(request.user.id, id));
    return { success: true };
  });
  app.delete("/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = params.parse(request.params);
    const folder = await app.prisma.folder.findFirst({ where: { id, userId: request.user.id, isRoot: false }, include: { _count: { select: { files: true, children: true } } } });
    if (!folder) throw new AppError(404, "Folder not found", "NOT_FOUND");
    if (folder._count.files || folder._count.children) throw new AppError(409, "Folder must be empty before deletion", "FOLDER_NOT_EMPTY");
    await app.prisma.folder.delete({ where: { id } });
    await invalidateUserMetadata(app, request.user.id, cacheKeys.folder(request.user.id, id), ...(folder.parentId ? [cacheKeys.folder(request.user.id, folder.parentId)] : []));
    return reply.code(204).send();
  });
};
export default routes;
