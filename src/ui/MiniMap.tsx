import { TownMapGround } from './TownMapSvg';
import { MINIMAP_BEZEL_INNER, MINIMAP_BEZEL_OUTER, MINIMAP_DISC_RADIUS, MINIMAP_MARK_RADIUS, MINIMAP_PLAN_SHIFT_Y, MINIMAP_VIEW, clampToDial, dialPoint, dialPointFor, headingToMapRotation } from './minimapGeometry';
import type { PlayerView } from '../world/scene';

/* North is carried by the lime chevron, so the remaining seven ticks complete the eight compass
   points; the cardinals stay longer and brighter. */
const RIM_TICKS = [45, 90, 135, 180, 225, 270, 315];
/* Positions come from the pure geometry helper; rounding keeps the rendered attributes readable. */
const round = (value: number) => Math.round(value * 100) / 100;

/** Compact live minimap: a circular north-up dial with the same live positions as the full map modal.
    The plan is drawn from the fountain centre out, the local player is a heading-rotated arrow and
    anyone past the rim (the casino) rides the edge. Presentation only. */
export function MiniMap({ players, sessionId, pressed, onOpen }: { players: Map<string, PlayerView>; sessionId?: string | null; pressed?: boolean; onOpen: () => void }) {
  const neighbours = [...players.entries()].filter(([id]) => id !== sessionId)
    .map(([id, player]) => ({ id, ...clampToDial(dialPointFor(player.x, player.z), MINIMAP_MARK_RADIUS) }));
  const you = sessionId ? players.get(sessionId) : undefined;
  const youAt = you && clampToDial(dialPointFor(you.x, you.z), MINIMAP_MARK_RADIUS);
  const others = neighbours.length;
  return <button className="hud-minimap" title="Open the live town map" aria-label="Open the live town map" aria-pressed={pressed ?? false} onClick={onOpen}>
    <svg className="minimap-dial" viewBox={`${-MINIMAP_VIEW} ${-MINIMAP_VIEW} ${MINIMAP_VIEW * 2} ${MINIMAP_VIEW * 2}`} role="img" aria-label={`Live town map: you and ${others} ${others === 1 ? 'neighbour' : 'neighbours'}`}>
      <defs>
        <clipPath id="minimap-disc"><circle r={MINIMAP_DISC_RADIUS}/></clipPath>
        <radialGradient id="minimap-edge"><stop offset="62%" stopColor="rgba(12,28,22,0)"/><stop offset="100%" stopColor="rgba(12,28,22,.26)"/></radialGradient>
      </defs>
      <circle className="minimap-bezel" r={(MINIMAP_BEZEL_INNER + MINIMAP_BEZEL_OUTER) / 2} strokeWidth={MINIMAP_BEZEL_OUTER - MINIMAP_BEZEL_INNER}/>
      <g clipPath="url(#minimap-disc)">
        <rect className="minimap-outskirts" x={-MINIMAP_VIEW} y={-MINIMAP_VIEW} width={MINIMAP_VIEW * 2} height={MINIMAP_VIEW * 2}/>
        <g className="minimap-plan" transform={`translate(0 ${MINIMAP_PLAN_SHIFT_Y})`}><TownMapGround/></g>
        <circle className="minimap-shade" r={MINIMAP_DISC_RADIUS} fill="url(#minimap-edge)"/>
      </g>
      {RIM_TICKS.map(angle => {
        const cardinal = angle % 90 === 0;
        const inner = dialPoint(angle, MINIMAP_DISC_RADIUS + .7), outer = dialPoint(angle, MINIMAP_DISC_RADIUS + (cardinal ? 3.6 : 2.5));
        return <line key={angle} className={cardinal ? 'minimap-tick minimap-tick--cardinal' : 'minimap-tick'} x1={round(inner.x)} y1={round(inner.y)} x2={round(outer.x)} y2={round(outer.y)}/>;
      })}
      <circle className="minimap-rim" r={MINIMAP_DISC_RADIUS}/>
      <path className="minimap-north" d="M0-31L3-26.9L0-28.7L-3-26.9Z"/>
      {neighbours.map(dot => <circle key={dot.id} className="minimap-neighbour" cx={round(dot.x)} cy={round(dot.y)} r="1.15"/>)}
      {you && youAt && <path className="minimap-you" d="M0-4.1L2.8 3.1L0 1.3L-2.8 3.1Z" transform={`translate(${round(youAt.x)} ${round(youAt.y)}) rotate(${round(headingToMapRotation(you.heading))})`}/>}
    </svg>
    <span className="hud-minimap-n" aria-hidden="true">N</span>
  </button>;
}
