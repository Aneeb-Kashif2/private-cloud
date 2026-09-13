import archiver from "archiver";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { once } from "node:events";
import type { LocalStorage } from "./storage.js";

export type BackupFile = {
  id: string; storageKey: string; originalName: string; size: bigint;
  mimeType: string; createdAt: Date; folder: { id: string; name: string };
};

// Each UUID gets its own directory, so duplicate names can never overwrite a file.
function archiveName(file: BackupFile) {
  const name = file.originalName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 150).replace(/^\.+/, "") || "file";
  return `files/${file.id}/${name}`;
}

export async function createFileBackup(files: BackupFile[], storage: LocalStorage) {
  const sources: Awaited<ReturnType<LocalStorage["read"]>>[] = [];
  const archive = archiver("zip", { store: true, forceZip64: true });
  const readers: Readable[] = [];
  const records: object[] = [];
  const controller = new AbortController();
  const abort = () => {
    controller.abort();
    for (const source of sources) source.destroy();
    for (const reader of readers) reader.destroy();
    archive.abort();
  };
  archive.on("error", abort);
  archive.on("warning", error => archive.destroy(error));
  try {
    // Open all selected files before sending headers. Existing safe storage access
    // rejects symlinks; an unlinked file stays readable through this descriptor.
    for (const file of files) {
      const source = await storage.read(file.storageKey);
      source.on("error", error => archive.destroy(error));
      sources.push(source);
    }
    const start = async () => {
      for (const [index, file] of files.entries()) {
        controller.signal.throwIfAborted();
        const source = sources[index];
        const name = archiveName(file);
        const reader = Readable.from((async function* () {
          const hash = createHash("sha256");
          let size = 0n;
          for await (const chunk of source) {
            size += BigInt(chunk.length);
            if (size > file.size) throw new Error("Backup file size mismatch");
            hash.update(chunk);
            yield chunk;
          }
          if (size !== file.size) throw new Error("Backup file size mismatch");
          records.push({ id: file.id, name: file.originalName, archive_path: name,
            folder: file.folder, mime_type: file.mimeType, created_at: file.createdAt.toISOString(),
            size_bytes: size.toString(), sha256: hash.digest("hex") });
        })());
        reader.on("error", error => archive.destroy(error));
        readers.push(reader);
        const completed = once(archive, "entry", { signal: controller.signal });
        archive.append(reader, { name, date: file.createdAt, mode: 0o600 });
        await completed;
      }
      // Append only after every file is consumed and its checksum is complete.
      archive.append(JSON.stringify({ format: "secure-cloud-file-export-v1", timestamp: new Date().toISOString(),
        file_count: files.length, storage_size_bytes: files.reduce((sum, file) => sum + file.size, 0n).toString(),
        files: records }, null, 2), { name: "manifest.json", mode: 0o600 });
      await archive.finalize();
    };
    return { archive, abort, start };
  } catch (error) {
    abort();
    throw error;
  }
}
