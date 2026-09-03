import type { FastifyInstance } from "fastify";

export const cacheKeys = {
  storage: (userId: string) => `cache:storage:${userId}`,
  folders: (userId: string) => `cache:folders:${userId}`,
  folder: (userId: string, folderId: string) => `cache:folder:${userId}:${folderId}`,
  file: (userId: string, fileId: string) => `cache:file:${userId}:${fileId}`,
};

export async function invalidateUserMetadata(app: FastifyInstance, userId: string, ...extraKeys: string[]) {
  await app.redis.del(cacheKeys.storage(userId), cacheKeys.folders(userId), ...extraKeys).catch(() => undefined);
}
