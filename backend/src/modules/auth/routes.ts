import argon2 from "argon2";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { AppError } from "../../lib/errors.js";
import { jsonSafe } from "../../lib/serialize.js";
import { createSession, hashToken, SESSION_COOKIE } from "../../plugins/auth.js";

const password = z.string().min(12).max(128).regex(/[a-z]/).regex(/[A-Z]/).regex(/[0-9]/).regex(/[^A-Za-z0-9]/);
const cookieOptions = (secure: boolean) => ({ httpOnly: true, secure, sameSite: "lax" as const, path: "/", signed: false });

const routes: FastifyPluginAsync = async (app) => {
  app.post("/register", { config: { rateLimit: { max: app.config.NODE_ENV === "test" ? 1000 : 5, timeWindow: "15 minutes" } } }, async (request, reply) => {
    const input = z.object({ name: z.string().trim().min(2).max(80), email: z.string().email().transform(v => v.toLowerCase()), password, confirmPassword: z.string() }).parse(request.body);
    if (input.password !== input.confirmPassword) throw new AppError(400, "Passwords do not match", "VALIDATION_ERROR");
    if (await app.prisma.user.findUnique({ where: { email: input.email }, select: { id: true } })) throw new AppError(409, "An account with this email already exists", "EMAIL_EXISTS");
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    const user = await app.prisma.$transaction(async tx => {
      const created = await tx.user.create({ data: { name: input.name, email: input.email, passwordHash, storageLimit: app.config.DEFAULT_STORAGE_LIMIT_BYTES } });
      await tx.folder.create({ data: { userId: created.id, name: "My Files", isRoot: true } });
      return created;
    });
    const session = await createSession(app, user.id);
    reply.setCookie(SESSION_COOKIE, session.token, { ...cookieOptions(app.config.NODE_ENV === "production"), expires: session.expiresAt });
    return reply.code(201).send(jsonSafe({ user: { id: user.id, name: user.name, email: user.email, storageLimit: user.storageLimit, storageUsed: user.storageUsed } }));
  });

  app.post("/login", { config: { rateLimit: { max: app.config.NODE_ENV === "test" ? 1000 : 10, timeWindow: "15 minutes" } } }, async (request, reply) => {
    const input = z.object({ email: z.string().email().transform(v => v.toLowerCase()), password: z.string().min(1).max(128) }).parse(request.body);
    const user = await app.prisma.user.findUnique({ where: { email: input.email } });
    if (!user || !await argon2.verify(user.passwordHash, input.password)) throw new AppError(401, "Invalid email or password", "INVALID_CREDENTIALS");
    const session = await createSession(app, user.id);
    reply.setCookie(SESSION_COOKIE, session.token, { ...cookieOptions(app.config.NODE_ENV === "production"), expires: session.expiresAt });
    return { user: { id: user.id, name: user.name, email: user.email } };
  });

  app.post("/logout", { preHandler: app.authenticate }, async (request, reply) => {
    await app.prisma.session.delete({ where: { id: request.sessionId } });
    reply.clearCookie(SESSION_COOKIE, cookieOptions(app.config.NODE_ENV === "production"));
    return reply.code(204).send();
  });
  app.get("/me", { preHandler: app.authenticate }, async request => jsonSafe({ user: request.user }));
};
export default routes;
