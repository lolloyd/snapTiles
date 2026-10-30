import "dotenv/config";
import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { randomBytes } from "node:crypto";
import { createAuth, ApiError } from "./auth.js";
import { localStore } from "./store.js";
import { localMedia, MAX_IMAGE_BYTES } from "./media.js";
import { createService } from "./service.js";

if (process.env.NODE_ENV === "production" || process.env.WEBSITE_INSTANCE_ID)
  throw new Error("The local API must never run in Azure or production.");
const directory = ".local";
const auth = createAuth(
  process.env.SESSION_SECRET || randomBytes(48).toString("hex"),
);
const media = localMedia(directory, auth);
const service = createService(await localStore(directory), media, auth, true);
const server = express();
server.disable("x-powered-by");
server.use(helmet());
server.use(
  "/api",
  rateLimit({
    windowMs: 60_000,
    limit: 180,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many requests. Please try again in a minute." },
  }),
);
server.use(
  "/api/local/media",
  express.raw({ type: "image/jpeg", limit: MAX_IMAGE_BYTES }),
);
server.all("/api/local/media/*path", async (request, response) => {
  const blobName = request.path.slice("/api/local/media/".length);
  const token =
    typeof request.query.token === "string" ? request.query.token : "";
  try {
    if (request.method === "PUT") {
      if (!Buffer.isBuffer(request.body))
        throw new ApiError(400, "Send a JPEG image.");
      await media.upload(blobName, token, request.body);
      response.status(201).end();
    } else if (request.method === "GET")
      response
        .set("Cache-Control", "no-store")
        .type("jpeg")
        .send(await media.read(blobName, token));
    else response.status(405).end();
  } catch (error) {
    response
      .status(error instanceof ApiError ? error.status : 500)
      .json({
        error:
          error instanceof ApiError ? error.message : "Media request failed.",
      });
  }
});
server.use(express.json({ limit: "32kb" }));
server.use("/api", async (request, response) => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers))
    if (typeof value === "string" && name !== "x-ms-client-principal")
      headers.set(name, value);
  const result = await service(
    new Request(`http://localhost:7071${request.originalUrl}`, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method)
        ? undefined
        : JSON.stringify(request.body),
    }),
  );
  result.headers.forEach((value, name) => response.set(name, value));
  response.status(result.status).send(await result.text());
});
server.use(
  (
    error: { status?: number },
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    response
      .status(error.status === 413 ? 413 : 400)
      .json({
        error:
          error.status === 413 ? "Request is too large." : "Invalid request.",
      });
  },
);
server.listen(7071, "127.0.0.1", () =>
  console.log(
    "SnapTiles LOCAL API: http://127.0.0.1:7071 (local organizer, disk data, no Azure resources)",
  ),
);
