# SnapTiles

Photo scavenger bingo with organizer-managed rooms and account-free participant boards. The application supports 3x3/5x5 grids, custom prompts, QR invitations, compressed direct image uploads, line/blackout wins, private-photo review, and room closure/reopening.

## Run Locally

Prerequisites: Node.js 24 LTS and npm. Azure Functions Core Tools is optional for testing the production Functions host; Azure CLI is only needed for infrastructure operations.

```powershell
npm ci
npm run dev
```

Open http://127.0.0.1:5173 for participants or http://127.0.0.1:5173/admin for organizers. The local API binds to `127.0.0.1:7071`. If either port is in use, stop the conflicting process or adjust both the dev-server configuration and the Playwright configuration. Vite otherwise automatically offers the next available frontend port.

The local server provides a visibly marked organizer identity and uses a JSON database and private image files in `api/.local/`. It does not connect to Azure or create Azure resources. Never expose it to the internet or use it in production. It refuses to run with `NODE_ENV=production` or in an Azure App Service host. The Azure Functions entry point has no local-auth bypass.

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
| `api/src/functions.ts` | Production Azure Functions v4 adapter                                      |
| `api/src/local.ts`     | Loopback-only local adapter with disk persistence                          |
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

After reviewing the what-if and costs, rerun with the same arguments plus `-Provision`. The script requests confirmation before provisioning. All resources are in a newly created SnapTiles resource group; it never deletes failed deployments automatically. SWA defaults to the Free SKU; Cosmos serverless requests/storage, Blob capacity/operations/egress, and optional SWA Standard incur usage or plan charges. A deployment preview is not a pricing estimate. Set subscription budgets/alerts in Azure before launch.

The template creates SWA, a private HTTPS-only storage account/container, and serverless Cosmos DB with `games` (`/id`), `players` (`/gameId`), `prompts` (`/category`), and `rateLimits` (`/id`, 120-second TTL). Room codes are part of the game ID, making joins point reads instead of cross-partition queries. The built-in prompt library is used when the prompts container is empty.

Secrets are generated/resolved inside deployment and written only to SWA application settings. Outputs contain only the app URL and resource names. The API requires `COSMOS_CONNECTION_STRING`, `STORAGE_ACCOUNT_NAME`, `STORAGE_ACCOUNT_KEY`, and `SESSION_SECRET`; it fails initialization when settings are absent. Do not copy secrets into the frontend, Git, chat, logs, or workflow files.

## Publish and Authenticate

1. Provision the environment after approval. Keep the output app URL/resource names.
2. In the new SWA's Azure portal, securely obtain its deployment token and enter it directly in the repository's `production` GitHub environment secret `AZURE_STATIC_WEB_APPS_API_TOKEN`. Do not send the token through chat. Configure environment reviewers for deployment approval.
3. Run the manual **Deploy SnapTiles** GitHub workflow and select the existing GitHub environment for the target SWA. It validates/builds the workspace, packages the compiled API with production dependencies, and deploys to SWA. Cloud credentials and provisioning are not wired into CI.
4. SWA built-in Microsoft sign-in is used at `/.auth/login/aad?post_login_redirect_uri=/admin`. Invite organizers with the custom `admin` role through SWA Role Management. Built-in sign-in alone never grants organizer access. The API also verifies the role and game ownership.
5. Test sign-in, role assignment, room creation, direct Blob uploads, private image display, and closure on the deployed SWA URL. These Azure integration checks cannot be replaced by local tests.

Use SWA's managed API integration, which supplies the trusted `x-ms-client-principal` header. Do not expose this API through an independent public Functions endpoint that accepts caller-supplied principal headers. If switching to a standalone backend, add platform token validation/access restrictions before deployment.

SWA preview environments are disabled by the template so production databases and photos are not accidentally shared with previews. Provision an isolated staging environment and use a separate deployment token for staging releases. For custom domains, add that exact origin to Blob CORS before testing uploads. No wildcard production CORS is used.

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
| POST      | `/api/public/uploads/sas`                     | Participant; one tile's five-minute create-only SAS   |
| POST      | `/api/public/submit-tile`                     | Participant; verify blob, replace tile, evaluate win  |

Participant endpoints use `x-participant-token`. JWTs are signed with HS256, restricted issuer/audience, and a 12-hour expiry. Game/player identity comes only from the verified claims. Submissions validate JPEG signatures, MIME type, size (5 MB maximum after compression), blob ownership, tile bounds, and active room status. Each upload has a fresh blob name; create-only SAS permissions prevent overwriting a previously verified blob. Replacement changes the tile record and never increases its count. Optimistic concurrency prevents simultaneous submissions from losing another tile update.

Photos stay private. Boards/review receive ten-minute read SAS URLs; participant boards refresh every 30 seconds and review refreshes every five minutes. Images selected in an already-open review dialog may need reopening after URL expiry. SAS URLs are bearer credentials: do not log/share them. SAS signing currently uses an account key (service SAS), not managed-identity user delegation. Account keys/connection strings must be rotated as described below.

Public requests use distributed Cosmos counters (90/minute per session/client and 600/minute globally), with hashed client/session identifiers and two-minute TTL. The local HTTP adapter has an additional 180/minute source-IP limit. Tune these limits for expected event size; they are application abuse controls, not a substitute for Azure edge/WAF protection.

## Operations and Release Gates

- **Rotation:** Generate a new strong session secret through a secure operator workflow and replace the SWA setting; existing participant tokens immediately become invalid. Rotate storage keys in stages using the unused key, update SWA settings, verify uploads/reads, then rotate the previously active key. Update Cosmos connection strings in SWA when rotating Cosmos keys. Never print values to logs.
- **Monitoring:** Functions emits operation path, status, and duration, without request bodies, tokens, or photo URLs. Set up Azure monitoring, error alerts, request/RU/egress budgets, and an event-size load test before public launch. Application Insights retention/export is not provisioned by this starter template.
- **Backups:** Cosmos uses periodic backups (four-hour interval, 24-hour retention); Blob soft deletion is enabled for seven days. These settings are not a cross-region disaster-recovery strategy. Validate a restore exercise and agree on recovery objectives before production.
- **Retention/privacy:** Obtain the organizer's photo consent/privacy policy, define event/image retention, and implement/schedule approved cleanup before public launch. Replaced and interrupted-upload blobs are not currently garbage-collected. There is no automated photo moderation or malware-scanning pipeline; the only review action currently supported is viewing submissions.
- **Rollback:** Redeploy the last known-good Git revision to the same SWA using its environment token, not the fresh-provisioning wrapper. Check data compatibility first; no destructive migrations are included. Keep Cosmos/Blob data intact during application rollback. Deleting an environment/resource group requires a separate explicit operator decision.
- **Remaining Azure gate:** Bicep compilation and local workflow tests do not establish subscription permissions, regional quota/SKU availability, production identity behavior, actual Azure Blob CORS/SAS behavior, monitoring readiness, or capacity. Verify these against an approved newly provisioned environment before declaring production-ready.
