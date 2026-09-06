import { constants } from "node:fs";
import { mkdir, realpath, open, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { AppError } from "./errors.js";

export async function createLocalStorage(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const root = await realpath(directory);
  if (root !== resolve(directory)) throw new Error("Storage directory must not contain symlinks");
  function path(key: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(key)) throw new AppError(400, "Invalid storage key", "INVALID_STORAGE_KEY");
    return join(root, key);
  }
  return {
    async write(key: string, source: NodeJS.ReadableStream, expected: bigint) {
      const handle = await open(path(key), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      let bytes = 0n;
      const counter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        bytes += BigInt(chunk.length);
        callback(bytes > expected ? new AppError(413, "Upload exceeds declared size", "FILE_TOO_LARGE") : null, chunk);
      } });
      try {
        await pipeline(source, counter, handle.createWriteStream());
        if (bytes !== expected) throw new AppError(409, "Upload size does not match request", "UPLOAD_MISMATCH");
      } catch (error) {
        await handle.close();
        await unlink(path(key));
        throw error;
      }
    },
    async read(key: string) {
      try {
        const handle = await open(path(key), constants.O_RDONLY | constants.O_NOFOLLOW);
        return handle.createReadStream();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new AppError(404, "File content not found", "NOT_FOUND");
        throw error;
      }
    },
    async remove(key: string) {
      try { await unlink(path(key)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    },
  };
}
export type LocalStorage = Awaited<ReturnType<typeof createLocalStorage>>;
