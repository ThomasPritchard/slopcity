import test from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED_MILD, BLOCKED_STEMS, BLOCKED_TERMS } from '../shared/moderation-data.ts';
import { checkChat, foldCandidates, sanitizeChatBody } from '../shared/moderation.ts';

const allows = (body: string) => assert.deepEqual(checkChat(body), { ok: true });
const blocks = (body: string, reason: 'profanity' | 'url' = 'profanity') => assert.deepEqual(checkChat(body), { ok: false, reason });

const LEET: Record<string, string> = { a: '4', e: '3', i: '1', o: '0', s: '5', t: '7' };
const HOMOGLYPH: Record<string, string> = { a: '\u0430', c: '\u0441', e: '\u0435', i: '\u0456', o: '\u043e', p: '\u0440', t: '\u0442', x: '\u0445', y: '\u0443' };
const ACCENT: Record<string, string> = { a: '\u00e1', c: '\u0107', e: '\u00e9', i: '\u00ed', o: '\u00f3', u: '\u00fa' };
const map = (word: string, table: Record<string, string>) => [...word].map(char => table[char] ?? char).join('');

test('ordinary swearing and crude slang is permitted', () => {
  for (const body of ['fuck this', 'shit', 'bitch', 'you arsehole', 'this is bullshit', 'damn it', 'twat', 'wanker', 'that hurt like a bastard', 'stop being a dick']) allows(body);
  for (const word of ALLOWED_MILD) allows(word);
});

test('slurs, hate, severe sexual and shock content are rejected in plain spelling', () => {
  for (const body of ['nigger', 'chink', 'faggot', 'dyke', 'tranny', 'retard', 'you are retarded', 'nazi', 'white power',
    'swastika', 'rape', 'blowjob', 'child porn', 'bestiality', 'creampie', 'upskirt', 'how to kill', 'tubgirl',
    '2 girls 1 cup', 'goatse']) blocks(body);
});

test('every blocked category survives leetspeak, spacing, homoglyphs, accents and repeated letters', () => {
  const bases: readonly (readonly [string, string])[] = [
    ['racial slur', 'nigger'], ['racial slur', 'nigga'], ['ethnic slur', 'chink'], ['homophobic slur', 'faggot'],
    ['homophobic slur', 'fagot'], ['transphobic slur', 'tranny'], ['ableist slur', 'retard'], ['hate term', 'nazi'],
    ['hate term', 'white power'], ['hate term', 'swastika'], ['severe sexual', 'rape'], ['severe sexual', 'blowjob'],
    ['severe sexual', 'child porn'], ['severe sexual', 'bestiality'], ['violent or shock', 'tubgirl'],
    ['violent or shock', 'how to kill'], ['violent or shock', '2 girls 1 cup'],
  ];
  for (const [category, word] of bases) {
    assert.ok(category.length > 0);
    const forms = [word, map(word, LEET), [...word].join(' '), map(word, HOMOGLYPH), map(word, ACCENT), word.replace(/([a-z])/g, '$1$1$1')];
    for (const form of forms) blocks(form);
  }
});

test('links, obfuscated links and bare domains are rejected as urls', () => {
  const cases: readonly string[] = [
    'http://spam.example', 'https://foo.com/join', 'hxxp://foo.com', 'hxxps://foo.com', 'h*p: buy now',
    'www.foo.com', 'visit www . foo', 'foo[dot]com', 'foo(dot)com', 'foo{dot}com', 'foo[.]com', 'foo(.)com',
    'xn--80ak6aa92e.com', 'bit.ly/abc123', 'https://bit.ly/abc', 'tinyurl.com/xyz', 't.co/abc', 'goo.gl/abc',
    'is.gd/abc', 'cutt.ly/abc', 'rebrand.ly/abc', 'shorturl.at/abc', 'foo.com/path', 'spam.io', 'join.gg',
    'meet me at slopcity.app', 'nigger.com',
  ];
  for (const body of cases) blocks(body, 'url');
});

test('ordinary sentences pass', () => {
  for (const body of ['I love this song', 'meet at the fountain at 3', 'can we meet at the shop later', 'that outfit looks great',
    'the grapes are cheap', 'I need a therapist', 'sauerkraut and dumplings', 'few options left', 'we could go ok',
    'see you at the roulette table', 'I saved up 250 credits for the jacket', 'nice shot', 'scraped my knee at the bench',
    'see you at 3. bye', 'that is e.g. fine', 'ok.thanks', 'fingering the chords', 'grope for the light switch',
    'milfoil plants', 'diketone chemistry', 'the dikes held back the sea']) allows(body);
});

test('sanitizeChatBody strips invisibles, collapses space and clamps the body', () => {
  // Control characters are dropped, then whitespace runs collapse to one space.
  assert.equal(sanitizeChatBody('  hey  there \u0007 '), 'hey there');
  assert.equal(sanitizeChatBody('hey\u200b\tthere'), 'heythere');
  assert.equal(sanitizeChatBody('ｆｕｌｌｗｉｄｔｈ'), 'fullwidth');
  assert.equal(sanitizeChatBody('tag\u{e0001}ged'), 'tagged');
  assert.equal(sanitizeChatBody('a'.repeat(300)).length, 240);
  const emoji = sanitizeChatBody('🙂'.repeat(200));
  assert.equal(emoji.length, 240);
  assert.ok(!/[\ud800-\udbff]$/u.test(emoji));
});

test('foldCandidates exposes the folded, collapsed and de-spaced forms', () => {
  const leet = foldCandidates('N1gg3r');
  assert.ok(leet.includes('nigger') && leet.includes('niger') && leet.includes('nlgger'));
  assert.ok(foldCandidates('n\u0435gro').includes('negro'));
  assert.ok(foldCandidates('n i g g e r').includes('nigger'));
  const shout = foldCandidates('SHIT.');
  assert.ok(shout.includes('shit') && shout.includes('shit.'));
});

test('raw and non-string input stays safe', () => {
  assert.equal(sanitizeChatBody(null as unknown as string), '');
  assert.deepEqual(checkChat(undefined as unknown as string), { ok: true });
  blocks('NIGGER');
  blocks('ni\u200bgger');
});

test('every blocked entry is rejected and no permitted word matches', () => {
  for (const term of [...BLOCKED_TERMS, ...BLOCKED_STEMS]) blocks(term);
  for (const word of ALLOWED_MILD) allows(word);
  assert.equal(BLOCKED_TERMS.filter(term => ALLOWED_MILD.includes(term)).length, 0);
  assert.ok(BLOCKED_TERMS.length > 150 && BLOCKED_STEMS.length > 0 && ALLOWED_MILD.length > 40);
});
