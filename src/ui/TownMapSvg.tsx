import type { PlayerView } from '../world/scene';
import { SHOP_BOUNDS, SHOP_LAYOUT } from '../../shared/shopLayout';

/** The town plan drawn north-up: casino north, clothing shop east, fountain centre. */
const TREES = [[-10, -4], [10, -4], [-10, 11], [10, 11]] as const;

/** The static town geometry (ground, roads, casino, shop, fountain, trees), shared by the full map
    modal and the circular HUD dial so both always describe the same town. */
export function TownMapGround() {
  return <>
    <rect x="-27" y="-27" width="54" height="54" rx="1" fill="#d9d3bd"/>
    <path d="M-4-26H4V26H-4ZM-26-1H26V5H-26Z" fill="#f2eedf"/>
    <rect x="-20" y="-56" width="40" height="42" fill="#687e6b"/>
    <rect x={SHOP_BOUNDS.front} y={-SHOP_BOUNDS.north} width={SHOP_LAYOUT.depth} height={SHOP_LAYOUT.width} fill="#a58f70"/>
    <circle cx="0" cy="-1" r="3.2" fill="#83aca5"/>
    {TREES.map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r="2" fill="#8a996b"/>)}
  </>;
}

/** The full map modal: the same town and the same live positions as the HUD dial, but labelled and
    at the plan's own aspect. Browser checks locate the local player through
    `.town-map circle[fill="#253d33"]`, so that circle and its cx/cy attributes stay here. */
export function TownMapSvg({ players, sessionId, labeled, ariaLabel }: { players: Map<string, PlayerView>; sessionId?: string | null; labeled?: boolean; ariaLabel: string }) {
  const shopCentre = (SHOP_BOUNDS.front + SHOP_BOUNDS.rear) / 2;
  return <svg className={labeled ? 'town-map' : 'town-map-plain'} viewBox={`-30 -59 ${SHOP_BOUNDS.rear + 34} 89`} role="img" aria-label={ariaLabel}>
    <TownMapGround/>
    {labeled && <><text x="0" y="-40" textAnchor="middle">CASINO</text><text x={shopCentre} y="1" textAnchor="middle" transform={`rotate(90 ${shopCentre} 1)`}>CLOTHING</text></>}
    {[...players.entries()].map(([id, p]) => <circle key={id} className={id === sessionId ? 'map-dot map-dot--you' : 'map-dot map-dot--neighbour'} cx={p.x} cy={-p.z} r={id === sessionId ? 1.1 : .6} fill={id === sessionId ? '#253d33' : '#9cab84'} stroke="#fff" strokeWidth=".25"/>)}
  </svg>;
}
