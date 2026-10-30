import imageCompression from "browser-image-compression";

export class RequestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    token?: string;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: options.method || "GET",
    signal: options.signal,
    headers: {
      "content-type": "application/json",
      ...(options.token ? { "x-participant-token": options.token } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!response.headers.get("content-type")?.includes("application/json"))
    throw new RequestError(
      "The service is unavailable. Please try again shortly.",
      response.status,
    );
  const result = await response.json();
  if (!response.ok)
    throw new RequestError(
      result.error || "The request could not be completed.",
      response.status,
    );
  return result as T;
}

export function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}

export async function compressImage(file: File): Promise<Blob> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error("Choose a JPEG, PNG, or WebP photo.");
  if (file.size > 20 * 1024 * 1024)
    throw new Error("Choose a photo smaller than 20 MB.");
  return imageCompression(file, {
    maxSizeMB: 1,
    maxWidthOrHeight: 1200,
    useWebWorker: false,
    fileType: "image/jpeg",
    initialQuality: 0.8,
  });
}

export function dateLabel(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
