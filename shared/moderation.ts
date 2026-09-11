import { BLOCKED_STEMS, BLOCKED_TERMS } from './moderation-data.ts';

// Shared chat moderation: sanitation, link rejection and two-tier profanity matching.
export type ChatVerdict = { ok: true } | { ok: false; reason: 'profanity' | 'url' };

const MAX_CHAT = 240;
const INVISIBLE = /[\p{C}\u00ad\u200b-\u200f\u2028\u2029\u2060-\u2064]/gu;

export function sanitizeChatBody(raw: string): string {
  const text = (typeof raw === 'string' ? raw : '').normalize('NFKC').replace(INVISIBLE, '').replace(/\s+/gu, ' ').trim();
  if (text.length <= MAX_CHAT) return text;
  const last = text.charCodeAt(MAX_CHAT - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? MAX_CHAT - 1 : MAX_CHAT);
}

// Confusable letters that NFKD leaves alone, folded onto the Latin lookalike.
const HOMOGLYPHS: Record<string, string> = {
  '\u0430': 'a', '\u0432': 'b', '\u0435': 'e', '\u043a': 'k', '\u043c': 'm', '\u043d': 'h', '\u043e': 'o', '\u0440': 'p',
  '\u0441': 'c', '\u0442': 't', '\u0443': 'y', '\u0445': 'x', '\u0455': 's', '\u0456': 'i', '\u0458': 'j', '\u04bb': 'h',
  '\u0501': 'd', '\u051b': 'q', '\u051d': 'w', '\u03b1': 'a', '\u03b2': 'b', '\u03b5': 'e', '\u03b7': 'n', '\u03b9': 'i',
  '\u03ba': 'k', '\u03bc': 'm', '\u03bd': 'v', '\u03bf': 'o', '\u03c1': 'p', '\u03c3': 's', '\u03c4': 't', '\u03c5': 'u',
  '\u03c7': 'x', '\u03c9': 'w', '\u0131': 'i', '\u017f': 's', '\u00f8': 'o', '\u0111': 'd', '\u0127': 'h', '\u0142': 'l',
  '\u0261': 'g', '\u0274': 'n', '\u0280': 'r', '\u0299': 'b',
};
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };
const AMBIGUOUS: Record<string, readonly string[]> = { '1': ['i', 'l'] };
const VARIANT_LIMIT = 8;

function foldOptions(input: string): readonly (readonly string[])[] {
  const options: string[][] = [];
  for (const char of input.normalize('NFKD')) {
    const base = char.replace(/[\p{M}\p{C}]/gu, '').toLowerCase();
    for (const letter of base) options.push([...(AMBIGUOUS[letter] ?? [HOMOGLYPHS[letter] ?? LEET[letter] ?? letter])]);
  }
  return options;
}

function variants(options: readonly (readonly string[])[]): string[] {
  let forms = [''];
  for (const chars of options) {
    const next: string[] = [];
    for (const form of forms) for (const char of chars) if (next.length < VARIANT_LIMIT) next.push(form + char);
    forms = next.length ? next : [''];
  }
  return forms;
}

const collapseRuns = (value: string) => value.replace(/(.)\1+/gu, '$1');
const despace = (value: string) => value.replace(/[\s\-_*.\u00b7\u2010-\u2015]+/gu, '');

// Folded spellings of the input: case, diacritics, homoglyphs, leet, run-collapsed and de-spaced.
function foldedShapes(input: string): { plain: string[]; spaced: string[] } {
  const plain = new Set<string>(), spaced = new Set<string>();
  for (const form of variants(foldOptions(typeof input === 'string' ? input : ''))) {
    for (const shape of [form, collapseRuns(form)]) {
      if (!shape) continue;
      plain.add(shape);
      spaced.add(despace(shape));
    }
  }
  return { plain: [...plain], spaced: [...spaced] };
}

export function foldCandidates(input: string): string[] {
  const shapes = foldedShapes(input);
  return [...new Set([...shapes.plain, ...shapes.spaced])];
}

const escape = (char: string) => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const foldText = (value: string) => foldOptions(value).map(option => option[0]).join('');
// Runs of a repeated letter are tolerated, so the needle "nigger" still catches "niiiigger".
const pattern = (needle: string) => new RegExp(needle.split('').map(char => char === ' ' ? '\\s*' : `${escape(char)}+`).join(''));
// Needles shorter than four characters only match the unspaced forms. Squeezing the spaces out of a
// sentence collides with them far too easily: "of a good kind" would contain "fag", "few options" "wop".
const SPACED_FLOOR = 4;
// Plain substrings of these also fall inside innocent vocabulary ("grape", "therapist", "sauerkraut",
// "gobbledygook"), so they only match at the start of a word. Mid-sentence letter-spacing evasion of
// these particular words is not caught; every other spelling trick still is.
const WORD_START = new Set(['cumming', 'dyke', 'fag', 'gook', 'kraut', 'lesbo', 'nazi', 'rape', 'rapist', 'spastic', 'spick', 'throating', 'wop']);
// Whole-word-only needles: their substring would land inside innocent vocabulary at any position
// ("diketone", "milfoil"), so they additionally must end at a word boundary.
const WORD_END = new Set(['dike', 'milf']);
const SHORT_SOURCES = new Set<string>(), LONG_SOURCES = new Set<string>();
for (const term of new Set([...BLOCKED_TERMS, ...BLOCKED_STEMS])) {
  const folded = foldText(term), squeezed = despace(folded);
  const start = WORD_START.has(term) ? '(?:^|[^a-z])' : '';
  const end = WORD_END.has(term) ? '(?![a-z])' : '';
  if (squeezed.length < SPACED_FLOOR) SHORT_SOURCES.add(start + pattern(folded).source + end);
  else {
    LONG_SOURCES.add(start + pattern(folded).source + end);
    LONG_SOURCES.add(start + pattern(squeezed).source + end);
  }
}
const SHORT = [...SHORT_SOURCES].map(source => new RegExp(source));
const LONG = [...LONG_SOURCES].map(source => new RegExp(source));

export const containsSevereProfanity = (input: string) => {
  const shapes = foldedShapes(input);
  const hit = (needles: readonly RegExp[], forms: readonly string[]) => needles.some(word => forms.some(form => word.test(form)));
  return hit(LONG, shapes.plain) || hit(LONG, shapes.spaced) || hit(SHORT, shapes.plain);
};

const SHORTENERS = new Set(['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'is.gd', 'cutt.ly', 'rebrand.ly', 'shorturl.at', 'ow.ly', 'rb.gy', 'tiny.cc', 'buff.ly']);
const TLDS = new Set(['com', 'net', 'org', 'io', 'co', 'gg', 'me', 'tv', 'xyz', 'info', 'online', 'site', 'app', 'dev', 'link', 'club', 'top', 'uk', 'ca', 'de', 'fr', 'nl', 'es', 'it', 'pl', 'cn', 'jp', 'kr', 'tk', 'ml', 'ga', 'cf', 'pw', 'cc', 'biz', 'us', 'ru', 'eu', 'au', 'br', 'in', 'se', 'no', 'fi', 'dk', 'ch', 'at', 'be', 'cz', 'gr', 'pt', 'ro', 'hu', 'ie', 'nz', 'za', 'mx', 'ar', 'cl', 'shop', 'store', 'live', 'fun', 'wiki', 'blog', 'cloud', 'tech', 'world', 'today', 'space', 'pro', 'mobi', 'name', 'asia', 'ai', 'sh', 'ly', 'to', 'su', 'st', 'si', 'sk', 'lt', 'lv', 'ee', 'bg', 'hr', 'rs', 'ua', 'by', 'kz', 'my', 'sg', 'th', 'vn', 'id', 'ph', 'tw', 'hk', 'tr', 'il', 'ae']);
const HOSTNAME = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+([a-z]{2,})$/;
const DOT_TRICK = /\(\s*(?:dot|\.)\s*\)|\[\s*(?:dot|\.)\s*\]|\{\s*(?:dot|\.)\s*\}/gu;

const hasUrl = (body: string) => {
  const text = (typeof body === 'string' ? body : '').normalize('NFKC').toLowerCase().replace(DOT_TRICK, '.');
  if (/[a-z][a-z0-9+.-]*:\/\//.test(text)) return true;
  if (/(?:^|[^a-z0-9])h[xt*]{1,3}p{1,2}s?\s*[:：]/u.test(text)) return true;
  if (/(?:^|[^a-z0-9])www\s*\./u.test(text)) return true;
  if (/xn--/u.test(text)) return true;
  for (const raw of text.split(/[\s,;!?'"“”()<>]+/u)) {
    const host = raw.replace(/^[^a-z0-9]+/u, '').replace(/^[a-z][a-z0-9+.-]*:\/\//u, '').split(/[/?#]/u)[0].replace(/:\d+$/u, '');
    if (SHORTENERS.has(host)) return true;
    const match = HOSTNAME.exec(host);
    if (match && TLDS.has(match[1])) return true;
  }
  return false;
};

export function checkChat(body: string): ChatVerdict {
  const text = typeof body === 'string' ? body : '';
  if (hasUrl(text)) return { ok: false, reason: 'url' };
  return containsSevereProfanity(text) ? { ok: false, reason: 'profanity' } : { ok: true };
}

// Exact strings the town server sends as chat-moderation notices. The client maps them to local
// [SYSTEM] lines in the chat panel; keeping them here keeps server wording and client matching
// from drifting apart.
export const MODERATION_NOTICES = {
  profanity: "That word isn't welcome in Slop City chat.",
  url: "Links aren't allowed in Slop City chat yet.",
  flood: "You're sending messages too quickly.",
  repeat: "That's a repeat of your last message.",
} as const;
export type ModerationNoticeKey = keyof typeof MODERATION_NOTICES;
export function moderationNoticeKey(text: unknown): ModerationNoticeKey | null {
  if (typeof text !== 'string') return null;
  for (const [key, value] of Object.entries(MODERATION_NOTICES)) if (value === text) return key as ModerationNoticeKey;
  return null;
}
