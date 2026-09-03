import { createHash, randomBytes } from "node:crypto";
import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { AppError } from "../lib/errors.js";

export const SESSION_COOKIE = "selfcloud_session";
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
type CachedSession = { sessionId: string; expiresAt: string; user: { id: string; name: string; email: string; storageLimit: string; storageUsed: string; storageReserved: string } };

function sessionUser(user: CachedSession["user"]) {
  return { ...user, storageLimit: BigInt(user.storageLimit), storageUsed: BigInt(user.storageUsed), storageReserved: BigInt(user.storageReserved) };
}

export async function createSession(app: FastifyInstance, userId: string) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + app.config.SESSION_TTL_DAYS * 86_400_000);
  const session = await app.prisma.session.create({
    data: { tokenHash, userId, expiresAt },
    include: { user: { select: { id: true, name: true, email: true, storageLimit: true, storageUsed: true, storageReserved: true } } },
  });
  await app.redis.setJson(`session:${tokenHash}`, {
    sessionId: session.id,
    expiresAt: expiresAt.toISOString(),
    user: { ...session.user, storageLimit: session.user.storageLimit.toString(), storageUsed: session.user.storageUsed.toString(), storageReserved: session.user.storageReserved.toString() },
  }, app.config.SESSION_TTL_DAYS * 86_400).catch(() => undefined);
  return { token, expiresAt };
}

export default fp(async (app) => {
  app.decorateRequest("user");
  app.decorateRequest("sessionId", "");
  app.decorate("authenticate", async (request: FastifyRequest) => {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) throw new AppError(401, "Authentication required", "UNAUTHENTICATED");
    const tokenHash = hashToken(token);
    const cached = await app.redis.getJson<CachedSession>(`session:${tokenHash}`).catch(() => null);
    if (cached && new Date(cached.expiresAt) > new Date()) {
      request.user = sessionUser(cached.user);
      request.sessionId = cached.sessionId;
      return;
    }
    const session = await app.prisma.session.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, name: true, email: true, storageLimit: true, storageUsed: true, storageReserved: true } } },
    });
    if (!session || session.expiresAt <= new Date()) {
      if (session) await app.prisma.session.delete({ where: { id: session.id } });
      await app.redis.del(`session:${tokenHash}`).catch(() => undefined);
      throw new AppError(401, "Session expired", "UNAUTHENTICATED");
    }
    request.user = session.user;
    request.sessionId = session.id;
    const ttl = Math.max(1, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000));
    await app.redis.setJson(`session:${tokenHash}`, {
      sessionId: session.id,
      expiresAt: session.expiresAt.toISOString(),
      user: { ...session.user, storageLimit: session.user.storageLimit.toString(), storageUsed: session.user.storageUsed.toString(), storageReserved: session.user.storageReserved.toString() },
    }, ttl).catch(() => undefined);
  });
});
