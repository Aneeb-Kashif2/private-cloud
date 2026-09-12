import { randomBytes, createHash } from "node:crypto";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { AppError } from "../../lib/errors.js";
import { jsonSafe } from "../../lib/serialize.js";

const fileParams = z.object({ id: z.string().uuid() });
const shareIdParams = z.object({ shareId: z.string().cuid() });
const tokenParams = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, "Invalid share token") });
const expiration = z.enum(["1h", "1d", "7d", "never"]);
const createInput = z.object({ expiration: expiration.default("never"), maxDownloads: z.number().int().positive().max(10000).nullable().default(null) });

const hashShareToken = (token: string) => createHash("sha256").update(token).digest("hex");
const expiryFrom = (value: z.infer<typeof expiration>) => value === "never" ? null : new Date(Date.now() + ({ "1h": 3_600_000, "1d": 86_400_000, "7d": 604_800_000 }[value]));

function publicFailure() {
  return new AppError(404, "Share link is unavailable", "SHARE_UNAVAILABLE");
}

async function findAvailableShare(app: FastifyInstance, token: string) {
  const share = await app.prisma.fileShare.findUnique({ where: { tokenHash: hashShareToken(token), }, include: { file: { select: { originalName: true, mimeType: true, size: true, storageKey: true } } } });
  if (!share || share.revokedAt || (share.expiresAt && share.expiresAt <= new Date()) || (share.maxDownloads !== null && share.downloadCount >= share.maxDownloads)) throw publicFailure();
  return share;
}

const routes: FastifyPluginAsync = async app => {
  app.post("/files/:id/shares", { preHandler: app.authenticate }, async request => {
    const { id } = fileParams.parse(request.params);
    const input = createInput.parse(request.body ?? {});
    const file = await app.prisma.file.findFirst({ where: { id, userId: request.user.id }, select: { id: true } });
    if (!file) throw new AppError(404, "File not found", "NOT_FOUND");
    const token = randomBytes(32).toString("base64url");
    const share = await app.prisma.fileShare.create({ data: { fileId: file.id, userId: request.user.id, tokenHash: hashShareToken(token), expiresAt: expiryFrom(input.expiration), maxDownloads: input.maxDownloads }, select: { id: true, expiresAt: true, maxDownloads: true, downloadCount: true, createdAt: true } });
    request.log.info({ event: "share_created" });
    return jsonSafe({ share: { ...share, token } });
  });

  app.get("/files/:id/shares", { preHandler: app.authenticate }, async request => {
    const { id } = fileParams.parse(request.params);
    const file = await app.prisma.file.findFirst({ where: { id, userId: request.user.id }, select: { id: true } });
    if (!file) throw new AppError(404, "File not found", "NOT_FOUND");
    const shares = await app.prisma.fileShare.findMany({ where: { fileId: id, userId: request.user.id }, orderBy: { createdAt: "desc" }, select: { id: true, expiresAt: true, maxDownloads: true, downloadCount: true, revokedAt: true, createdAt: true } });
    return jsonSafe({ shares });
  });

  app.delete("/shares/:shareId", { preHandler: app.authenticate }, async (request, reply) => {
    const { shareId } = shareIdParams.parse(request.params);
    const result = await app.prisma.fileShare.updateMany({ where: { id: shareId, userId: request.user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!result.count) throw new AppError(404, "Share link not found", "NOT_FOUND");
    request.log.info({ event: "share_revoked" });
    return reply.code(204).send();
  });

  app.get("/shares/:token", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async request => {
    const { token } = tokenParams.parse(request.params);
    const share = await findAvailableShare(app, token);
    request.log.info({ event: "share_viewed" });
    return jsonSafe({ file: { originalName: share.file.originalName, mimeType: share.file.mimeType, size: share.file.size }, expiresAt: share.expiresAt, maxDownloads: share.maxDownloads, downloadCount: share.downloadCount });
  });

  app.get("/shares/:token/download", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { token } = tokenParams.parse(request.params);
    const tokenHash = hashShareToken(token);
    const now = new Date();
    const claimed = await app.prisma.$executeRaw`UPDATE "FileShare" SET "downloadCount" = "downloadCount" + 1, "updatedAt" = NOW() WHERE "tokenHash" = ${tokenHash} AND "revokedAt" IS NULL AND ("expiresAt" IS NULL OR "expiresAt" > ${now}) AND ("maxDownloads" IS NULL OR "downloadCount" < "maxDownloads")`;
    if (!claimed) throw publicFailure();
    const share = await app.prisma.fileShare.findUnique({ where: { tokenHash }, include: { file: { select: { originalName: true, mimeType: true, size: true, storageKey: true } } } });
    if (!share) throw publicFailure();
    try {
      const stream = await app.storage.read(share.file.storageKey);
      request.log.info({ event: "share_downloaded" });
      return reply.header("Content-Disposition", `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(share.file.originalName).replace(/['()*]/g, character => `%${character.charCodeAt(0).toString(16)}`)}`).header("Cache-Control", "public, max-age=0, no-store").header("Content-Length", share.file.size.toString()).type("application/octet-stream").send(stream);
    } catch (error) {
      request.log.warn({ event: "share_download_storage_failure" });
      throw error;
    }
  });
};

export default routes;
