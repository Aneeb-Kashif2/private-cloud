# Self Cloud Project Overview

## What This Project Does

Self Cloud is a private file-storage web application. Users can register, log in, create folders, upload files, browse their files, search and filter files, download files, and permanently delete files.

The application stores users, sessions, folders, quotas, and file metadata in PostgreSQL. The actual file contents are stored privately in Amazon S3 and are never stored in PostgreSQL.

## Technology Stack

| Area | Technology | Purpose |
| --- | --- | --- |
| Frontend | Next.js App Router | Pages, routing, and the browser application |
| Language | TypeScript | Type safety in the frontend and backend |
| Styling | Tailwind CSS | Responsive interface and dark mode |
| Backend | Node.js and Fastify | Authentication and file-management API |
| Validation | Zod | Validates API request bodies, parameters, and environment values |
| ORM | Prisma | Safe PostgreSQL queries, relations, and migrations |
| Database | PostgreSQL | Users, sessions, folders, quotas, and file metadata |
| File storage | Amazon S3 | Private storage for actual uploaded files |
| Password security | Argon2id | Secure password hashing |
| Authentication | Opaque database sessions | HTTP-only cookie authentication |
| Containers | Docker and Docker Compose | Local PostgreSQL and deployable application services |
| Testing | Vitest and Fastify Inject | API and authorization integration tests |

## Main Application Flow

### Registration

1. The user submits a name, email, password, and password confirmation.
2. Zod validates the submitted values and password strength.
3. The backend checks that the email is not already registered.
4. Argon2id hashes the password. The original password is never stored.
5. PostgreSQL receives the user record with a configurable storage limit.
6. The backend creates the user's `My Files` root folder.
7. The backend creates a session and returns an HTTP-only cookie.

### Login and Sessions

1. The backend finds the user by normalized email.
2. Argon2 verifies the supplied password against the stored hash.
3. A random opaque session token is generated.
4. Only a SHA-256 hash of the token is stored in the `Session` table.
5. The browser receives the original token in an HTTP-only cookie.
6. Protected API routes resolve this cookie before performing any work.

### Upload

```text
Browser -> request upload URL from Fastify
Fastify -> authenticate user and check folder ownership
Fastify -> validate file size, MIME type, and available quota
Fastify -> reserve quota and create an UploadIntent
Fastify -> return a presigned S3 PUT URL
Browser -> upload the file directly to private S3
Browser -> request upload completion
Fastify -> verify the S3 object with HeadObject
Fastify -> create File metadata and update storageUsed
```

Large file bytes do not pass through the Fastify server. The browser sends them directly to S3.

### Download

1. The browser requests `/api/files/:id/download`.
2. The backend authenticates the session.
3. The database query includes both the file ID and authenticated user ID.
4. The backend returns a short-lived presigned S3 URL.
5. The browser downloads the private object using that temporary URL.

### Deletion

1. The backend verifies file ownership.
2. The object is deleted from S3 first.
3. If S3 succeeds, the metadata is deleted from PostgreSQL.
4. The user's `storageUsed` counter is decreased in a transaction.
5. If S3 fails, the database record is retained.

## Database Models

- `User`: account data, password hash, storage limit, used storage, and reserved storage.
- `Session`: hashed session token, user relationship, and expiration time.
- `Folder`: user-owned folder hierarchy, including a protected root folder.
- `File`: file name, owner, folder, S3 key, MIME type, size, and timestamps.
- `UploadIntent`: pending upload details and reserved quota before completion.

The Prisma schema is at `backend/prisma/schema.prisma`. Committed migrations are under `backend/prisma/migrations`.

## Required Environment Variables

Create a root `.env` and a `backend/.env`. For local development they can contain the same backend values. Both files are ignored by Git.

```env
# PostgreSQL connection used by Prisma and Fastify
DATABASE_URL=postgresql://selfcloud:selfcloud@localhost:5432/selfcloud?schema=public

# AWS credentials used only by the backend
AWS_ACCESS_KEY_ID=your-iam-access-key-id
AWS_SECRET_ACCESS_KEY=your-iam-secret-access-key
AWS_REGION=us-east-1
AWS_S3_BUCKET=your-private-bucket-name

# Generate with: openssl rand -base64 48
AUTH_SECRET=replace-with-a-random-secret-of-at-least-32-characters

# Browser-visible API URL
NEXT_PUBLIC_API_URL=http://localhost:4000/api

# Exact frontend origin accepted by CORS and origin protection
FRONTEND_ORIGIN=http://localhost:3000

# Backend runtime
PORT=4000
NODE_ENV=development

# 10 GiB default quota for newly registered users
DEFAULT_STORAGE_LIMIT_BYTES=10737418240

# Maximum single upload size, currently 5 GiB
MAX_FILE_SIZE_BYTES=5368709120

# Presigned upload/download lifetime in seconds, maximum 900
PRESIGNED_URL_TTL_SECONDS=600

# Login session lifetime
SESSION_TTL_DAYS=30
```

Never expose `DATABASE_URL`, `AWS_SECRET_ACCESS_KEY`, or `AUTH_SECRET` using a `NEXT_PUBLIC_` prefix. Only `NEXT_PUBLIC_API_URL` is intended for browser code.

For production, use different secrets and URLs:

```env
NODE_ENV=production
NEXT_PUBLIC_API_URL=https://api.example.com/api
FRONTEND_ORIGIN=https://cloud.example.com
```

## AWS S3 Requirements

1. Create the bucket in the same region as `AWS_REGION`.
2. Enable all S3 Block Public Access settings.
3. Do not add a public ACL or public bucket policy.
4. Enable default encryption.
5. Give the backend IAM identity `s3:PutObject`, `s3:GetObject`, and `s3:DeleteObject` for `arn:aws:s3:::BUCKET_NAME/users/*`.
6. Add bucket CORS permission for the frontend origin and the `PUT`, `GET`, and `HEAD` methods.
7. Prefer an IAM role instead of permanent access keys in production.

Example development bucket CORS configuration:

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 600
  }
]
```

## Local Development Commands

```bash
# Start PostgreSQL
docker compose up -d postgres

# Install dependencies
npm install

# Generate the Prisma client
npm run prisma:generate --workspace backend

# Apply the database migration
npm run prisma:migrate --workspace backend

# Start the backend
npm run dev --workspace backend

# Start the frontend in another terminal
npm run dev --workspace frontend
```

Application URLs:

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:4000`
- API health check: `http://localhost:4000/health`
- PostgreSQL: `localhost:5432`

Run the complete Docker stack with:

```bash
docker compose up --build
```

## Useful Maintenance and Verification Commands

```bash
# Recalculate used storage from File rows
npm run prisma:recalculate --workspace backend

# Run security tests with the local PostgreSQL database
TEST_DATABASE_URL=postgresql://selfcloud:selfcloud@localhost:5432/selfcloud?schema=public npm test

# Type-check frontend and backend
npm run typecheck

# Create production builds
npm run build

# Check production dependencies
npm audit --omit=dev
```

## Security Controls Already Implemented

- Argon2id password hashing.
- HTTP-only session cookies that are secure in production.
- Hashed session tokens in PostgreSQL.
- Expiring sessions and logout invalidation.
- Rate limiting on registration and login.
- Exact-origin checking on state-changing requests.
- Restricted CORS and Helmet security headers.
- Zod validation for API input and environment configuration.
- Server-side quota and file-size enforcement.
- Server-side ownership checks on files and folders.
- Private S3 objects and short-lived presigned URLs.
- S3 object verification before file metadata is committed.
- Sensitive request-field redaction from logs.
- Prisma parameterized database operations.

The frontend is never trusted to enforce ownership, storage limits, or object access.

## Current MVP Limitations

- Real uploads require valid AWS credentials and a configured private bucket.
- Uploads larger than 5 GiB need an S3 multipart-upload implementation.
- Expired upload intents need a scheduled cleanup worker in production.
- Folder deletion currently requires the folder to be empty.
- Trash is informational; deletion is currently permanent.
- File sharing, antivirus scanning, password reset, email verification, and MFA are not implemented yet.
- A multi-instance production deployment should use a shared rate-limit store such as Redis.

More operational detail is available in `README.md`.
