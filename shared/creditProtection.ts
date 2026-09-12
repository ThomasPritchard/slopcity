export const GIFT_FARM_RULE = {
 version: 'salary-cluster-v1',
 minimumSenders: 5,
 creationWindowMs: 120_000,
 giftWindowMs: 120_000,
 maximumProfileAgeMs: 30 * 60_000,
 minimumSalaryPercent: 80,
} as const;

export interface GiftFarmSignal {
 senderId: string;
 profileCreatedAt: number;
 giftedAt: number;
 salaryEarned: number;
 salarySentToRecipient: number;
 hasOtherActivity: boolean;
}

/** Every signal is required. Generosity, a name or repeated gifts alone is insufficient. */
export function giftFarmSenders(signals: readonly GiftFarmSignal[], now: number): string[] {
 const qualifying = signals.filter(s => !s.hasOtherActivity && s.salaryEarned > 0
  && s.giftedAt >= s.profileCreatedAt && s.giftedAt - s.profileCreatedAt <= GIFT_FARM_RULE.maximumProfileAgeMs
  && s.giftedAt <= now && now - s.giftedAt <= GIFT_FARM_RULE.giftWindowMs
  && s.salarySentToRecipient * 100 >= s.salaryEarned * GIFT_FARM_RULE.minimumSalaryPercent
 );
 const eligible = [...new Map(qualifying.map(s => [s.senderId,s])).values()].sort((a,b)=>a.profileCreatedAt-b.profileCreatedAt);
 const matched = new Set<string>();
 for (let start = 0; start < eligible.length; start++) {
  const group = new Set<string>();
  for (let end = start; end < eligible.length && eligible[end].profileCreatedAt - eligible[start].profileCreatedAt <= GIFT_FARM_RULE.creationWindowMs; end++) group.add(eligible[end].senderId);
  if (group.size >= GIFT_FARM_RULE.minimumSenders) for (const id of group) matched.add(id);
 }
 return [...matched].sort();
}

export interface CreditNotice {
 id: string;
 revision: number;
 activityStartedAt: number;
 activityEndedAt: number;
 credits: number;
 balanceResetTo: number | null;
}
export interface CreditNoticeSnapshot { notices: CreditNotice[] }
export interface CreditNoticeAcknowledgement { id: string; revision: number }

const activityDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });
export function creditActivityDates(start: number, end: number): string {
 const first = activityDate.format(start), last = activityDate.format(end);
 return first === last ? first : `${first} – ${last}`;
}
