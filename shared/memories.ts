export const MEMORIES_BOARD = { x: -7, z: -5.5, width: 3.1, depth: .3, height: 3.15 } as const;
export const nearMemoriesBoard = (x: number, z: number) => Math.hypot(x - MEMORIES_BOARD.x, z - MEMORIES_BOARD.z) < 4 && z < MEMORIES_BOARD.z + .4;
export const FIRST_MEMORY = {
 image: '/community/first-memory.png',
 alt: 'A Slop City player meme: a worried-looking neighbour says “hello folks, looking for my parents” — orphan.',
 title: 'Our first meme.',
 welcome: 'v0.1 is here. Welcome to Slop City!',
 message: 'We’ve barely opened the gates and someone’s already made a meme. This is what Slop City is for: odd encounters, new friends and stories you’ll still be laughing about tomorrow.',
 invitation: 'Make a memory. Share a laugh. Make yourself at home.',
} as const;
