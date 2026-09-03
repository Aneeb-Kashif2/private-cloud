# Self Cloud

Self Cloud is a secure cloud-storage MVP with a Next.js client, Fastify API, PostgreSQL metadata, Prisma ORM, opaque cookie sessions, and direct private Amazon S3 uploads.

## Architecture

The browser asks the API for a presigned `PutObject` URL, uploads directly to S3, and asks the API to complete the upload. Completion calls `HeadObject` and verifies the stored byte size and content type before creating metadata and moving reserved quota into used quota. Downloads are short-lived presigned URLs. Files never pass through PostgreSQL or the API server.

## Local development

Requirements: Node.js 22+, npm 9+, Docker, an AWS account, and a private S3 bucket.

```bash
cp .env.example .env
# Fill in AWS_S3_BUCKET, AWS credentials, and a strong AUTH_SECRET.
docker compose up -d postgres
npm install
npm run prisma:generate --workspace backend
npm run prisma:migrate --workspace backend
npm run dev
```

Open `http://localhost:3000`. The API listens on `http://localhost:4000`; health is available at `/health`.

To run everything in containers:

```bash
cp .env.example .env
# Fill in required secrets.
docker compose up --build
```

## Environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string, server only |
| `AWS_ACCESS_KEY_ID` | AWS credential, server only |
| `AWS_SECRET_ACCESS_KEY` | AWS credential, server only |
| `AWS_REGION` | Bucket region |
| `AWS_S3_BUCKET` | Private bucket name |
| `AUTH_SECRET` | 32+ character cookie/plugin secret, server only |
| `NEXT_PUBLIC_API_URL` | Browser-visible API base URL |
| `FRONTEND_ORIGIN` | Comma-separated exact browser-origin allowlist |
| `DEFAULT_STORAGE_LIMIT_BYTES` | New-account quota; default 10 GiB |
| `MAX_FILE_SIZE_BYTES` | Per-file limit; default 5 GiB |
| `PRESIGNED_URL_TTL_SECONDS` | Signed URL lifetime, maximum 900 seconds |
| `SESSION_TTL_DAYS` | Session lifetime |

Generate an auth secret with `openssl rand -base64 48`.

## Amazon S3 setup

1. Create an S3 bucket in the configured region.
2. Keep all four **Block Public Access** settings enabled. Do not add a public bucket policy or ACL.
3. Enable default encryption (SSE-S3 or SSE-KMS) and bucket versioning as desired.
4. Add this bucket CORS configuration, replacing the origin for production:

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000", "http://localhost:3001"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 600
  }
]
```

5. Give the backend identity only the required bucket permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
    "Resource": "arn:aws:s3:::YOUR_BUCKET/users/*"
  }]
}
```

`HeadObject` is authorized by `s3:GetObject`. In production, prefer an IAM role/workload identity over long-lived access keys. The bucket must not allow public access.

## Database and maintenance

```bash
# Development migration
npm run prisma:migrate --workspace backend

# Deploy committed migrations
npm run prisma:deploy --workspace backend

# Repair every user's used-storage counter from File rows
npm run prisma:recalculate --workspace backend
```

Core models are `User`, `Session`, `Folder`, `File`, and `UploadIntent`. The latter reserves quota and makes completion auditable/idempotent. Folder and file queries include the authenticated `userId`; root folders cannot be renamed or deleted.

## API

- `POST /api/auth/register`, `/login`, `/logout`; `GET /api/auth/me`
- `GET /api/storage`; `POST /api/storage/recalculate`
- `POST /api/files/upload-url`, `/complete`; `GET /api/files`
- `GET /api/files/:id`, `/api/files/:id/download`
- `PATCH /api/files/:id`; `DELETE /api/files/:id`
- `GET /api/folders`; `POST /api/folders`
- `GET`, `PATCH`, `DELETE /api/folders/:id`

All routes except registration and login require an HTTP-only opaque session cookie. Mutating browser requests are protected by exact-origin validation, and authentication endpoints are rate-limited.

## Verification

Tests require a migrated PostgreSQL test database. Never point them at production.

```bash
TEST_DATABASE_URL=postgresql://selfcloud:selfcloud@localhost:5432/selfcloud?schema=public npm test
npm run typecheck
npm run build
```

## MVP limitations

- Upload intents reserve quota for 15 minutes, but automated expiry/release should be run by a scheduled worker in a multi-instance production deployment.
- S3 `PutObject` presigning supports files up to S3's single-PUT limit (5 GiB). Larger files need multipart upload orchestration.
- Folder deletion is intentionally limited to empty folders. Trash, sharing, resumable uploads, antivirus scanning, email verification, password reset, and MFA are future features.
- Horizontal deployments should use a shared rate-limit store such as Redis.
