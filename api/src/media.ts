import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
  SASProtocol,
} from "@azure/storage-blob";
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
}

export function localMedia(directory: string, auth: Auth) {
  const root = path.resolve(directory, "uploads");
  function filePath(blobName: string) {
    if (
      !/^game-[A-Z2-9]{6}\/player-[a-f0-9-]+\/tile-\d+-[a-f0-9-]+\.jpg$/.test(
        blobName,
      )
    )
      throw new ApiError(400, "Invalid photo path.");
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
      return {
        blobName,
        uploadUrl: `/api/local/media/${blobName}?token=${await auth.sign({ blobName }, "upload", "5m")}`,
      };
    },
    validate,
    async readUrl(blobName) {
      return `/api/local/media/${blobName}?token=${await auth.sign({ blobName }, "photo", "10m")}`;
    },
  };
  return {
    ...media,
    async upload(blobName: string, token: string, bytes: Buffer) {
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
    async read(blobName: string, token: string) {
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
}

export function azureMedia(account: string, key: string): Media {
  const credential = new StorageSharedKeyCredential(account, key);
  const containerName = "snaptiles-uploads";
  const container = new BlobServiceClient(
    `https://${account}.blob.core.windows.net`,
    credential,
  ).getContainerClient(containerName);
  function url(blobName: string, permissions: string, minutes: number) {
    const sas = generateBlobSASQueryParameters(
      {
        containerName,
        blobName,
        permissions: BlobSASPermissions.parse(permissions),
        protocol: SASProtocol.Https,
        startsOn: new Date(Date.now() - 60_000),
        expiresOn: new Date(Date.now() + minutes * 60_000),
      },
      credential,
    ).toString();
    return `${container.getBlobClient(blobName).url}?${sas}`;
  }
  return {
    async ticket(blobName) {
      return { blobName, uploadUrl: url(blobName, "c", 5) };
    },
    async readUrl(blobName) {
      return url(blobName, "r", 10);
    },
    async validate(blobName) {
      try {
        const blob = container.getBlobClient(blobName);
        const properties = await blob.getProperties();
        if (
          !properties.contentLength ||
          properties.contentLength > MAX_IMAGE_BYTES ||
          properties.contentType !== "image/jpeg"
        )
          throw new Error("Invalid image");
        const header = await blob.downloadToBuffer(0, 3);
        if (!validJpeg(header)) throw new Error("Invalid JPEG");
      } catch {
        throw new ApiError(
          400,
          "The uploaded JPEG could not be verified. Upload a JPEG smaller than 5 MB.",
        );
      }
    },
  };
}
