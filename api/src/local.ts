import "dotenv/config";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { createAuth } from "./auth.js";
import { localStore } from "./sqlite-store.js";
import { localMedia } from "./media.js";
import { createHttpApp } from "./http.js";
import { createService } from "./service.js";

if (process.env.NODE_ENV === "production" || process.env.WEBSITE_INSTANCE_ID)
  throw new Error("The local API must never run in Azure or production.");
const directory = ".local";
const databasePath =
  process.env.SQLITE_DB_PATH || path.join(directory, "data.sqlite");
const auth = createAuth(
  process.env.SESSION_SECRET || randomBytes(48).toString("hex"),
);
const media = localMedia(directory, auth);
const service = createService(
  await localStore(directory, databasePath),
  media,
  auth,
  true,
);
const server = createHttpApp(service, media);
server.listen(7071, "127.0.0.1", () =>
  console.log(
    "SnapTiles LOCAL API: http://127.0.0.1:7071 (local organizer, disk data, no Azure resources)",
  ),
);
