export const POKER_GEOMETRY = { width: 4.8, depth: 2.7, feltHeight: 1.10, railHeight: 1.20, cardHeight: 1.107, chipHeight: 1.115 } as const;
/** Clockwise from the south seat, looking toward the centre. Origins match the casino chair contact. */
export const POKER_SEAT_OFFSETS = [[0, -1.95], [-2.45, -1.1], [-2.45, 1.1], [0, 1.95], [2.45, 1.1], [2.45, -1.1]].map(([x, z]) => ({ x, z, heading: Math.atan2(-x, -z), exitX: x * 1.32, exitZ: z * 1.32 }));
export const pokerCardPosition = (seat: number, card: number) => {
  const p = POKER_SEAT_OFFSETS[seat], heading = p.heading, radius = seat === 0 || seat === 3 ? .46 : .62;
  return { x: p.x * radius + Math.cos(heading) * (card - .5) * .27, z: p.z * radius - Math.sin(heading) * (card - .5) * .27, heading };
};
