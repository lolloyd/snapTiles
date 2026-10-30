import { app } from "@azure/functions";
import { createAuth } from "./auth.js";
import { cosmosStore } from "./store.js";
import { azureMedia } from "./media.js";
import { createService } from "./service.js";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required application setting: ${name}`);
  return value;
}
const service = createService(
  cosmosStore(required("COSMOS_CONNECTION_STRING")),
  azureMedia(required("STORAGE_ACCOUNT_NAME"), required("STORAGE_ACCOUNT_KEY")),
  createAuth(required("SESSION_SECRET")),
);
app.http("snaptiles", {
  route: "{*path}",
  methods: ["GET", "POST", "PATCH"],
  authLevel: "anonymous",
  async handler(request, context) {
    const started = Date.now();
    const response = await service(
      new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.method === "GET" ? undefined : await request.text(),
      }),
    );
    context.log(
      JSON.stringify({
        operation: request.method,
        path: new URL(request.url).pathname,
        status: response.status,
        durationMs: Date.now() - started,
      }),
    );
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: await response.text(),
    };
  },
});
