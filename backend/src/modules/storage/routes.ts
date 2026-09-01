import type { FastifyPluginAsync } from "fastify";
import { jsonSafe } from "../../lib/serialize.js";

const routes: FastifyPluginAsync = async app => {
  app.get("/", { preHandler: app.authenticate }, async request => {
    const [counts, user] = await Promise.all([
      app.prisma.user.findUniqueOrThrow({ where: { id: request.user.id }, select: { _count: { select: { files: true, folders: true } } } }),
      app.prisma.user.findUniqueOrThrow({ where: { id: request.user.id }, select: { storageLimit: true, storageUsed: true } }),
    ]);
    return jsonSafe({ storageLimit: user.storageLimit, storageUsed: user.storageUsed, availableStorage: user.storageLimit - user.storageUsed, fileCount: counts._count.files, folderCount: Math.max(0, counts._count.folders - 1) });
  });
  app.post("/recalculate", { preHandler: app.authenticate }, async request => {
    const aggregate = await app.prisma.file.aggregate({ where: { userId: request.user.id }, _sum: { size: true } });
    const user = await app.prisma.user.update({ where: { id: request.user.id }, data: { storageUsed: aggregate._sum.size ?? 0n }, select: { storageLimit: true, storageUsed: true } });
    return jsonSafe(user);
  });
};
export default routes;
