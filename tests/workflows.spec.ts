import { expect, test } from "@playwright/test";

test("create, invite, join, upload a winning line, review, and close", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/admin/new");
  const title = `Team adventure ${Date.now()}`;
  await page.getByLabel("Event name").fill(title);
  await page.getByRole("button", { name: "Create event", exact: true }).click();
  const invite = page.getByRole("dialog", { name: "Invite your people" });
  await expect(invite).toBeVisible();
  const participantUrl = await page
    .getByLabel("Participant invite link")
    .inputValue();
  const reviewUrl = page.url().split("?")[0];
  await expect(page.locator(".qr-image")).toBeVisible();
  expect(
    await page
      .locator(".qr-image")
      .evaluate(
        (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
      ),
  ).toBe(true);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.goto(participantUrl);
  await page.getByLabel("Your name").fill("Alex M.");
  await page.getByRole("button", { name: "Join room", exact: true }).click();
  await expect(page.locator(".bingo-tile")).toHaveCount(9);
  const photo = await page.screenshot();
  for (const index of [0, 1, 2]) {
    await page.locator(".bingo-tile").nth(index).click();
    await page
      .getByLabel("Choose a photo")
      .setInputFiles({
        name: "moment.png",
        mimeType: "image/png",
        buffer: photo,
      });
    await expect(page.locator(".upload-preview")).toBeVisible();
    await page.getByRole("button", { name: "Save tile", exact: true }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(page.locator(".bingo-tile.filled")).toHaveCount(index + 1);
  }
  await expect(page.getByText("That's a bingo!")).toBeVisible();
  await page.reload();
  await expect(page.locator(".bingo-tile.filled")).toHaveCount(3);
  await expect(page.locator(".bingo-tile img").first()).toBeVisible();
  expect(
    await page
      .locator(".bingo-tile img")
      .first()
      .evaluate(
        (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
      ),
  ).toBe(true);
  const returning = await page.context().newPage();
  await returning.goto(participantUrl);
  await expect(returning.getByText("You're already playing in room")).toBeVisible();
  await returning.getByRole("link", { name: "Back to my board" }).click();
  await expect(returning.getByText("Hey, Alex M.")).toBeVisible();
  await expect(returning.locator(".bingo-tile.filled")).toHaveCount(3);
  await returning.close();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/board-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.goto(reviewUrl);
  await expect(page.locator(".player-card")).toHaveCount(1);
  await expect(page.locator(".player-card")).toContainText("Bingo!");
  await page.locator(".player-card").click();
  await expect(page.locator(".review-board img")).toHaveCount(3);
  const [card] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Player card" }).click(),
  ]);
  expect(card.suggestedFilename()).toMatch(/^Alex-M-[\w-]{6}-card\.png$/);
  const [photos] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Original photos" }).click(),
  ]);
  expect(photos.suggestedFilename()).toMatch(/-photos\.zip$/);
  await page.locator(".review-board .bingo-tile.filled").first().click();
  const [original] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download original" }).click(),
  ]);
  expect(original.suggestedFilename()).toMatch(/^01-.*\.jpg$/);
  await page.getByRole("button", { name: "Close dialog" }).last().click();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Close room", exact: true }).click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("button", { name: "Reopen room" })).toBeVisible();
  const [archive] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download all" }).click(),
  ]);
  expect(archive.suggestedFilename()).toMatch(/^snaptiles-[A-Z2-9]{6}\.zip$/);
  await page.goto("/play/board");
  await expect(
    page.getByText("This room has wrapped up. Your moments are still here."),
  ).toBeVisible();
  await expect(page.locator(".bingo-tile").nth(3)).toBeDisabled();
  await page.goto(participantUrl);
  await page.getByRole("button", { name: "Join as someone else" }).click();
  await page.getByLabel("Your name").fill("Too late");
  await page.getByRole("button", { name: "Join room", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("This room is closed.");
  expect(errors).toEqual([]);
});

test("customizes a 5x5 blackout board without horizontal overflow", async ({
  page,
}) => {
  await page.goto("/admin/new");
  await page
    .getByLabel("Event name")
    .fill("The big SnapTiles adventure with the whole team");
  await page.getByRole("radio", { name: "5 x 5", exact: true }).check();
  await page
    .getByRole("combobox", { name: "Win condition" })
    .selectOption("BLACKOUT");
  await page
    .getByLabel("Prompt 25", { exact: true })
    .fill("The final team victory photo");
  await page.getByRole("button", { name: "Create event", exact: true }).click();
  const participantUrl = await page
    .getByLabel("Participant invite link")
    .inputValue();
  await page.goto(participantUrl);
  await page.getByLabel("Your name").fill("Sam");
  await page.getByRole("button", { name: "Join room", exact: true }).click();
  await expect(page.locator(".bingo-tile")).toHaveCount(25);
  await expect(page.getByText("Fill the board to win")).toBeVisible();
  await expect(page.locator(".bingo-tile").last()).toContainText(
    "The final team victory photo",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/large-board-${test.info().project.name}.png`,
    fullPage: true,
  });
});
