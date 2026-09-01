import { createHash, randomBytes } from "node:crypto";
import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { AppError } from "../lib/errors.js";

export const SESSION_COOKIE = "selfcloud_session";
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(app: FastifyInstance, userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + app.config.SESSION_TTL_DAYS * 86_400_000);
  await app.prisma.session.create({ data: { tokenHash: hashToken(token), userId, expiresAt } });
  return { token, expiresAt };
}

export default fp(async (app) => {
  app.decorateRequest("user");
  app.decorateRequest("sessionId", "");
  app.decorate("authenticate", async (request: FastifyRequest) => {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) throw new AppError(401, "Authentication required", "UNAUTHENTICATED");
    const session = await app.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { select: { id: true, name: true, email: true, storageLimit: true, storageUsed: true, storageReserved: true } } },
    });
    if (!session || session.expiresAt <= new Date()) {
      if (session) await app.prisma.session.delete({ where: { id: session.id } });
      throw new AppError(401, "Session expired", "UNAUTHENTICATED");
    }
    request.user = session.user;
    request.sessionId = session.id;
  });
});
