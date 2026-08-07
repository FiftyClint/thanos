import crypto from "node:crypto";
import type { Response } from "express";
import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../env";
import { logger } from "../logger";
import { type FileStore, type UploadTarget, ObjectNotFoundError, validateUpload } from "./index";

const PRESIGN_TTL_SECONDS = 600;

/**
 * S3-compatible object storage (AWS S3, Cloudflare R2, Backblaze B2, MinIO...).
 *
 * Uploads go straight from the phone to the bucket via a presigned PUT, and
 * reads redirect to a presigned GET, so photo bytes never pass through the app.
 * Enable with FILE_STORE=s3.
 */
export class S3FileStore implements FileStore {
  readonly kind = "s3" as const;
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    this.bucket = env.S3_BUCKET!;
    this.client = new S3Client({
      region: env.S3_REGION!,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID!,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
      },
    });
    logger.info({ bucket: this.bucket, endpoint: env.S3_ENDPOINT }, "s3 file store ready");
  }

  async createUpload(params: {
    userId: string;
    fileName: string;
    contentType: string;
    size: number;
  }): Promise<UploadTarget> {
    const extension = validateUpload(params.contentType, params.size);
    const key = `uploads/${params.userId}/${crypto.randomUUID()}${extension}`;

    const uploadURL = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: params.contentType,
        ContentLength: params.size,
      }),
      { expiresIn: PRESIGN_TTL_SECONDS },
    );

    return { uploadURL, objectPath: `/objects/${key}` };
  }

  async serve(objectKey: string, res: Response): Promise<void> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }));
    } catch {
      throw new ObjectNotFoundError(objectKey);
    }

    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      { expiresIn: PRESIGN_TTL_SECONDS },
    );
    res.redirect(302, url);
  }
}
