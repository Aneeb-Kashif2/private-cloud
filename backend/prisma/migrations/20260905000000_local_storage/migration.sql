-- Keep historical migrations intact so existing installations can upgrade.
ALTER TABLE "File" RENAME COLUMN "s3Key" TO "storageKey";
ALTER INDEX "File_s3Key_key" RENAME TO "File_storageKey_key";
DROP TABLE "UploadIntent";
DROP TYPE "UploadStatus";
ALTER TABLE "User" ALTER COLUMN "storageLimit" SET DEFAULT 5368709120;
UPDATE "User" SET "storageLimit" = 5368709120, "storageReserved" = 0;
