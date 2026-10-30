# SnapTiles Implementation Plan

## Purpose

Build SnapTiles as a mobile-friendly photo scavenger bingo application for event organizers and participants. Organizers authenticate and manage games; participants join with a room code and display name, submit photos to tiles, and see their progress without creating an account.

## Architecture

- **Web app:** Azure Static Web Apps (SWA), with organizer pages under `/admin/*` and participant pages under `/play/*`.
- **API:** Azure Functions v4, hosted with SWA.
- **Database:** Azure Cosmos DB for NoSQL, using a `snaptilesdb` database and `games`, `players`, and `prompts` containers.
- **Photo storage:** Private Azure Blob Storage container `snaptiles-uploads`. The browser uploads compressed images directly with short-lived, narrowly scoped SAS URLs.
- **Organizer authentication:** SWA authentication backed by Microsoft Entra ID or another configured identity provider. Organizer authorization must be enforced by the API as well as by route configuration.
- **Participant authentication:** An opaque, signed, time-limited participant session token issued at join; no participant account is required.

## Core Data

### Games (`games`, partition key `/id`)

Store the game ID, organizer identity, title, unique room code, grid size (`3` or `5`), status, win condition (`LINE` or `BLACKOUT`), prompt slots, and creation time. A prompt slot has an index, prompt ID, and the text presented to players.

### Players (`players`, partition key `/gameId`)

Store the player ID, game ID, display name, join time, tile submissions, completed-line count, and win state. Each tile submission has an index, prompt text, blob reference, status, and update time.

### Prompts (`prompts`, partition key `/category`)

Store prompt ID, category, text, and whether the prompt is a preset. The initial game configuration copies selected prompt text into its slots so later library edits do not change an active game.

## API Contract

| Method | Path | Access | Responsibility |
| --- | --- | --- | --- |
| `POST` | `/api/games` | Organizer | Create a game, assign its grid and prompts, and return room details. |
| `GET` | `/api/prompts` | Organizer | List the preset prompt library. |
| `GET` | `/api/admin/games/:id/submissions` | Organizer | Retrieve player boards and submissions for review. |
| `POST` | `/api/public/join` | Public | Validate room code and display name, create a player, and issue a participant session. |
| `POST` | `/api/public/uploads/sas` | Participant session | Issue a short-lived SAS for one authorized game's player and tile. |
| `POST` | `/api/public/submit-tile` | Participant session | Record a submitted photo and recalculate progress and win state. |

## Sprint Plan

Sprint length is assumed to be two weeks. Sequence and sprint length can be adjusted to the team's capacity; each sprint ends with a demonstrable, testable increment.

### Sprint 0: Foundation and Cloud Setup

**Goal:** Establish a deployable application skeleton and secure development configuration.

- Set up the frontend and Azure Functions v4 API projects, shared types, linting, and automated tests.
- Create the SWA configuration for app routes, API routes, and SPA navigation fallback.
- Provision development Cosmos DB and Blob Storage resources; establish separate development and production settings.
- Configure organizer identity and role assignment, CORS for the specific app origins, and secret storage through SWA application settings or an approved secret store.
- Add CI validation and a repeatable deployment path.

**Acceptance:** A minimal app and API deploy to a development SWA environment; organizer-only routes reject unauthenticated users; no secrets are committed; database and storage connectivity are verified.

### Sprint 1: Game Setup and Prompt Library

**Goal:** Let an authenticated organizer create a playable game.

- Implement the `games` and `prompts` data access layer and seed initial preset prompts.
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
- Implement `POST /api/public/uploads/sas` to validate the participant session and authorize exactly one game/player/tile blob path.
- Upload directly to the private blob container using a short-lived, write-only SAS and narrowly configured Blob CORS.
- Implement `POST /api/public/submit-tile` to validate tile bounds and ownership, confirm the blob belongs to the expected path, and persist the tile state.
- Implement and unit-test line and blackout win evaluation for 3x3 and 5x5 boards.
- Make tile submissions idempotent or define a deliberate replacement policy to prevent retries from corrupting board state.

**Acceptance:** A participant can upload a compressed image and complete a tile; unauthorized players cannot request a SAS or submit another player's tile. The board updates from persisted state, and win evaluation passes coverage for rows, columns, both diagonals, blackout, and incomplete boards.

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
- Confirm storage remains private; verify the participant experience can display photos using an intentional access strategy (for example, short-lived read SAS URLs). Do not rely on a public blob URL for a private container.
- Configure production Cosmos DB, storage, SWA, identity provider, application settings, and deployment workflow.
- Review Cosmos DB partitioning and room-code lookup costs; add an appropriate lookup design/index if cross-partition lookup is not acceptable.
- Run integration and end-to-end checks for organizer setup, QR join, photo upload, tile completion, win state, review, and game closure.
- Document deployment, secret rotation, backup/recovery expectations, and basic monitoring/alerting.

**Acceptance:** Production settings contain no source-controlled secrets; end-to-end flows pass in a production-like environment; private photo access, token expiry, role enforcement, and closed-game behavior are verified; deployment and rollback steps are documented.

## Security and Design Decisions

- Never use a fallback participant-session secret in deployed environments. Fail startup/configuration checks if required secrets are absent, and rotate secrets through managed settings.
- Enforce session expiry and validate token structure, game/player relationship, and tile bounds on every participant API call. Compare signatures using a timing-safe comparison.
- A SAS must be short-lived, scoped to a single blob, and limited to the required write permissions. Validate upload content and size before accepting a tile submission.
- Keep the blob container private. The `publicBlobUrl` in the initial proposal is not sufficient for reading content from a private container; use a read authorization flow or another explicit media-access design.
- Validate authorization in API handlers; SWA route rules are an additional layer, not a substitute for API checks.
- Treat room codes as discoverable identifiers, not credentials. Apply rate limits and avoid exposing player data through room lookup.
- Use explicit CORS origins per environment instead of `*` in production.
- The example Cosmos DB players partition key `/gameId` supports player lookups by game; room-code lookup in `games` may be cross-partition. Confirm the expected scale and use an indexed/lookup strategy where needed.

## Deployment Resources

Production resources from the source plan:

- Resource group: `rg-snaptiles-prod`
- Region: `eastus2`
- Storage account: `stsnaptilesuploads`
- Cosmos DB account: `cosmos-snaptiles-prod` (serverless)
- Static Web App: `swa-snaptiles-prod`
- Blob container: `snaptiles-uploads` (private)
- Cosmos DB database: `snaptilesdb`; containers: `games` (`/id`), `players` (`/gameId`), and `prompts` (`/category`)

Provision equivalent isolated development resources before production. Keep connection strings, storage keys, session secrets, and SWA deployment credentials in environment-specific secret settings; never put real values in this document, source control, or client bundles. The original CLI runbook should be adapted to the repository's deployment workflow and reviewed before production execution.

## Open Decisions

- Confirm sprint length, team capacity, and whether the organizer identity provider is Microsoft Entra ID only or includes social login.
- Choose the production Cosmos DB room-code lookup strategy and expected game/player scale.
- Decide whether participants may replace submitted photos and whether organizers can moderate or remove them.
- Define image retention and deletion policy, participant consent/privacy copy, and maximum upload size.
- Select the approach for serving private photos to participant boards and organizer review.