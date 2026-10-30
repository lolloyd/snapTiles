import { BlobServiceClient, type BlobClient } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Auth } from "./auth.js";
import { ApiError } from "./auth.js";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export function validJpeg(bytes: Uint8Array) {
  return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
}

export interface Media {
  ticket(blobName: string): Promise<{ uploadUrl: string; blobName: string }>;
  validate(blobName: string): Promise<void>;
  readUrl(blobName: string): Promise<string>;
  write(blobName: string, token: string, bytes: Buffer): Promise<void>;
  read(blobName: string, token: string): Promise<Buffer>;
}

const blobNamePattern =
  /^game-[A-Z2-9]{6}\/player-[a-f0-9-]+\/tile-\d+-[a-f0-9-]{36}\.jpg$/;

function assertBlobName(blobName: string) {
  if (!blobNamePattern.test(blobName)) throw new ApiError(400, "Invalid photo path.");
}

export function localMedia(directory: string, auth: Auth) {
  const root = path.resolve(directory, "uploads");
  function filePath(blobName: string) {
    assertBlobName(blobName);
    return path.join(root, blobName);
  }
  async function validate(blobName: string) {
    try {
      const bytes = await readFile(filePath(blobName));
      if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || !validJpeg(bytes))
        throw new Error("Invalid image");
    } catch {
      throw new ApiError(400, "The uploaded JPEG could not be verified.");
    }
  }
  const media: Media = {
    async ticket(blobName) {
      assertBlobName(blobName);
      return {
        blobName,
        uploadUrl: `/api/public/media/${blobName}?token=${await auth.sign({ blobName }, "upload", "5m")}`,
      };
    },
    validate,
    async readUrl(blobName) {
      assertBlobName(blobName);
      return `/api/public/media/${blobName}?token=${await auth.sign({ blobName }, "photo", "10m")}`;
    },
    async write(blobName, token, bytes) {
      const claims = await auth.verify(token, "upload");
      if (
        claims.blobName !== blobName ||
        !validJpeg(bytes) ||
        bytes.length > MAX_IMAGE_BYTES
      )
        throw new ApiError(400, "Upload a JPEG smaller than 5 MB.");
      const destination = filePath(blobName);
      await mkdir(path.dirname(destination), { recursive: true });
      try {
        await writeFile(destination, bytes, { flag: "wx" });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST")
          throw new ApiError(409, "This upload has already been used.");
        throw error;
      }
    },
    async read(blobName, token) {
      const claims = await auth.verify(token, "photo");
      if (claims.blobName !== blobName)
        throw new ApiError(403, "This photo is not available.");
      try {
        return await readFile(filePath(blobName));
      } catch {
        throw new ApiError(404, "Photo not found.");
      }
    },
  };
  return media;
}

export function azureMedia(account: string, auth: Auth): Media {
  const credential = new DefaultAzureCredential();
  const containerName = "snaptiles-uploads";
  const container = new BlobServiceClient(
    `https://${account}.blob.core.windows.net`,
    credential,
  ).getContainerClient(containerName);
  function mediaUrl(blobName: string, token: string) {
    assertBlobName(blobName);
    return `/api/public/media/${blobName}?token=${token}`;
  }
  async function verifiedBytes(blob: BlobClient): Promise<Buffer> {
    const properties = await blob.getProperties();
    if (
      !properties.contentLength ||
      properties.contentLength > MAX_IMAGE_BYTES ||
      properties.contentType !== "image/jpeg"
    )
      throw new ApiError(400, "The uploaded JPEG could not be verified.");
    const bytes = await blob.downloadToBuffer();
    if (!validJpeg(bytes))
      throw new ApiError(400, "The uploaded JPEG could not be verified.");
    return bytes;
  }
  return {
    async ticket(blobName) {
      assertBlobName(blobName);
      const token = await auth.sign({ blobName }, "upload", "5m");
      return { blobName, uploadUrl: mediaUrl(blobName, token) };
    },
    async readUrl(blobName) {
      const token = await auth.sign({ blobName }, "photo", "10m");
      return mediaUrl(blobName, token);
    },
    async validate(blobName) {
      try {
        assertBlobName(blobName);
        await verifiedBytes(container.getBlobClient(blobName));
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(
          400,
          "The uploaded JPEG could not be verified. Upload a JPEG smaller than 5 MB.",
        );
      }
    },
    async write(blobName, token, bytes) {
      const claims = await auth.verify(token, "upload");
      if (
        claims.blobName !== blobName ||
        bytes.length === 0 ||
        bytes.length > MAX_IMAGE_BYTES ||
        !validJpeg(bytes)
      )
        throw new ApiError(400, "Upload a JPEG smaller than 5 MB.");
      assertBlobName(blobName);
      const blockBlob = container.getBlockBlobClient(blobName);
      try {
        await blockBlob.uploadData(bytes, {
          blobHTTPHeaders: { blobContentType: "image/jpeg" },
          conditions: { ifNoneMatch: "*" },
        });
      } catch (error) {
        if ((error as { statusCode?: number }).statusCode === 412)
          throw new ApiError(409, "This upload has already been used.");
        throw error;
      }
    },
    async read(blobName, token) {
      const claims = await auth.verify(token, "photo");
      if (claims.blobName !== blobName)
        throw new ApiError(403, "This photo is not available.");
      assertBlobName(blobName);
      return verifiedBytes(container.getBlobClient(blobName));
    },
  };
}
