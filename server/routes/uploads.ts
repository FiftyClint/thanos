import express, { Router } from "express";
import { uploadRequestSchema } from "@shared/schema";
import { env } from "../env";
import { logger } from "../logger";
import { requireAuth, userIdOf } from "../middleware/auth";
import { asyncHandler, forbidden, notFound } from "../middleware/error";
import { getFileStore, ownerOfKey, ObjectNotFoundError, UploadRejectedError } from "../files";
import type { LocalFileStore } from "../files/local";

export const uploadRouter = Router();

/**
 * Step 1 of the upload flow: hand back a URL to PUT the bytes to.
 *
 * Same two-step contract the client already used against Replit's object
 * storage, so the check-in page didn't change.
 */
uploadRouter.post(
  "/uploads/request-url",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { name, size, contentType } = uploadRequestSchema.parse(req.body);
    const store = await getFileStore();

    const target = await store.createUpload({
      userId: userIdOf(req),
      fileName: name,
      contentType,
      size,
    });

    res.json({ ...target, metadata: { name, size, contentType } });
  }),
);

/**
 * Step 2, local store only: receive the bytes.
 *
 * With FILE_STORE=s3 the client PUTs straight to the bucket and never reaches
 * this route. The signed ticket carries the object key and size limit, so this
 * endpoint needs no session of its own — though it still requires one, because
 * an unauthenticated write endpoint is a bad idea even with a signature.
 */
uploadRouter.put(
  "/uploads/put",
  requireAuth,
  express.raw({ type: "*/*", limit: env.MAX_UPLOAD_BYTES }),
  asyncHandler(async (req, res) => {
    const store = await getFileStore();
    if (store.kind !== "local") {
      throw notFound("Direct upload is not enabled for this storage backend");
    }

    const token = typeof req.query.token === "string" ? req.query.token : "";
    if (!token) throw new UploadRejectedError("Missing upload token");

    const local = store as LocalFileStore;
    const ticket = local.decodeTicket(token);

    // The ticket was minted for one user; a stolen link can't write elsewhere.
    if (ownerOfKey(ticket.key) !== userIdOf(req)) {
      throw forbidden("Upload token does not belong to this account");
    }

    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new UploadRejectedError("Empty upload body");
    }
    if (body.length > ticket.maxBytes) {
      throw new UploadRejectedError("Upload is larger than the size it was authorised for");
    }

    await local.write(ticket.key, body);
    logger.info({ key: ticket.key, bytes: body.length }, "photo stored");
    res.status(200).json({ objectPath: `/objects/${ticket.key}` });
  }),
);

export const objectRouter = Router();

/**
 * Serve a stored photo.
 *
 * Progress photos were previously readable by anyone who knew (or guessed) the
 * URL. Ownership is encoded in the key, so a session check is enough.
 */
objectRouter.get(
  /^\/objects\/(.+)$/,
  requireAuth,
  asyncHandler(async (req, res) => {
    const objectKey = decodeURIComponent((req.params as unknown as string[])[0]);

    if (ownerOfKey(objectKey) !== userIdOf(req)) {
      throw forbidden("This file belongs to another account");
    }

    const store = await getFileStore();
    try {
      await store.serve(objectKey, res);
    } catch (err) {
      if (err instanceof ObjectNotFoundError) throw notFound("Photo not found");
      throw err;
    }
  }),
);
