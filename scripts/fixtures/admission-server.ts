export {};
// Isolated integration fixture. This file is not included in the server build.
// Only Siteverify is simulated; HTTP, persistence and game sockets are real.
if (process.env.NODE_ENV !== 'test' || process.env.HOST !== '127.0.0.1' || process.env.TURNSTILE_SECRET_KEY !== 'admission-test-secret' || !['localhost','127.0.0.1'].includes(new URL(process.env.DATABASE_URL!).hostname) || !new URL(process.env.DATABASE_URL!).searchParams.get('options')?.includes('admission_test_')) throw new Error('Admission fixture requires an isolated loopback test schema');
// A development opt-out must never turn the verification tests into bypass tests.
process.env.TURNSTILE_ENABLED = 'true';
const originalFetch = globalThis.fetch, used = new Set<string>();
globalThis.fetch = async (url,options) => {
 if (String(url) !== 'https://challenges.cloudflare.com/turnstile/v0/siteverify') return originalFetch(url,options);
 const value = JSON.parse(String(options?.body));
 const valid = typeof value.response === 'string' && value.response.startsWith('fixture-') && !used.has(value.response);
 used.add(value.response);
 return Response.json({success:valid,hostname:'localhost',action:'town_entry'});
};
await import('../../server/index.ts');
