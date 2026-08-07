import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { Response } from "express";
import { env, sessionSecret } from "../env";
import { logger } from "../logger";
import {
  type FileStore,
  type UploadTarget,
  ObjectNotFoundError,
  UploadRejectedError,
  validateUpload,
} from "./index";

const UPLOAD_TOKEN_TTL_MS = 10 * 60 * 1000;

export interface UploadTicket {
  key: string;
  contentType: string;
  maxBytes: number;
  expiresAt: number;
}

/**
 * Stores photos on a local volume.
 *
 * Upload URLs are stateless: the ticket (object key, content type, size limit,
 * expiry) is serialised and HMAC-signed, so a restart doesn't invalidate an
 * in-flight upload and nothing has to be tracked in memory. A tampered ticket
 * fails the signature check; an expired one is refused.
 */
export class LocalFileStore implements FileStore {
  readonly kind = "local" as const;
  private readonly root: string;
  private readonly signingKey: string;

  constructor(root = env.UPLOAD_DIR) {
    this.root = path.resolve(root);
    fs.mkdirSync(this.root, { recursive: true });
    // Derived from the session secret so there is only one secret to manage.
    this.signingKey = crypto.createHmac("sha256", sessionSecret).update("upload-tickets").digest("hex");
    logger.info({ root: this.root }, "local file store ready");
  }

  private sign(payload: string): string {
    return crypto.createHmac("sha256", this.signingKey).update(payload).digest("base64url");
  }

  private encodeTicket(ticket: UploadTicket): string {
    const payload = Buffer.from(JSON.stringify(ticket)).toString("base64url");
    return `${payload}.${this.sign(payload)}`;
  }

  decodeTicket(token: string): UploadTicket {
    const [payload, signature] = token.split(".");
    if (!payload || !signature) throw new UploadRejectedError("Malformed upload token");

    const expected = this.sign(payload);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new UploadRejectedError("Invalid upload token");
    }

    const ticket = JSON.parse(Buffer.from(payload, "base64url").toString()) as UploadTicket;
    if (Date.now() > ticket.expiresAt) {
      throw new UploadRejectedError("Upload token has expired — please retry");
    }
    return ticket;
  }

  /** Resolve an object key to an absolute path, refusing anything that escapes the root. */
  private resolveKey(objectKey: string): string {
    const target = path.resolve(this.root, objectKey);
    const rootWithSep = this.root.endsWith(path.sep) ? this.root : this.root + path.sep;
    if (!target.startsWith(rootWithSep)) {
      throw new UploadRejectedError("Invalid object path");
    }
    return target;
  }

  async createUpload(params: {
    userId: string;
    fileName: string;
    contentType: string;
    size: number;
  }): Promise<UploadTarget> {
    const extension = validateUpload(params.contentType, params.size);
    const key = `uploads/${params.userId}/${crypto.randomUUID()}${extension}`;

    const token = this.encodeTicket({
      key,
      contentType: params.contentType,
      maxBytes: Math.min(params.size + 1024, env.MAX_UPLOAD_BYTES),
      expiresAt: Date.now() + UPLOAD_TOKEN_TTL_MS,
    });

    return {
      uploadURL: `/api/uploads/put?token=${encodeURIComponent(token)}`,
      objectPath: `/objects/${key}`,
    };
  }

  async write(objectKey: string, data: Buffer): Promise<void> {
    const target = this.resolveKey(objectKey);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, data);
  }

  async serve(objectKey: string, res: Response): Promise<void> {
    const target = this.resolveKey(objectKey);
    let stat: fs.Stats;
    try {
      stat = await fsp.stat(target);
    } catch {
      throw new ObjectNotFoundError(objectKey);
    }
    if (!stat.isFile()) throw new ObjectNotFoundError(objectKey);

    res.setHeader("Content-Length", stat.size);
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.type(path.extname(target));

    await new Promise<void>((resolve, reject) => {
      const stream = fs.createReadStream(target);
      stream.on("error", reject);
      stream.on("end", resolve);
      stream.pipe(res);
    });
  }
}
