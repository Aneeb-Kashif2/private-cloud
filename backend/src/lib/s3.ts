import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Config } from "../config.js";

export function createS3(config: Config) {
  const client = new S3Client({ region: config.AWS_REGION });
  return {
    async uploadUrl(key: string, mimeType: string) {
      return getSignedUrl(client, new PutObjectCommand({ Bucket: config.AWS_S3_BUCKET, Key: key, ContentType: mimeType }), { expiresIn: config.PRESIGNED_URL_TTL_SECONDS });
    },
    async downloadUrl(key: string, filename: string) {
      const safe = filename.replace(/["\r\n]/g, "_");
      return getSignedUrl(client, new GetObjectCommand({ Bucket: config.AWS_S3_BUCKET, Key: key, ResponseContentDisposition: `attachment; filename="${safe}"` }), { expiresIn: config.PRESIGNED_URL_TTL_SECONDS });
    },
    async head(key: string) { return client.send(new HeadObjectCommand({ Bucket: config.AWS_S3_BUCKET, Key: key })); },
    async remove(key: string) { await client.send(new DeleteObjectCommand({ Bucket: config.AWS_S3_BUCKET, Key: key })); },
  };
}
export type S3Service = ReturnType<typeof createS3>;
