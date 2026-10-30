import { describe, expect, it } from "vitest";
import { evaluateBingo } from "./domain";

describe.each([3, 5] as const)("%ix%i board rules", (gridSize) => {
  it("counts rows, columns, and both diagonals", () => {
    const lines = [
      Array.from({ length: gridSize }, (_, column) => column),
      Array.from({ length: gridSize }, (_, row) => row * gridSize),
      Array.from(
        { length: gridSize },
        (_, position) => position * (gridSize + 1),
      ),
      Array.from(
        { length: gridSize },
        (_, position) => (position + 1) * (gridSize - 1),
      ),
    ];
    for (const line of lines)
      expect(evaluateBingo(line, gridSize, "LINE")).toEqual({
        hasWon: true,
        completedLines: 1,
      });
  });
  it("does not count duplicates, invalid indices, or incomplete lines", () => {
    expect(
      evaluateBingo([0, 0, -1, 0.5, gridSize * gridSize, NaN], gridSize, "LINE")
        .hasWon,
    ).toBe(false);
    expect(evaluateBingo([0, 1], gridSize, "BLACKOUT").hasWon).toBe(false);
  });
  it("recognizes full boards and all their lines", () => {
    const full = Array.from(
      { length: gridSize * gridSize },
      (_, index) => index,
    );
    expect(evaluateBingo(full, gridSize, "BLACKOUT")).toEqual({
      hasWon: true,
      completedLines: 1,
    });
    expect(evaluateBingo(full, gridSize, "LINE").completedLines).toBe(
      gridSize * 2 + 2,
    );
    expect(evaluateBingo(full.slice(1), gridSize, "BLACKOUT").hasWon).toBe(
      false,
    );
  });
});
