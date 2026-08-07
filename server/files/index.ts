import type { Response } from "express";
import { env } from "../env";

/**
 * Progress photo storage.
 *
 * The client contract is unchanged from the original app: ask for an upload
 * URL, PUT the file straight to it, then save the returned `objectPath`. Only
 * the backend behind it differs — local disk by default, S3-compatible object
 * storage when configured. Replit's GCS sidecar is gone.
 */
export interface UploadTarget {
  /** Where the client PUTs the file bytes. */
  uploadURL: string;
  /** Stable reference stored in progress_photos.file_path, e.g. /objects/uploads/<user>/<id>.jpg */
  objectPath: string;
}

export interface FileStore {
  readonly kind: "local" | "s3";
  /** Mint a short-lived, single-purpose upload URL scoped to one user. */
  createUpload(params: {
    userId: string;
    fileName: string;
    contentType: string;
    size: number;
  }): Promise<UploadTarget>;
  /** Stream (or redirect to) a stored object. Throws ObjectNotFoundError if absent. */
  serve(objectKey: string, res: Response): Promise<void>;
}

export class ObjectNotFoundError extends Error {
  readonly status = 404;
  constructor(key: string) {
    super(`Object not found: ${key}`);
    this.name = "ObjectNotFoundError";
  }
}

export class UploadRejectedError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "UploadRejectedError";
  }
}

const ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "image/heif": ".heif",
};

export function validateUpload(contentType: string, size: number): string {
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new UploadRejectedError(
      `Unsupported image type "${contentType}". Allowed: ${[...ALLOWED_CONTENT_TYPES].join(", ")}`,
    );
  }
  if (!Number.isFinite(size) || size <= 0) {
    throw new UploadRejectedError("File size must be a positive number");
  }
  if (size > env.MAX_UPLOAD_BYTES) {
    const limitMb = Math.round(env.MAX_UPLOAD_BYTES / (1024 * 1024));
    throw new UploadRejectedError(`File is larger than the ${limitMb}MB limit`);
  }
  return EXTENSION_BY_TYPE[contentType];
}

/**
 * Object keys embed the owning user id: uploads/<userId>/<uuid><ext>.
 *
 * That makes ownership checkable from the path alone, so a photo is protected
 * from the moment it is uploaded — before any database row exists to describe it.
 */
export function ownerOfKey(objectKey: string): string | null {
  const match = objectKey.match(/^uploads\/([0-9a-fA-F-]{36})\//);
  return match ? match[1] : null;
}

let cached: FileStore | null = null;

export async function getFileStore(): Promise<FileStore> {
  if (cached) return cached;
  if (env.FILE_STORE === "s3") {
    const { S3FileStore } = await import("./s3");
    cached = new S3FileStore();
  } else {
    const { LocalFileStore } = await import("./local");
    cached = new LocalFileStore();
  }
  return cached;
}

/** Test hook — lets a suite swap in a fake store. */
export function setFileStore(store: FileStore | null): void {
  cached = store;
}
