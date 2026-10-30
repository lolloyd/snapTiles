import Database from "better-sqlite3";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
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
  getPlayer(gameId: string, playerId: string): Promise<VersionedPlayer | undefined>;
  savePlayer(player: Player, version: string): Promise<boolean>;
  listPlayers(
    gameId: string,
    cursor?: string,
  ): Promise<{ players: Player[]; cursor?: string }>;
  prompts(): Promise<Prompt[]>;
  consumeRate(key: string, limit: number): Promise<boolean>;
  close?(): void;
}

export type SqliteStore = Store & { close(): void };

export function sqliteStore(databasePath: string): SqliteStore {
  if (databasePath !== ":memory:")
    mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new Database(databasePath);
  database.pragma("busy_timeout = 5000");
  database.pragma("journal_mode = DELETE");
  database.pragma("synchronous = FULL");
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      admin_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS games_by_admin ON games(admin_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS players (
      game_id TEXT NOT NULL,
      id TEXT NOT NULL,
      joined_at TEXT NOT NULL,
      revision INTEGER NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (game_id, id)
    );
    CREATE INDEX IF NOT EXISTS players_by_game ON players(game_id, joined_at, id);
    CREATE TABLE IF NOT EXISTS prompts (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      text TEXT NOT NULL,
      is_preset INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS prompts_by_category ON prompts(category, id);
    CREATE TABLE IF NOT EXISTS rate_limits (
      id TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);
  const seedPrompts = database.transaction(() => {
    const insert = database.prepare(
      "INSERT OR IGNORE INTO prompts (id, category, text, is_preset) VALUES (?, ?, ?, 1)",
    );
    for (const prompt of presetPrompts)
      insert.run(prompt.id, prompt.category, prompt.text);
  });
  seedPrompts();

  const readGame = database.prepare("SELECT payload FROM games WHERE id = ?");
  const readPlayer = database.prepare(
    "SELECT revision, payload FROM players WHERE game_id = ? AND id = ?",
  );
  const consumeBucket = database.transaction(
    (key: string, limit: number, now: number) => {
      const current = database
        .prepare("SELECT count, expires_at FROM rate_limits WHERE id = ?")
        .get(key) as { count: number; expires_at: number } | undefined;
      const expired = !current || current.expires_at <= now;
      const count = expired ? 1 : current.count + 1;
      database
        .prepare(
          `INSERT INTO rate_limits (id, count, expires_at) VALUES (?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET count = excluded.count, expires_at = excluded.expires_at`,
        )
        .run(key, count, expired ? now + 120_000 : current.expires_at);
      return count <= limit;
    },
  );
  let rateCleanupCounter = 0;

  return {
    async getGame(id) {
      const row = readGame.get(id) as { payload: string } | undefined;
      return row ? (JSON.parse(row.payload) as Game) : undefined;
    },
    async createGame(game) {
      try {
        database
          .prepare(
            "INSERT INTO games (id, admin_id, created_at, payload) VALUES (?, ?, ?, ?)",
          )
          .run(game.id, game.adminId, game.createdAt, JSON.stringify(game));
      } catch (error) {
        if ((error as { code?: string }).code === "SQLITE_CONSTRAINT_PRIMARYKEY")
          throw Object.assign(new Error("Room already exists."), { code: 409 });
        throw error;
      }
    },
    async listGames(adminId) {
      const rows = database
        .prepare(
          "SELECT payload FROM games WHERE admin_id = ? ORDER BY created_at DESC, id",
        )
        .all(adminId) as { payload: string }[];
      return rows.map((row) => JSON.parse(row.payload) as Game);
    },
    async updateGame(game) {
      database
        .prepare(
          "UPDATE games SET admin_id = ?, created_at = ?, payload = ? WHERE id = ?",
        )
        .run(game.adminId, game.createdAt, JSON.stringify(game), game.id);
    },
    async createPlayer(player) {
      database
        .prepare(
          "INSERT INTO players (game_id, id, joined_at, revision, payload) VALUES (?, ?, ?, 1, ?)",
        )
        .run(player.gameId, player.id, player.joinedAt, JSON.stringify(player));
    },
    async getPlayer(gameId, playerId) {
      const row = readPlayer.get(gameId, playerId) as
        | { revision: number; payload: string }
        | undefined;
      return row
        ? { player: JSON.parse(row.payload) as Player, version: String(row.revision) }
        : undefined;
    },
    async savePlayer(player, version) {
      const result = database
        .prepare(
          `UPDATE players SET revision = revision + 1, payload = ?
           WHERE game_id = ? AND id = ? AND revision = ?`,
        )
        .run(JSON.stringify(player), player.gameId, player.id, Number(version));
      return result.changes === 1;
    },
    async listPlayers(gameId, cursor) {
      const offset = Math.max(0, Number.isSafeInteger(Number(cursor)) ? Number(cursor) : 0);
      const rows = database
        .prepare(
          "SELECT payload FROM players WHERE game_id = ? ORDER BY joined_at, id LIMIT 30 OFFSET ?",
        )
        .all(gameId, offset) as { payload: string }[];
      const players = rows.map((row) => JSON.parse(row.payload) as Player);
      const hasMore =
        (database
          .prepare("SELECT COUNT(*) AS count FROM players WHERE game_id = ?")
          .get(gameId) as { count: number }).count >
        offset + players.length;
      return {
        players,
        cursor: hasMore ? String(offset + players.length) : undefined,
      };
    },
    async prompts() {
      const rows = database
        .prepare("SELECT id, category, text, is_preset FROM prompts ORDER BY category, id")
        .all() as { id: string; category: string; text: string; is_preset: number }[];
      return rows.map((row) => ({ ...row, isPreset: row.is_preset === 1 }));
    },
    async consumeRate(key, limit) {
      const now = Date.now();
      const allowed = consumeBucket.immediate(key, limit, now);
      if (++rateCleanupCounter % 256 === 0)
        database.prepare("DELETE FROM rate_limits WHERE expires_at <= ?").run(now);
      return allowed;
    },
    close() {
      database.close();
    },
  };
}

export async function localStore(
  directory: string,
  databasePath = path.join(directory, "data.sqlite"),
): Promise<Store> {
  await mkdir(directory, { recursive: true });
  const databaseAlreadyExisted = existsSync(databasePath);
  const legacyPath = path.join(directory, "data.json");
  const store = sqliteStore(databasePath);
  if (existsSync(legacyPath)) {
    try {
      const legacy = JSON.parse(await readFile(legacyPath, "utf8")) as {
        games?: Game[];
        players?: (Player & { revision?: number })[];
      };
      for (const game of legacy.games || [])
        if (!(await store.getGame(game.id))) await store.createGame(game);
      for (const { revision: _revision, ...player } of legacy.players || [])
        if (!(await store.getPlayer(player.gameId, player.id)))
          await store.createPlayer(player);
    } catch (error) {
      store.close();
      if (!databaseAlreadyExisted) rmSync(databasePath, { force: true });
      throw new Error("Could not import the existing local JSON database.", {
        cause: error,
      });
    }
  }
  return store;
}