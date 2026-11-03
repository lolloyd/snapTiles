import imageCompression from "browser-image-compression";
import { zipSync } from "fflate";
import type { Game, Player } from "../../shared/domain";

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

export function safeFileName(value: string, fallback = "file") {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return cleaned || fallback;
}

export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Fetches a signed photo URL, waiting out API rate limits. */
export async function fetchPhoto(url: string): Promise<Blob> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url);
    if (response.ok) return response.blob();
    if (response.status !== 429 || attempt >= 6)
      throw new Error("A photo could not be downloaded. Refresh and try again.");
    const retryAfter = Number(response.headers.get("retry-after"));
    await new Promise((resolve) =>
      setTimeout(resolve, (retryAfter > 0 ? retryAfter : 15) * 1000),
    );
  }
}

export async function playerPhotos(player: Player) {
  const photos = new Map<number, Blob>();
  for (const tile of player.tiles)
    if (tile.photoUrl) photos.set(tile.index, await fetchPhoto(tile.photoUrl));
  return photos;
}

export function photoFileName(index: number, prompt: string) {
  return `${String(index + 1).padStart(2, "0")}-${safeFileName(prompt, "photo")}.jpg`;
}

function wrapLines(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (context.measureText(next).width <= maxWidth || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/\s*\S*$/, "")}…`;
  }
  return lines;
}

/** Renders a shareable PNG card of a player's board. */
export async function renderPlayerCard(
  game: Game,
  player: Player,
  photos: Map<number, Blob>,
): Promise<Blob> {
  await document.fonts.ready;
  const width = 1080;
  const padding = 60;
  const gap = 12;
  const header = 230;
  const footer = 110;
  const size = game.gridSize;
  const tile = (width - padding * 2 - gap * (size - 1)) / size;
  const height = header + size * tile + (size - 1) * gap + footer;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#f7f9f6";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#174c3c";
  context.fillRect(0, 0, width, 14);

  context.textBaseline = "alphabetic";
  context.fillStyle = "#75817b";
  context.font = "700 22px Manrope, sans-serif";
  context.fillText(`${game.title.toUpperCase()} · ${game.roomCode}`, padding, 80, width - padding * 2);
  context.fillStyle = "#213b33";
  context.font = "800 56px Manrope, sans-serif";
  context.fillText(player.displayName, padding, 148, width - padding * 2 - 220);
  context.fillStyle = player.hasWon ? "#174c3c" : "#75817b";
  context.font = "700 26px 'DM Sans', sans-serif";
  context.textAlign = "right";
  context.fillText(
    player.hasWon ? "BINGO!" : `${player.completedLines} lines`,
    width - padding,
    148,
  );
  context.textAlign = "left";
  context.fillStyle = "#75817b";
  context.font = "500 22px 'DM Sans', sans-serif";
  context.fillText(
    `${player.tiles.length}/${size ** 2} photos`,
    padding,
    190,
  );

  for (const slot of game.promptSlots) {
    const x = padding + (slot.index % size) * (tile + gap);
    const y = header + Math.floor(slot.index / size) * (tile + gap);
    context.save();
    context.beginPath();
    context.roundRect(x, y, tile, tile, 14);
    context.clip();
    const photo = photos.get(slot.index);
    if (photo) {
      const bitmap = await createImageBitmap(photo);
      const scale = Math.max(tile / bitmap.width, tile / bitmap.height);
      const drawWidth = bitmap.width * scale;
      const drawHeight = bitmap.height * scale;
      context.drawImage(
        bitmap,
        x + (tile - drawWidth) / 2,
        y + (tile - drawHeight) / 2,
        drawWidth,
        drawHeight,
      );
      bitmap.close();
      const shade = context.createLinearGradient(0, y + tile * 0.45, 0, y + tile);
      shade.addColorStop(0, "rgba(0,0,0,0)");
      shade.addColorStop(1, "rgba(0,0,0,0.7)");
      context.fillStyle = shade;
      context.fillRect(x, y, tile, tile);
      context.fillStyle = "#fff";
    } else {
      context.fillStyle = "#e7f0e9";
      context.fillRect(x, y, tile, tile);
      context.fillStyle = "#5d7466";
    }
    const fontSize = size === 5 ? 15 : 22;
    context.font = `700 ${fontSize}px 'DM Sans', sans-serif`;
    const lines = wrapLines(context, slot.text, tile - 24, size === 5 ? 3 : 2);
    lines.forEach((line, index) =>
      context.fillText(
        line,
        x + 12,
        y + tile - 14 - (lines.length - 1 - index) * (fontSize + 4),
      ),
    );
    context.restore();
  }

  context.fillStyle = "#174c3c";
  context.font = "800 30px Manrope, sans-serif";
  context.fillText("SnapTiles", padding, height - 46);
  context.fillStyle = "#e98170";
  context.fillText(".", padding + context.measureText("SnapTiles").width, height - 46);
  context.fillStyle = "#75817b";
  context.font = "500 20px 'DM Sans', sans-serif";
  context.textAlign = "right";
  context.fillText("Photo scavenger bingo", width - padding, height - 48);

  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not create the card."))),
      "image/png",
    ),
  );
}

export async function zipBlob(files: Record<string, Blob>): Promise<Blob> {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, blob] of Object.entries(files))
    entries[name] = new Uint8Array(await blob.arrayBuffer());
  // Photos and PNGs are already compressed.
  const zipped = zipSync(entries, { level: 0 });
  return new Blob([zipped as BlobPart], { type: "application/zip" });
}
