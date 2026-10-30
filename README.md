# SnapTiles

Photo scavenger bingo with organizer-managed rooms and account-free participant boards. The application supports 3x3/5x5 grids, custom prompts, QR invitations, compressed photo uploads through the API, line/blackout wins, private-photo review, and room closure/reopening.

## Run Locally

Prerequisites: Node.js 24 LTS and npm. Azure CLI is only needed for infrastructure operations.

```powershell
npm ci
npm run dev
```

Open http://127.0.0.1:5173 for participants or http://127.0.0.1:5173/admin for organizers. The local API binds to `127.0.0.1:7071`. If either port is in use, stop the conflicting process or adjust both the dev-server configuration and the Playwright configuration. Vite otherwise automatically offers the next available frontend port.

The local server provides a visibly marked organizer identity and uses SQLite at `api/.local/data.sqlite` with private image files under `api/.local/uploads/`. It does not connect to Azure or create Azure resources. Never expose it to the internet or use it in production. It refuses to run with `NODE_ENV=production` or in an Azure App Service host. Missing records from an existing `api/.local/data.json` are imported idempotently into SQLite; the original file is left untouched.

Data persists across API restarts. Without a local `SESSION_SECRET` environment setting of at least 32 characters, restarting the API invalidates existing participant sessions; rejoining creates a new board. Participant tokens last 12 hours and are retained only in the current browser tab's session storage. Reloading the tab restores the board while its token is valid. Leaving removes that token, not the event's data.

An organizer's `/admin/new` view creates a new room; the room's Invite Players dialog supplies its participant URL and QR code. There is intentionally no seeded event or fake attendance data.

## Verify

```powershell
npm run check
npx playwright install chromium
npm run test:e2e
```

`check` runs shared/API tests, production builds, and frontend lint. Browser tests cover desktop/mobile creation, QR generation, joining, JPEG compression/upload, line completion, session restoration, organizer review, closure, and 5x5 blackout configuration. Test images are generated from browser screenshots. Browser artifacts are under `test-results/` and are not committed.

## Structure

| Path                   | Purpose                                                                    |
| ---------------------- | -------------------------------------------------------------------------- |
| `web/`                 | React/TypeScript Vite frontend; routes and SWA security configuration      |
| `api/src/service.ts`   | Shared API request handling, validation, authorization, and win evaluation |
| `api/src/server.ts`    | Production App Service API host; SQLite and managed-identity Blob access   |
| `api/src/sqlite-store.ts` | SQLite schema, transactions, rate limits, and local data migration       |
| `api/src/local.ts`     | Loopback-only local API host                                                |
| `api/src/media.ts`     | Private local/Blob media storage behind short-lived API tickets            |
| `shared/`              | Game contracts, preset prompt library, and win rules                       |
| `infra/`               | Bicep provisioning and guarded PowerShell preview/deployment               |
| `Assets/`              | Sprint-based implementation plan                                           |

## Azure Provisioning

No Azure resources are provisioned by installing dependencies, running the app, or executing tests. Obtain explicit approval of the subscription, region, environment, resource scope, and costs before provisioning.

Use a new resource group and new resources for each SnapTiles environment. The provisioning wrapper refuses to adopt an existing group. Bicep derives resource names from the new group ID; Azure validation rejects a globally occupied name rather than adopting it. If validation reports a collision, choose a different deployment ID.

Preview only, using the intended subscription:

```powershell
./infra/Deploy.ps1 -SubscriptionId '<subscription-id>' -Environment dev -Location eastus2 -DeploymentId '<new-id>'
```

After reviewing the what-if and costs, rerun with the same arguments plus `-Provision`. The script requests confirmation before provisioning. All resources are in a newly created SnapTiles resource group; it never deletes failed deployments automatically. The design uses SWA Standard (required for linked App Service APIs), App Service Basic B1 for one SQLite instance, and usage-billed private Blob Storage. A deployment preview is not a pricing estimate. Set subscription budgets/alerts in Azure before launch.

The template creates SWA Standard, a one-instance Linux App Service API, a VNet-integrated subnet, and a private HTTPS-only Blob Storage account/container. Storage firewall default action is `Deny`; only the API integration subnet is allowed. The App Service system identity receives `Storage Blob Data Contributor` on the uploads container. Game, player, prompt, and rate-limit data live in SQLite at `/home/data/snaptiles.sqlite` on App Service's persistent home share. Keep the app at one instance: SQLite is not a horizontally scaled database. Room codes are part of game IDs, so room lookup is a local primary-key read.

The session secret is generated inside deployment and written only to App Service settings. Outputs contain app URLs and resource names, not secrets. The API requires `STORAGE_ACCOUNT_NAME` and `SESSION_SECRET`; Blob authentication uses the App Service managed identity, not an account key. Do not copy secrets into the frontend, Git, chat, logs, or workflow files.

## Automatic SWA Deployment

The existing SnapTiles SWA is `https://witty-flower-0b795680f.6.azurestaticapps.net/`. The Azure-generated workflow at [.github/workflows/azure-static-web-apps-witty-flower-0b795680f.yml](.github/workflows/azure-static-web-apps-witty-flower-0b795680f.yml) runs on pushes to `main`, validates/tests the project, and uploads the built `web/dist` frontend using the SWA deployment secret Azure created. A local commit alone does not trigger GitHub Actions; push the commit to `main`.

The existing SWA is currently Free, which is sufficient for static frontend deployment. Its resource group currently contains only the SWA, so `/api/*` has no cloud backend yet; organizer and participant data workflows will not work on the deployed site until the API is provisioned and linked.

## API Deployment and Authentication

The manual **Deploy SnapTiles API** workflow requires an App Service created by the infrastructure deployment. Before deploying it, link that App Service to the SWA in the Azure portal. SWA-to-App-Service linking requires SWA Standard and configures the `Azure Static Web Apps (Linked)` identity provider. Do not expose the API to anonymous direct App Service traffic.

Configure the selected GitHub environment with `SNAP_TILES_API_PUBLISH_PROFILE` and the repository variable `SNAP_TILES_API_APP_NAME`. Store the publish profile as a secret. The API workflow deploys only the API; the frontend deploys automatically from `main`.

SWA Microsoft sign-in is used at `/.auth/login/aad?post_login_redirect_uri=/admin`. Invite organizers with the custom `admin` role through SWA Role Management. The API validates the trusted SWA principal and game ownership. The App Service managed identity accesses private Blob Storage through the allowed VNet subnet; browser clients never connect directly to Blob Storage.

Keep the API at one App Service instance; do not enable scale-out or autoscale. For growth beyond one instance, migrate SQLite to a managed relational database before scaling. Provision an isolated staging environment and use separate SWA/API deployment credentials. Test sign-in, role assignment, room creation, API-proxied photo upload/read, and closure in Azure; local tests cannot validate those integrations.

## API

| Method    | Route                                         | Access                                                |
| --------- | --------------------------------------------- | ----------------------------------------------------- |
| GET       | `/api/health`, `/api/me`                      | Public health/identity summary                        |
| GET, POST | `/api/games`                                  | Organizer list/create                                 |
| GET       | `/api/prompts`                                | Organizer prompt library                              |
| GET       | `/api/admin/games/:id/submissions?cursor=...` | Owning organizer; pages of 30                         |
| PATCH     | `/api/admin/games/:id`                        | Owning organizer; `ACTIVE`/`CLOSED`                   |
| POST      | `/api/public/join`                            | Room code/display name; issues session                |
| GET       | `/api/public/session`                         | Participant session restoration/private photo refresh |
| POST      | `/api/public/uploads/ticket`                   | Participant; one tile's five-minute API upload ticket |
| PUT, GET  | `/api/public/media/:blobName`                 | Signed media ticket; proxy private Blob writes/reads  |
| POST      | `/api/public/submit-tile`                     | Participant; verify blob, replace tile, evaluate win  |

Participant endpoints use `x-participant-token`. JWTs are signed with HS256, restricted issuer/audience, and a 12-hour expiry. Game/player identity comes only from the verified claims. Submissions validate JPEG signatures, MIME type, size (5 MB maximum after compression), blob ownership, tile bounds, and active room status. Each upload has a fresh blob name; the API writes with a create-only condition to prevent overwriting a previously verified blob. Replacement changes the tile record and never increases its count. SQLite transactions and optimistic revisions prevent simultaneous submissions from losing another tile update.

Photos stay private. Boards/review receive ten-minute signed API URLs; the API reads/writes Blob using its managed identity over the VNet service endpoint. Participant boards refresh every 30 seconds and review refreshes every five minutes. Media tickets are bearer credentials: do not log/share them. Storage account keys are disabled.

Public requests use SQLite transactions for 90/minute per session/client and 600/minute globally, with hashed client/session identifiers and two-minute expiry. The HTTP adapter has an additional 180/minute IP limit. These limits rely on one API instance and are application abuse controls, not a substitute for Azure edge/WAF protection.

## Operations and Release Gates

- **Rotation:** Rotate the App Service `SESSION_SECRET` through secure settings; existing participant tokens immediately become invalid. The API uses managed identity for Blob Storage, so no account key rotation is required. Never print secrets or media tokens to logs.
- **Monitoring:** App Service emits operation path, status, and duration without request bodies, tokens, or photo URLs. Set up Azure monitoring, error alerts, storage usage budgets, and an event-size load test before public launch. Application Insights retention/export is not provisioned by this starter template.
- **Backups:** The SQLite database is on the persistent App Service home share, but automated database backups are not provisioned. Configure and test scheduled consistent SQLite backups to a separate private location before production; include restore verification and recovery objectives. Blob soft deletion is enabled for seven days. Neither setting is a cross-region disaster-recovery plan.
- **Retention/privacy:** Obtain the organizer's photo consent/privacy policy, define event/image retention, and implement/schedule approved cleanup before public launch. Replaced and interrupted-upload blobs are not currently garbage-collected. There is no automated photo moderation or malware-scanning pipeline; the only review action currently supported is viewing submissions.
- **Rollback:** Redeploy the last known-good Git revision using the SWA token and App Service publish profile, not the fresh-provisioning wrapper. Check SQLite schema compatibility first and take a backup before migrations. Deleting an environment/resource group requires a separate explicit operator decision.
- **Remaining Azure gate:** Bicep compilation and local tests do not establish subscription permissions, regional quota/SKU availability, SWA-to-App-Service linking, managed-identity RBAC propagation, storage firewall routing, backup/restore readiness, or capacity. Verify these in a fresh isolated environment before declaring production-ready.
