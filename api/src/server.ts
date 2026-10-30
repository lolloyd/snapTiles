import "dotenv/config";
import path from "node:path";
import { createAuth } from "./auth.js";
import { createHttpApp } from "./http.js";
import { azureMedia } from "./media.js";
import { createService } from "./service.js";
import { sqliteStore } from "./sqlite-store.js";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required application setting: ${name}`);
  return value;
}

if (process.env.NODE_ENV !== "production" && !process.env.WEBSITE_INSTANCE_ID)
  throw new Error("The Azure API host must run with NODE_ENV=production.");

const databasePath =
  process.env.SQLITE_DB_PATH ||
  path.join(process.env.HOME || "/home", "data", "snaptiles.sqlite");
const store = sqliteStore(databasePath);
const auth = createAuth(required("SESSION_SECRET"));
const media = azureMedia(required("STORAGE_ACCOUNT_NAME"), auth);
const service = createService(store, media, auth);
const server = createHttpApp(service, media, 1);
const port = Number(process.env.PORT || 8080);
const listener = server.listen(port, "0.0.0.0", () => {
  console.log(`SnapTiles API listening on port ${port}; SQLite data: ${databasePath}`);
});

for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () =>
    listener.close(() => {
      store.close();
      process.exit(0);
    }),
  );