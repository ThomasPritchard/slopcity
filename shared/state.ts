import { schema, t, type SchemaType } from '@colyseus/schema';

export const Citizen = schema({
  profileId: t.string().default(''), seatId: t.string().default(''),
  top: t.string().default('starter-utility'), bottoms: t.string().default('starter-chinos'), shoes: t.string().default('starter-sneakers'),
  name: t.string().default(''), x: t.float32().default(0), z: t.float32().default(-17),
  heading: t.float32().default(0), moving: t.boolean().default(false),
  sprinting: t.boolean().default(false), jumpAt: t.number().default(0),
  emoteId: t.string().default(''), emoteKind: t.string().default(''), emoteRole: t.uint8().default(0), emoteAt: t.number().default(0),
  shirt: t.uint8().default(0), skin: t.uint8().default(0), wave: t.number().default(0), ack: t.number().default(-1),
}, 'Citizen');
export type Citizen = SchemaType<typeof Citizen>;
export const TownState = schema({ players: t.map(Citizen) }, 'TownState');
export type TownState = SchemaType<typeof TownState>;
