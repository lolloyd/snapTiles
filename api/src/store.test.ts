import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { localStore, sqliteStore } from "./sqlite-store";
import type { Game, Player } from "../../shared/domain";

const directories: string[] = [];
const databases: ReturnType<typeof sqliteStore>[] = [];

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function openStore() {
  const directory = await mkdtemp(path.join(tmpdir(), "snaptiles-sqlite-"));
  directories.push(directory);
  const databasePath = path.join(directory, "data.sqlite");
  const store = sqliteStore(databasePath);
  databases.push(store);
  return { databasePath, store };
}

function sampleRecords() {
  const game: Game = {
    id: "game-ABC234",
    adminId: "organizer-1",
    title: "Team day",
    roomCode: "ABC234",
    gridSize: 3,
    status: "ACTIVE",
    winCondition: "LINE",
    promptSlots: [],
    createdAt: "2026-10-30T12:00:00.000Z",
  };
  const player: Player = {
    id: "player-1",
    gameId: game.id,
    displayName: "Alex",
    joinedAt: "2026-10-30T12:01:00.000Z",
    tiles: [],
    completedLines: 0,
    hasWon: false,
  };
  return { game, player };
}

describe("SQLite store", () => {
  it("persists games, players, prompt presets, and revisions after reopening", async () => {
    const { databasePath, store } = await openStore();
    const { game, player } = sampleRecords();
    await store.createGame(game);
    await store.createPlayer(player);
    const initial = await store.getPlayer(game.id, player.id);
    expect(initial?.version).toBe("1");
    expect(await store.savePlayer({ ...player, displayName: "Alex M." }, "1")).toBe(
      true,
    );

    store.close();
    databases.splice(databases.indexOf(store), 1);
    const reopened = sqliteStore(databasePath);
    databases.push(reopened);

    expect(await reopened.getGame(game.id)).toEqual(game);
    expect((await reopened.listGames(game.adminId)).map((item) => item.id)).toEqual([
      game.id,
    ]);
    expect((await reopened.getPlayer(game.id, player.id))?.player.displayName).toBe(
      "Alex M.",
    );
    expect((await reopened.getPlayer(game.id, player.id))?.version).toBe("2");
    expect((await reopened.prompts()).length).toBeGreaterThan(0);
  });

  it("uses atomic revisions and persistent rate-limit buckets", async () => {
    const { store } = await openStore();
    const { game, player } = sampleRecords();
    await store.createGame(game);
    await store.createPlayer(player);
    const initial = await store.getPlayer(game.id, player.id);
    expect(initial).toBeDefined();
    expect(await store.savePlayer({ ...player, displayName: "Updated" }, "1")).toBe(
      true,
    );
    expect(await store.savePlayer(player, "1")).toBe(false);

    const decisions = await Promise.all(
      Array.from({ length: 10 }, () => store.consumeRate("same-bucket", 3)),
    );
    expect(decisions.filter(Boolean)).toHaveLength(3);
    expect(decisions.filter((allowed) => !allowed)).toHaveLength(7);
    expect(await store.consumeRate("other-bucket", 1)).toBe(true);
  });

  it("pages players deterministically and rejects duplicate game IDs", async () => {
    const { store } = await openStore();
    const { game, player } = sampleRecords();
    await store.createGame(game);
    await expect(store.createGame(game)).rejects.toMatchObject({ code: 409 });
    for (let index = 0; index < 31; index++)
      await store.createPlayer({ ...player, id: `player-${index}` });

    const first = await store.listPlayers(game.id);
    const second = await store.listPlayers(game.id, first.cursor);
    expect(first.players).toHaveLength(30);
    expect(first.cursor).toBe("30");
    expect(second.players).toHaveLength(1);
    expect(second.cursor).toBeUndefined();
  });

  it("imports legacy local JSON data without modifying the source file", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "snaptiles-legacy-"));
    directories.push(directory);
    const { game, player } = sampleRecords();
    const legacy = {
      games: [game],
      players: [{ ...player, revision: 4 }],
    };
    const legacyPath = path.join(directory, "data.json");
    const source = JSON.stringify(legacy);
    sqliteStore(path.join(directory, "data.sqlite")).close();
    await writeFile(legacyPath, source);

    const store = await localStore(directory);
    databases.push(store as ReturnType<typeof sqliteStore>);

    expect(await store.getGame(game.id)).toEqual(game);
    expect(await store.getPlayer(game.id, player.id)).toMatchObject({ player });
    expect(await readFile(legacyPath, "utf8")).toBe(source);
  });
});