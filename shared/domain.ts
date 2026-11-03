export type GridSize = 3 | 5;
export type WinCondition = "LINE" | "BLACKOUT";
export type GameStatus = "ACTIVE" | "CLOSED";

export interface Prompt {
  id: string;
  category: string;
  text: string;
  isPreset: boolean;
}

export interface PromptSlot {
  index: number;
  promptId: string;
  text: string;
}

export interface Game {
  id: string;
  adminId: string;
  title: string;
  description?: string;
  roomCode: string;
  gridSize: GridSize;
  status: GameStatus;
  winCondition: WinCondition;
  promptSlots: PromptSlot[];
  createdAt: string;
}

export type PublicGame = Omit<Game, "adminId">;

export interface Tile {
  index: number;
  promptText: string;
  blobName: string;
  status: "SUBMITTED";
  updatedAt: string;
  photoUrl?: string;
}

export interface Player {
  id: string;
  gameId: string;
  displayName: string;
  joinedAt: string;
  tiles: Tile[];
  completedLines: number;
  hasWon: boolean;
}

export interface Session {
  participantToken: string;
  game: PublicGame;
  player: Player;
}

export function publicGame(game: Game): PublicGame {
  const { adminId: _adminId, ...visible } = game;
  return visible;
}

export function evaluateBingo(
  indices: number[],
  gridSize: GridSize,
  winCondition: WinCondition,
) {
  const filled = new Set(
    indices.filter(
      (index) =>
        Number.isInteger(index) && index >= 0 && index < gridSize * gridSize,
    ),
  );
  if (winCondition === "BLACKOUT") {
    const hasWon = filled.size === gridSize * gridSize;
    return { hasWon, completedLines: hasWon ? 1 : 0 };
  }
  const lines: number[][] = [];
  for (let position = 0; position < gridSize; position++) {
    lines.push(
      Array.from(
        { length: gridSize },
        (_, column) => position * gridSize + column,
      ),
    );
    lines.push(
      Array.from({ length: gridSize }, (_, row) => row * gridSize + position),
    );
  }
  lines.push(
    Array.from(
      { length: gridSize },
      (_, position) => position * (gridSize + 1),
    ),
  );
  lines.push(
    Array.from(
      { length: gridSize },
      (_, position) => (position + 1) * (gridSize - 1),
    ),
  );
  const completedLines = lines.filter((line) =>
    line.every((index) => filled.has(index)),
  ).length;
  return { hasWon: completedLines > 0, completedLines };
}

export const presetPrompts: Prompt[] = [
  ["Social", "A group selfie with four people"],
  ["Discover", "Something bright yellow"],
  ["Social", "A high five with someone new"],
  ["Discover", "The best view from here"],
  ["Food", "Your favorite local snack"],
  ["Social", "Your most unexpected teammate"],
  ["Discover", "Something smaller than your thumb"],
  ["Social", "Your funniest face"],
  ["Discover", "A perfectly timed photo"],
  ["Nature", "An interesting leaf"],
  ["Discover", "Something with a story"],
  ["Social", "Someone wearing the same color"],
  ["Food", "A colorful drink"],
  ["Discover", "A reflection of yourself"],
  ["Nature", "A patch of blue sky"],
  ["Social", "A team victory pose"],
  ["Discover", "A circle hiding in plain sight"],
  ["Food", "A snack worth sharing"],
  ["Nature", "A flower in bloom"],
  ["Discover", "Something older than you"],
  ["Social", "A new friend waving hello"],
  ["Discover", "Your favorite detail of the venue"],
  ["Nature", "An interesting shadow"],
  ["Social", "A creative team handshake"],
  ["Discover", "Something that makes you smile"],
  ["Nature", "A tiny sign of nature"],
  ["Food", "The first bite"],
  ["Discover", "A surprising splash of red"],
  ["Social", "Everyone pointing the same way"],
  ["Discover", "An accidental work of art"],
].map(([category, text], index) => ({
  id: `preset-${index + 1}`,
  category,
  text,
  isPreset: true,
}));
