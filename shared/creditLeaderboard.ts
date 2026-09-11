export const CREDIT_LEADERBOARD_LIMIT = 10;
export const CREDIT_LEADERBOARD_REFRESH_MS = 30_000;
export type CreditLeaderboard = {
 updatedAt: number;
 entries: { rank: number; name: string; credits: number }[];
};

// Right foyer partition, above the dado and behind the reception desk.
export const CREDIT_BOARD = { x: 6.78, y: 2.76, z: 18.25, width: 3.8, height: 2.1 } as const;
export function nearCreditBoard(x: number, z: number) {
 return x > 0 && x < 6.8 && z > 14.5 && z < 20.7;
}
