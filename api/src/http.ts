import express from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { ApiError } from "./auth.js";
import { MAX_IMAGE_BYTES, type Media } from "./media.js";

export type ApiHandler = (request: Request) => Promise<Response>;

export function createHttpApp(
  service: ApiHandler,
  media: Media,
  trustProxy: number | boolean = false,
) {
  const server = express();
  server.disable("x-powered-by");
  server.set("trust proxy", trustProxy);
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
    "/api/public/media",
    express.raw({ type: "image/jpeg", limit: MAX_IMAGE_BYTES }),
  );
  server.all("/api/public/media/*path", async (request, response) => {
    const blobName = request.path.slice("/api/public/media/".length);
    const token =
      typeof request.query.token === "string" ? request.query.token : "";
    try {
      if (request.method === "PUT") {
        if (!Buffer.isBuffer(request.body))
          throw new ApiError(400, "Send a JPEG image.");
        await media.write(blobName, token, request.body);
        response.status(201).end();
      } else if (request.method === "GET") {
        response
          .set("Cache-Control", "no-store")
          .type("jpeg")
          .send(await media.read(blobName, token));
      } else response.status(405).end();
    } catch (error) {
      response.status(error instanceof ApiError ? error.status : 500).json({
        error:
          error instanceof ApiError ? error.message : "Media request failed.",
      });
    }
  });
  server.use(express.json({ limit: "32kb" }));
  server.use("/api", async (request, response) => {
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers))
      if (typeof value === "string") headers.set(name, value);
    const result = await service(
      new Request(`http://localhost${request.originalUrl}`, {
        method: request.method,
        headers,
        body:
          ["GET", "HEAD"].includes(request.method) || request.body === undefined
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
  return server;
}