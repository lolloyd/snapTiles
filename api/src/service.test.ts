import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAuth } from "./auth";
import { localStore } from "./sqlite-store";
import { createService } from "./service";
import type { Media } from "./media";
import type { Store } from "./sqlite-store";

const directories: string[] = [];
const stores: Store[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) store.close?.();
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function setup(local = true) {
  const directory = await mkdtemp(path.join(tmpdir(), "snaptiles-"));
  directories.push(directory);
  const auth = createAuth("test-secret-with-more-than-thirty-two-characters");
  const store = await localStore(directory);
  stores.push(store);
  const media: Media = {
    async ticket(blobName) {
      return { blobName, uploadUrl: `https://example.test/${blobName}` };
    },
    async validate() {},
    async readUrl(name) {
      return `https://example.test/${name}`;
    },
  };
  const service = createService(store, media, auth, local);
  async function call(
    route: string,
    method = "GET",
    body?: unknown,
    token?: string,
    principal?: string,
  ) {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (token) headers["x-participant-token"] = token;
    if (principal) headers["x-ms-client-principal"] = principal;
    const response = await service(
      new Request(`http://localhost/api/${route}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    return { status: response.status, body: await response.json() };
  }
  const gameInput = {
    title: "Team day",
    gridSize: 3,
    winCondition: "LINE",
    prompts: Array.from({ length: 9 }, (_, index) => `Prompt ${index}`),
  };
  return { call, auth, store, gameInput };
}

describe("game API", () => {
  it("creates, joins, uploads, wins, replaces, restores, and closes a game", async () => {
    const { call, gameInput } = await setup();
    const created = await call("games", "POST", gameInput);
    expect(created.status).toBe(200);
    const game = created.body.game;
    const joined = await call("public/join", "POST", {
      roomCode: game.roomCode.toLowerCase(),
      displayName: " Alex ",
    });
    expect(joined.body.game.adminId).toBeUndefined();
    expect(joined.body.player.displayName).toBe("Alex");
    const token = joined.body.participantToken;
    for (const tileIndex of [0, 1, 2]) {
      const ticket = await call(
        "public/uploads/ticket",
        "POST",
        { tileIndex },
        token,
      );
      expect(ticket.status).toBe(200);
      const submission = await call(
        "public/submit-tile",
        "POST",
        { tileIndex, blobName: ticket.body.blobName },
        token,
      );
      expect(submission.status).toBe(200);
      expect(submission.body.player.hasWon).toBe(tileIndex === 2);
      if (tileIndex === 2) {
        const retry = await call(
          "public/submit-tile",
          "POST",
          { tileIndex, blobName: ticket.body.blobName },
          token,
        );
        expect(retry.body.player.tiles.length).toBe(3);
      }
    }
    expect(
      (await call("public/session", "GET", undefined, token)).body.player
        .hasWon,
    ).toBe(true);
    expect(
      (await call(`admin/games/${game.id}/submissions`)).body.players.length,
    ).toBe(1);
    await call(`admin/games/${game.id}`, "PATCH", { status: "CLOSED" });
    expect(
      (
        await call("public/join", "POST", {
          roomCode: game.roomCode,
          displayName: "Late",
        })
      ).status,
    ).toBe(409);
    expect(
      (await call("public/uploads/ticket", "POST", { tileIndex: 3 }, token))
        .status,
    ).toBe(409);
  });
  it("rejects invalid boards, missing tokens, and cross-player blob references", async () => {
    const { call, gameInput } = await setup();
    expect(
      (await call("games", "POST", { ...gameInput, prompts: ["one"] })).status,
    ).toBe(400);
    expect((await call("public/session")).status).toBe(401);
    const game = (await call("games", "POST", gameInput)).body.game;
    const joined = (
      await call("public/join", "POST", {
        roomCode: game.roomCode,
        displayName: "Sam",
      })
    ).body;
    expect(
      (
        await call(
          "public/uploads/ticket",
          "POST",
          { tileIndex: 9 },
          joined.participantToken,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await call(
          "public/submit-tile",
          "POST",
          {
            tileIndex: 0,
            blobName: `${game.id}/player-other/tile-0-photo.jpg`,
          },
          joined.participantToken,
        )
      ).status,
    ).toBe(400);
  });
  it("enforces organizer roles and ownership in production mode", async () => {
    const { call, gameInput } = await setup(false);
    const principal = (userId: string, roles: string[]) =>
      Buffer.from(
        JSON.stringify({ userId, userDetails: `${userId}@example.com`, userRoles: roles }),
      ).toString("base64");
    const ownerPrincipal = Buffer.from(
      JSON.stringify({
        userId: "owner-id",
        userDetails: "Lloyd.Miguel@3cloudsolutions.com",
        userRoles: ["authenticated"],
      }),
    ).toString("base64");
    expect((await call("games")).status).toBe(401);
    expect(
      (
        await call(
          "games",
          "GET",
          undefined,
          undefined,
          principal("member", ["authenticated", "admin"]),
        )
      ).status,
    ).toBe(403);
    for (const email of ["owner@example.com", "other@example.com"])
      expect(
        (await call("admin/admins", "POST", { email }, undefined, ownerPrincipal))
          .status,
      ).toBe(200);
    const game = (
      await call(
        "games",
        "POST",
        gameInput,
        undefined,
        principal("owner", ["authenticated"]),
      )
    ).body.game;
    expect(
      (
        await call(
          `admin/games/${game.id}/submissions`,
          "GET",
          undefined,
          undefined,
          principal("other", ["authenticated"]),
        )
      ).status,
    ).toBe(403);
  });
  it("lets only owners manage admins and protects owners from removal", async () => {
    const { call } = await setup(false);
    const as = (email: string) =>
      Buffer.from(
        JSON.stringify({ userId: email, userDetails: email, userRoles: ["authenticated"] }),
      ).toString("base64");
    const owner = as("baron.paredes@3cloudsolutions.com");
    const admin = as("new.admin@example.com");

    expect((await call("admin/admins", "GET", undefined, undefined, admin)).status).toBe(403);
    expect(
      (await call("admin/admins", "POST", { email: "not-an-email" }, undefined, owner)).status,
    ).toBe(400);
    expect(
      (await call("admin/admins", "POST", { email: " New.Admin@Example.com " }, undefined, owner))
        .body.admins,
    ).toMatchObject([
      { email: "new.admin@example.com", addedBy: "baron.paredes@3cloudsolutions.com" },
    ]);
    expect(
      (await call("admin/admins", "POST", { email: "new.admin@example.com" }, undefined, owner))
        .status,
    ).toBe(409);
    expect((await call("me", "GET", undefined, undefined, admin)).body.user.roles).toEqual([
      "admin",
    ]);
    expect((await call("games", "GET", undefined, undefined, admin)).status).toBe(200);
    expect((await call("admin/admins", "GET", undefined, undefined, admin)).status).toBe(403);
    expect(
      (
        await call(
          `admin/admins/${encodeURIComponent("ronaldo.aquino@3cloudsolutions.com")}`,
          "DELETE",
          undefined,
          undefined,
          owner,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          `admin/admins/${encodeURIComponent("new.admin@example.com")}`,
          "DELETE",
          undefined,
          undefined,
          admin,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          `admin/admins/${encodeURIComponent("new.admin@example.com")}`,
          "DELETE",
          undefined,
          undefined,
          owner,
        )
      ).body.admins,
    ).toEqual([]);
    expect((await call("games", "GET", undefined, undefined, admin)).status).toBe(403);
    const listed = await call("admin/admins", "GET", undefined, undefined, owner);
    expect(listed.body.owners).toHaveLength(3);
  });
  it("rejects expired, altered, and wrong-audience sessions", async () => {
    const { auth } = await setup();
    await expect(
      auth.verify(
        await auth.sign({ gameId: "game-test" }, "participant", "-1s"),
      ),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      auth.verify(await auth.sign({}, "photo")),
    ).rejects.toMatchObject({ status: 401 });
    await expect(auth.verify("altered.token.signature")).rejects.toMatchObject({
      status: 401,
    });
  });
  it("limits requests without storing raw client identifiers", async () => {
    const { call } = await setup();
    for (let count = 0; count < 90; count++)
      expect((await call("public/session")).status).toBe(401);
    expect((await call("public/session")).status).toBe(429);
  });
});
