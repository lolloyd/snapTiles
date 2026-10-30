# SnapTiles Implementation Plan

## Purpose

Build SnapTiles as a mobile-friendly photo scavenger bingo application for event organizers and participants. Organizers authenticate and manage games; participants join with a room code and display name, submit photos to tiles, and see their progress without creating an account.

## Architecture

- **Web app:** Azure Static Web Apps Standard, with organizer pages under `/admin/*` and participant pages under `/play/*`.
- **API:** A Node.js 24 Express API on a single-instance Linux Azure App Service Basic B1 plan, linked to SWA as its API backend. SWA authentication and role data are forwarded to the API.
- **Database:** SQLite at `/home/data/snaptiles.sqlite` on the App Service persistent home share. Keep the API at one instance; migrate to a managed relational database before scaling horizontally.
- **Photo storage:** Private Azure Blob Storage container `snaptiles-uploads`. Browser uploads and reads are proxied through the API. App Service uses its managed identity over a VNet-integrated subnet; the storage firewall defaults to deny and allows only that subnet.
- **Organizer authentication:** SWA authentication backed by Microsoft Entra ID or another configured identity provider. Organizer authorization must be enforced by the API as well as by route configuration.
- **Participant authentication:** An opaque, signed, time-limited participant session token issued at join; no participant account is required.

## Core Data

### SQLite Tables

- `games`: primary key `id`, organizer ID, creation time, and serialized game data. Room code is part of the game ID for a point lookup.
- `players`: composite primary key `(gameId, id)`, join time, optimistic revision, and serialized player data.
- `prompts`: preset prompt ID, category, text, and preset flag; seeded from the shared prompt library.
- `rate_limits`: hashed request-bucket ID, count, and expiry time. Writes use SQLite transactions.

Game records contain title, unique room code, grid size (`3` or `5`), status, win condition (`LINE` or `BLACKOUT`), prompt slots, and creation time. A prompt slot has an index, prompt ID, and text shown to players.

Player records contain player ID, game ID, display name, join time, tile submissions, completed-line count, and win state. Each tile stores its index, prompt text, blob name, status, and update time. Selected prompt text is copied into each game at creation.

## API Contract

| Method | Path | Access | Responsibility |
| --- | --- | --- | --- |
| `POST` | `/api/games` | Organizer | Create a game, assign its grid and prompts, and return room details. |
| `GET` | `/api/prompts` | Organizer | List the preset prompt library. |
| `GET` | `/api/admin/games/:id/submissions` | Organizer | Retrieve player boards and submissions for review. |
| `POST` | `/api/public/join` | Public | Validate room code and display name, create a player, and issue a participant session. |
| `POST` | `/api/public/uploads/ticket` | Participant session | Issue a short-lived API upload ticket for one authorized tile. |
| `PUT`, `GET` | `/api/public/media/:blobName` | Signed media ticket | Proxy a validated photo write/read to private Blob Storage. |
| `POST` | `/api/public/submit-tile` | Participant session | Record a submitted photo and recalculate progress and win state. |

## Sprint Plan

Sprint length is assumed to be two weeks. Sequence and sprint length can be adjusted to the team's capacity; each sprint ends with a demonstrable, testable increment.

### Sprint 0: Foundation and Cloud Setup

**Goal:** Establish a deployable application skeleton and secure development configuration.

- Set up the React frontend, Express API, SQLite store, shared types, linting, and automated tests.
- Create SWA route/security configuration and link a Standard SWA to the App Service API backend.
- Provision an App Service Basic B1 plan, one Linux API app, SQLite persistent path, VNet integration subnet, and private Blob Storage with default-deny network rules.
- Configure managed-identity Blob access, organizer identity/roles, App Service settings, and isolated development/production environments.
- Add CI validation and a repeatable deployment path.

**Acceptance:** The SWA proxies `/api` to the linked App Service; organizer-only routes reject unauthenticated users; the API can persist to SQLite and reach Blob only through the allowed subnet; no secrets are committed.

### Sprint 1: Game Setup and Prompt Library

**Goal:** Let an authenticated organizer create a playable game.

- Implement the SQLite schema/store for games, players, presets, and rate-limit buckets; seed preset prompts.
- Build organizer game creation for title, grid size (`3x3` or `5x5`), win condition, and prompt selection.
- Validate prompt count and unique tile indices; generate a collision-resistant room code and persist the game as active.
- Implement `POST /api/games` and `GET /api/prompts`, enforcing organizer identity and ownership.
- Build the organizer setup view with the room code and a shareable participant URL/QR code.

**Acceptance:** An authorized organizer can create a valid game, see its room code and participant link, and retrieve it after reload. Invalid grid or prompt configurations are rejected by the API.

### Sprint 2: Participant Join and Game Board

**Goal:** Let participants join a game and see their own board.

- Implement room lookup and `POST /api/public/join` with input validation and player creation.
- Issue a signed participant session with an explicit expiry; store only the minimum session data required by the client.
- Build the mobile-first join flow and board view, including prompt text and tile states.
- Handle unknown/inactive rooms, duplicate submissions, and network errors with clear recovery paths.

**Acceptance:** A participant can join an active game using its room code and display name, then see the correct board on a phone-sized viewport. Inactive or unknown room codes do not create players.

### Sprint 3: Photo Upload, Tile Submission, and Win Rules

**Goal:** Complete the participant photo submission loop.

- Add client-side image resizing/compression with sensible file type, size, and error handling.
- Implement `POST /api/public/uploads/ticket` to validate the participant session and authorize exactly one game/player/tile blob path.
- Proxy compressed JPEG writes through the API to private Blob Storage using managed identity; serve reads through short-lived, API-scoped media tokens.
- Implement `POST /api/public/submit-tile` to validate tile bounds and ownership, confirm the blob belongs to the expected path, and persist the tile state.
- Implement and unit-test line and blackout win evaluation for 3x3 and 5x5 boards.
- Make tile submissions idempotent or define a deliberate replacement policy to prevent retries from corrupting board state.

**Acceptance:** A participant can upload a compressed image and complete a tile without direct browser access to Blob; unauthorized players cannot upload or read another player's media. The board updates from persisted state, and win evaluation passes coverage for rows, columns, both diagonals, blackout, and incomplete boards.

### Sprint 4: Organizer Review and Game Operations

**Goal:** Give organizers visibility into participation and submissions.

- Implement `GET /api/admin/games/:id/submissions` with game ownership checks and paginated results.
- Build organizer review screens for player boards, photos, submission status, and progress.
- Add game lifecycle controls, at minimum active/closed status, and ensure closed games cannot accept new joins or submissions.
- Add operational errors and audit events for game creation, closure, and submission review actions.

**Acceptance:** Only the owning organizer can review or close a game. Results are usable for games with multiple players, and closed games consistently reject new activity.

### Sprint 5: Hardening, Production Deployment, and Launch

**Goal:** Verify production readiness and release the end-to-end experience.

- Apply and test API authorization, participant token expiry, signature comparison, request validation, rate limits, and safe error responses.
- Confirm storage remains private and default-deny; validate managed-identity access from the App Service subnet and API-proxied photo reads/writes.
- Configure production App Service, persistent SQLite path, storage/VNet rules, SWA Standard linked backend, identity roles, application settings, and deployment workflow.
- Keep App Service at one instance; document a migration plan from SQLite before any scale-out or high-concurrency launch.
- Run integration and end-to-end checks for organizer setup, QR join, photo upload, tile completion, win state, review, and game closure.
- Document deployment, secret rotation, backup/recovery expectations, and basic monitoring/alerting.

**Acceptance:** Production settings contain no source-controlled secrets; end-to-end flows pass in a production-like environment; private photo access, token expiry, role enforcement, and closed-game behavior are verified; deployment and rollback steps are documented.

## Security and Design Decisions

- Never use a fallback participant-session secret in deployed environments. Fail startup/configuration checks if required secrets are absent, and rotate secrets through managed settings.
- Enforce session expiry and validate token structure, game/player relationship, and tile bounds on every participant API call. Compare signatures using a timing-safe comparison.
- Blob access is server-side only through App Service managed identity. Storage uses default-deny network rules and allows the delegated App Service subnet only.
- SQLite runs on the App Service persistent home share with full synchronous writes and rollback-journal locking. Keep one API instance; do not enable scale-out.
- Keep the blob container private. The `publicBlobUrl` in the initial proposal is not sufficient for reading content from a private container; use a read authorization flow or another explicit media-access design.
- Validate authorization in API handlers; SWA route rules are an additional layer, not a substitute for API checks.
- Treat room codes as discoverable identifiers, not credentials. Apply rate limits and avoid exposing player data through room lookup.
- Browser media requests are same-origin through SWA `/api`; Blob CORS is not used.
- Configure a tested SQLite backup/restore process before production. App Service persistent storage is not itself a backup or disaster-recovery strategy.

## Deployment Resources

Production resources from the source plan:

- Resource group: `rg-snaptiles-prod-{deploymentId}`
- Region: `eastus2`
- Static Web App: `swa-snaptiles-prod-{suffix}` (Standard)
- App Service plan: `asp-snaptiles-prod-{suffix}` (Basic B1, one instance)
- App Service API: `api-snaptiles-prod-{suffix}` (Node 24, VNet integrated)
- Virtual network/subnet: `vnet-snaptiles-prod-{suffix}` / `api-integration` with Microsoft.Storage service endpoint
- Storage account: `stsnap{suffix}` (network default deny; shared-key auth disabled)
- Blob container: `snaptiles-uploads` (private)
- SQLite database: `/home/data/snaptiles.sqlite` on App Service persistent home storage; no Cosmos DB resources

Provision equivalent isolated development resources before production. Keep the generated session secret, SWA deployment token, and App Service publish profile in environment-specific secure settings; never put values in this document, source control, client bundles, or logs. Link the App Service API to SWA before deploying the API package. SWA Standard and App Service Basic incur recurring charges; Blob capacity, transactions, and egress are usage-billed.

## Open Decisions

- Confirm sprint length, team capacity, and whether the organizer identity provider is Microsoft Entra ID only or includes social login.
- Agree on the expected single-instance SQLite capacity and the trigger/plan for migration to a managed relational database.
- Decide whether participants may replace submitted photos and whether organizers can moderate or remove them.
- Define image retention and deletion policy, participant consent/privacy copy, and maximum upload size.
- Define SQLite backup scheduling, retention, and restore validation before production.