import type { CasinoCommand, CasinoTableView } from '../../shared/casino';
type SendCommand = CasinoCommand extends infer T ? T extends {requestId:string} ? Omit<T,'requestId'> : never : never;
export function effectiveDeadline(table: CasinoTableView) {
  const early = table.game==='slots' ? 0 : table.readiness?.deadline ?? 0;
  return early > 0 ? table.deadline > 0 ? Math.min(early,table.deadline) : early : table.deadline;
}
export function RoundReady({ table, profileId, eligible, busy, now, send }: {table:CasinoTableView;profileId:string;eligible:boolean;busy:boolean;now:number;send(command:SendCommand):void}) {
  if (table.game==='slots' || !eligible || !(table.game==='poker' ? table.phase==='waiting'||table.phase==='result' : table.phase==='betting')) return null;
  const readiness = table.readiness;
  const ready = readiness?.readyProfileIds.includes(profileId) ?? false;
  return <button type="button" className="casino-ready" disabled={busy||ready||(effectiveDeadline(table)>0&&now>=effectiveDeadline(table))} onClick={()=>send({action:'round-ready',tableId:table.id,roundId:table.roundId})}>{ready?'Ready ✓':'Ready'}<small>{readiness ? `${readiness.readyProfileIds.length}/${readiness.players} ready` : 'Start when all ready'}</small></button>;
}
