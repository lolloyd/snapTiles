import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { evaluateBingo, publicGame } from "../../shared/domain.js";
import type { Game, Player } from "../../shared/domain.js";
import { ApiError, OWNER_EMAILS, isOwner, principal } from "./auth.js";
import type { Auth } from "./auth.js";
import type { Store } from "./sqlite-store.js";
import type { Media } from "./media.js";

const joinSchema = z
  .object({
    roomCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z2-9]{6}$/),
    displayName: z.string().trim().min(1).max(40),
  })
  .strict();
const gameSchema = z
  .object({
    title: z.string().trim().min(1).max(100),
    gridSize: z.union([z.literal(3), z.literal(5)]),
    winCondition: z.enum(["LINE", "BLACKOUT"]),
    prompts: z.array(z.string().trim().min(1).max(140)).max(25),
  })
  .strict();
const tileSchema = z
  .object({ tileIndex: z.number().int().min(0).max(24) })
  .strict();
const submitSchema = tileSchema.extend({
  blobName: z.string().min(1).max(250),
});
const statusSchema = z
  .object({ status: z.enum(["ACTIVE", "CLOSED"]) })
  .strict();
const adminSchema = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  })
  .strict();
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const roomCode = () =>
  Array.from(randomBytes(6), (value) => alphabet[value % alphabet.length]).join(
    "",
  );

export function createService(
  store: Store,
  media: Media,
  auth: Auth,
  local = false,
) {
  async function roles(email: string) {
    if (local || isOwner(email)) return ["admin", "owner"];
    return (await store.isAdmin(email)) ? ["admin"] : [];
  }
  async function organizer(request: Request) {
    const user = principal(request.headers, local);
    if (!(await roles(user.email)).includes("admin"))
      throw new ApiError(403, "An organizer role is required.");
    return user.userId;
  }
  function owner(request: Request) {
    const user = principal(request.headers, local);
    if (!local && !isOwner(user.email))
      throw new ApiError(403, "Only owners can manage admins.");
    return user;
  }
  async function gameById(id: string) {
    const game = await store.getGame(id);
    if (!game) throw new ApiError(404, "Room not found.");
    return game;
  }
  function active(game: Game) {
    if (game.status !== "ACTIVE")
      throw new ApiError(409, "This room is closed.");
  }
  async function owned(id: string, adminId: string) {
    const game = await gameById(id);
    if (game.adminId !== adminId)
      throw new ApiError(403, "This room belongs to another organizer.");
    return game;
  }
  async function participant(request: Request) {
    const claims = await auth.verify(
      request.headers.get("x-participant-token"),
    );
    if (
      typeof claims.gameId !== "string" ||
      typeof claims.playerId !== "string"
    )
      throw new ApiError(401, "Invalid participant session.");
    const game = await gameById(claims.gameId);
    const record = await store.getPlayer(game.id, claims.playerId);
    if (!record)
      throw new ApiError(401, "This player session no longer exists.");
    return { game, ...record };
  }
  async function visiblePlayer(player: Player) {
    return {
      ...player,
      tiles: await Promise.all(
        player.tiles.map(async (tile) => ({
          ...tile,
          photoUrl: await media.readUrl(tile.blobName),
        })),
      ),
    };
  }
  async function body(request: Request) {
    const text = await request.text();
    if (text.length > 32_768) throw new ApiError(413, "Request is too large.");
    try {
      return JSON.parse(text);
    } catch {
      throw new ApiError(400, "Send a valid JSON request.");
    }
  }
  async function route(request: Request): Promise<unknown> {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/$/, "");
    const method = request.method;
    if (pathname.startsWith("/api/public/")) {
      const minute = Math.floor(Date.now() / 60_000);
      const subject =
        request.headers.get("x-participant-token") ||
        request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
        "anonymous";
      const key = createHash("sha256")
        .update(`${minute}:${subject}`)
        .digest("hex");
      if (
        !(await store.consumeRate(`global-${minute}`, 600)) ||
        !(await store.consumeRate(key, 90))
      )
        throw new ApiError(
          429,
          "Too many requests. Please try again in a minute.",
        );
    }
    if (pathname === "/api/health" && method === "GET")
      return { status: "ok", mode: local ? "local" : "azure" };
    if (pathname === "/api/me" && method === "GET") {
      if (local)
        return {
          user: { name: "Local organizer", roles: await roles("") },
          local: true,
        };
      try {
        const user = principal(request.headers, false);
        return {
          user: { name: user.email, roles: await roles(user.email) },
          local: false,
        };
      } catch {
        return { user: null, local: false };
      }
    }
    if (pathname === "/api/admin/admins") {
      const user = owner(request);
      if (method === "GET")
        return { owners: OWNER_EMAILS, admins: await store.listAdmins() };
      if (method === "POST") {
        const { email } = adminSchema.parse(await body(request));
        if (isOwner(email))
          throw new ApiError(409, "This person is already an owner.");
        if (
          !(await store.addAdmin({
            email,
            addedBy: user.email,
            addedAt: new Date().toISOString(),
          }))
        )
          throw new ApiError(409, "This person is already an admin.");
        return { admins: await store.listAdmins() };
      }
    }
    const adminMatch = pathname.match(/^\/api\/admin\/admins\/([^/]{1,512})$/);
    if (adminMatch && method === "DELETE") {
      owner(request);
      let email: string;
      try {
        email = decodeURIComponent(adminMatch[1]).trim().toLowerCase();
      } catch {
        throw new ApiError(400, "Invalid email address.");
      }
      if (isOwner(email))
        throw new ApiError(403, "Owners cannot be removed.");
      if (!(await store.removeAdmin(email)))
        throw new ApiError(404, "Admin not found.");
      return { admins: await store.listAdmins() };
    }
    if (pathname === "/api/prompts" && method === "GET") {
      await organizer(request);
      return { prompts: await store.prompts() };
    }
    if (pathname === "/api/games") {
      const adminId = await organizer(request);
      if (method === "GET") return { games: await store.listGames(adminId) };
      if (method === "POST") {
        const input = gameSchema.parse(await body(request));
        if (input.prompts.length !== input.gridSize ** 2)
          throw new ApiError(400, "Provide one prompt for every tile.");
        for (let attempt = 0; attempt < 5; attempt++) {
          const code = roomCode();
          const game: Game = {
            id: `game-${code}`,
            adminId,
            title: input.title,
            roomCode: code,
            gridSize: input.gridSize,
            winCondition: input.winCondition,
            status: "ACTIVE",
            createdAt: new Date().toISOString(),
            promptSlots: input.prompts.map((text, index) => ({
              index,
              promptId: `custom-${index}`,
              text,
            })),
          };
          try {
            await store.createGame(game);
            return { game };
          } catch (error) {
            if ((error as { code: number }).code !== 409) throw error;
          }
        }
        throw new ApiError(
          503,
          "Could not allocate a room code. Please try again.",
        );
      }
    }
    const gameMatch = pathname.match(
      /^\/api\/admin\/games\/(game-[A-Z2-9]{6})(\/submissions)?$/,
    );
    if (gameMatch) {
      const game = await owned(gameMatch[1], await organizer(request));
      if (method === "PATCH" && !gameMatch[2]) {
        const { status } = statusSchema.parse(await body(request));
        const updated = { ...game, status };
        await store.updateGame(updated);
        return { game: updated };
      }
      if (method === "GET" && gameMatch[2]) {
        const cursor = url.searchParams.get("cursor") || undefined;
        if (cursor && cursor.length > 12_000)
          throw new ApiError(400, "Invalid page cursor.");
        const page = await store.listPlayers(game.id, cursor);
        return {
          game,
          players: await Promise.all(page.players.map(visiblePlayer)),
          cursor: page.cursor,
        };
      }
    }
    if (pathname === "/api/public/join" && method === "POST") {
      const input = joinSchema.parse(await body(request));
      const game = await gameById(`game-${input.roomCode}`);
      active(game);
      const player: Player = {
        id: `player-${randomUUID()}`,
        gameId: game.id,
        displayName: input.displayName,
        tiles: [],
        completedLines: 0,
        hasWon: false,
        joinedAt: new Date().toISOString(),
      };
      await store.createPlayer(player);
      return {
        game: publicGame(game),
        player,
        participantToken: await auth.sign({
          gameId: game.id,
          playerId: player.id,
        }),
      };
    }
    if (pathname === "/api/public/session" && method === "GET") {
      const { game, player } = await participant(request);
      return { game: publicGame(game), player: await visiblePlayer(player) };
    }
    if (pathname === "/api/public/uploads/ticket" && method === "POST") {
      const { game, player } = await participant(request);
      active(game);
      const { tileIndex } = tileSchema.parse(await body(request));
      if (tileIndex >= game.gridSize ** 2)
        throw new ApiError(400, "Tile is outside this board.");
      return media.ticket(
        `${game.id}/${player.id}/tile-${tileIndex}-${randomUUID()}.jpg`,
      );
    }
    if (pathname === "/api/public/submit-tile" && method === "POST") {
      const session = await participant(request);
      active(session.game);
      const { tileIndex, blobName } = submitSchema.parse(await body(request));
      if (
        tileIndex >= session.game.gridSize ** 2 ||
        !new RegExp(
          `^${session.game.id}/${session.player.id}/tile-${tileIndex}-[a-f0-9-]{36}\\.jpg$`,
        ).test(blobName)
      )
        throw new ApiError(
          400,
          "This photo does not belong to this player and tile.",
        );
      await media.validate(blobName);
      for (let attempt = 0; attempt < 5; attempt++) {
        const record = await store.getPlayer(
          session.game.id,
          session.player.id,
        );
        if (!record) throw new ApiError(401, "Player not found.");
        active(await gameById(session.game.id));
        const tiles = record.player.tiles.filter(
          (tile) => tile.index !== tileIndex,
        );
        tiles.push({
          index: tileIndex,
          blobName,
          promptText: session.game.promptSlots[tileIndex].text,
          status: "SUBMITTED",
          updatedAt: new Date().toISOString(),
        });
        const player = {
          ...record.player,
          tiles,
          ...evaluateBingo(
            tiles.map((tile) => tile.index),
            session.game.gridSize,
            session.game.winCondition,
          ),
        };
        if (await store.savePlayer(player, record.version))
          return { player: await visiblePlayer(player) };
      }
      throw new ApiError(
        409,
        "Your board changed. Please refresh and try again.",
      );
    }
    throw new ApiError(404, "Endpoint not found.");
  }
  return async (request: Request): Promise<Response> => {
    try {
      return Response.json(await route(request), {
        headers: {
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError)
        return Response.json(
          {
            error: "Check the request fields and try again.",
            details: error.issues.map((issue) => ({
              field: issue.path.join("."),
              message: issue.message,
            })),
          },
          { status: 400 },
        );
      if (error instanceof ApiError)
        return Response.json(
          { error: error.message },
          { status: error.status },
        );
      console.error(
        "API operation failed:",
        error instanceof Error ? error.name : "UnknownError",
      );
      return Response.json(
        { error: "Something went wrong. Please try again." },
        { status: 500 },
      );
    }
  };
}
