# Secure-Cloud architecture

The Ubuntu laptop runs Next.js, Fastify, PostgreSQL and Redis directly. File content lives in `/srv/secure-cloud-storage`; PostgreSQL/Prisma stores users, sessions, folders, file metadata and quota counters. Redis accelerates sessions and metadata access without deciding quota availability.

Uploads stream through authenticated Fastify routes to exclusive UUID files with private permissions. PostgreSQL reserves quota atomically against the 5 GiB per-user limit and commits file metadata and usage only after exact-size verification. Failed uploads remove partial content and release reservations. Downloads verify ownership and return an attachment stream. Permanent deletion removes content before transactionally deleting metadata and decrementing usage. Logical folder changes never move physical paths.

The frontend keeps its upload progress, browsing, search, filters, folders and file details. Both download buttons use the authenticated API directly.

See [README](README.md) for native Ubuntu setup, configuration, migration, crash recovery and validation commands.
