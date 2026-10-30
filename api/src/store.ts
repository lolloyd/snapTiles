import { CosmosClient } from "@azure/cosmos";
import { JSONFilePreset } from "lowdb/node";
import { mkdir } from "node:fs/promises";
import type { Game, Player, Prompt } from "../../shared/domain.js";
import { presetPrompts } from "../../shared/domain.js";

export interface VersionedPlayer {
  player: Player;
  version: string;
}
export interface Store {
  getGame(id: string): Promise<Game | undefined>;
  createGame(game: Game): Promise<void>;
  listGames(adminId: string): Promise<Game[]>;
  updateGame(game: Game): Promise<void>;
  createPlayer(player: Player): Promise<void>;
  getPlayer(
    gameId: string,
    playerId: string,
  ): Promise<VersionedPlayer | undefined>;
  savePlayer(player: Player, version: string): Promise<boolean>;
  listPlayers(
    gameId: string,
    cursor?: string,
  ): Promise<{ players: Player[]; cursor?: string }>;
  prompts(): Promise<Prompt[]>;
  consumeRate(key: string, limit: number): Promise<boolean>;
}

export async function localStore(directory: string): Promise<Store> {
  await mkdir(directory, { recursive: true });
  const db = await JSONFilePreset<{
    games: Game[];
    players: (Player & { revision: number })[];
  }>(`${directory}/data.json`, { games: [], players: [] });
  let pending = Promise.resolve();
  const rates = new Map<string, { count: number; expires: number }>();
  function write<T>(operation: () => T): Promise<T> {
    const next = pending.then(async () => {
      const result = operation();
      await db.write();
      return result;
    });
    pending = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
  return {
    async getGame(id) {
      return structuredClone(db.data.games.find((game) => game.id === id));
    },
    async createGame(game) {
      await write(() => {
        if (db.data.games.some((existing) => existing.id === game.id))
          throw Object.assign(new Error("Conflict"), { code: 409 });
        db.data.games.push(structuredClone(game));
      });
    },
    async listGames(adminId) {
      return structuredClone(
        db.data.games
          .filter((game) => game.adminId === adminId)
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      );
    },
    async updateGame(game) {
      await write(() => {
        db.data.games[
          db.data.games.findIndex((existing) => existing.id === game.id)
        ] = structuredClone(game);
      });
    },
    async createPlayer(player) {
      await write(() =>
        db.data.players.push({ ...structuredClone(player), revision: 1 }),
      );
    },
    async getPlayer(gameId, playerId) {
      const found = db.data.players.find(
        (player) => player.id === playerId && player.gameId === gameId,
      );
      return found
        ? { player: structuredClone(found), version: String(found.revision) }
        : undefined;
    },
    async savePlayer(player, version) {
      return write(() => {
        const index = db.data.players.findIndex(
          (existing) =>
            existing.id === player.id && existing.gameId === player.gameId,
        );
        if (index < 0 || String(db.data.players[index].revision) !== version)
          return false;
        db.data.players[index] = {
          ...structuredClone(player),
          revision: Number(version) + 1,
        };
        return true;
      });
    },
    async listPlayers(gameId, cursor) {
      const offset = Number(cursor || 0);
      const matches = db.data.players.filter(
        (player) => player.gameId === gameId,
      );
      return {
        players: structuredClone(matches.slice(offset, offset + 30)),
        cursor: offset + 30 < matches.length ? String(offset + 30) : undefined,
      };
    },
    async prompts() {
      return presetPrompts;
    },
    async consumeRate(key, limit) {
      for (const [bucket, value] of rates)
        if (value.expires < Date.now()) rates.delete(bucket);
      const current = rates.get(key) || {
        count: 0,
        expires: Date.now() + 120_000,
      };
      current.count++;
      rates.set(key, current);
      return current.count <= limit;
    },
  };
}

export function cosmosStore(connection: string): Store {
  const database = new CosmosClient(connection).database("snaptilesdb");
  const games = database.container("games");
  const players = database.container("players");
  return {
    async getGame(id) {
      return (await games.item(id, id).read<Game>()).resource;
    },
    async createGame(game) {
      await games.items.create(game);
    },
    async listGames(adminId) {
      return (
        await games.items
          .query<Game>({
            query:
              "SELECT * FROM c WHERE c.adminId = @admin ORDER BY c.createdAt DESC",
            parameters: [{ name: "@admin", value: adminId }],
          })
          .fetchAll()
      ).resources;
    },
    async updateGame(game) {
      await games.item(game.id, game.id).replace(game);
    },
    async createPlayer(player) {
      await players.items.create(player);
    },
    async getPlayer(gameId, playerId) {
      const result = await players.item(playerId, gameId).read<Player>();
      return result.resource
        ? { player: result.resource, version: result.etag! }
        : undefined;
    },
    async savePlayer(player, version) {
      try {
        await players
          .item(player.id, player.gameId)
          .replace(player, {
            accessCondition: { type: "IfMatch", condition: version },
          });
        return true;
      } catch (error) {
        if ((error as { code: number }).code === 412) return false;
        throw error;
      }
    },
    async listPlayers(gameId, cursor) {
      const result = await players.items
        .query<Player>(
          {
            query: "SELECT * FROM c WHERE c.gameId = @game",
            parameters: [{ name: "@game", value: gameId }],
          },
          { partitionKey: gameId, maxItemCount: 30, continuationToken: cursor },
        )
        .fetchNext();
      return { players: result.resources, cursor: result.continuationToken };
    },
    async prompts() {
      const result = await database
        .container("prompts")
        .items.query<Prompt>("SELECT * FROM c")
        .fetchAll();
      return result.resources.length ? result.resources : presetPrompts;
    },
    async consumeRate(key, limit) {
      const buckets = database.container("rateLimits");
      try {
        await buckets.items.create({ id: key, count: 1, ttl: 120 });
        return true;
      } catch (error) {
        if ((error as { code: number }).code !== 409) throw error;
      }
      const result = await buckets
        .item(key, key)
        .patch<{ id: string; count: number }>([
          { op: "incr", path: "/count", value: 1 },
        ]);
      return !!result.resource && result.resource.count <= limit;
    },
  };
}
