import { SEATS, SIT_REACH } from '../shared/social.ts';
import { isWalkable } from '../shared/world.ts';

export type SeatedCitizen = { seatId: string; x: number; z: number; heading: number };
export type SeatTransition = SeatedCitizen;

// Apply the result immediately in the room's synchronous message handler. The room
// remains the sole state owner: deleting a departing citizen also releases its seat.
export function requestSit(citizen: SeatedCitizen, requestedId: unknown, citizens: Iterable<SeatedCitizen>): SeatTransition | null {
  if (typeof requestedId !== 'string' || !Number.isFinite(citizen.x) || !Number.isFinite(citizen.z)) return null;
  const seat = SEATS.find(candidate => candidate.id === requestedId);
  if (!seat || (citizen.seatId && citizen.seatId !== seat.id)) return null;
  if (Math.hypot(citizen.x - seat.x, citizen.z - seat.z) > SIT_REACH) return null;
  for (const other of citizens) if (other !== citizen && other.seatId === seat.id) return null;
  return { seatId: seat.id, x: seat.x, z: seat.z, heading: seat.heading };
}

export function requestStand(citizen: SeatedCitizen): SeatTransition | null {
  if (!Number.isFinite(citizen.x) || !Number.isFinite(citizen.z) || !Number.isFinite(citizen.heading)) return null;
  if (!citizen.seatId) return { seatId: '', x: citizen.x, z: citizen.z, heading: citizen.heading };
  const seat = SEATS.find(candidate => candidate.id === citizen.seatId);
  if (!seat || !isWalkable(seat.exit.x, seat.exit.z)) return null;
  return { seatId: '', ...seat.exit, heading: seat.heading };
}
