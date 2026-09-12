import { createHash } from 'node:crypto';
import express, { type Application, type Request, type Response, type NextFunction } from 'express';
import type { AccountEntryResult, AccountStatus } from '../shared/account.ts';
import type { AdmissionService } from './admission.ts';
import type { AccountMailer } from './accountMail.ts';
import { clientAddress, networkKey } from './clientAddress.ts';
import { RequestLimiter } from './communityAuth.ts';
import { authenticateGuest, COOKIE_NAME, guestCookie, isAllowedOrigin, parseGuestCookie } from './guest.ts';
import { AccountError, normalizeAccountEmail, type AccountRepository } from './persistence/accounts.ts';
import { validProfileId, type GuestRepository } from './persistence/guests.ts';
import { SafetyError, type SafetyService } from './safety.ts';

export function mountAccountRoutes(app: Application, guests: GuestRepository, accounts: AccountRepository, mailer: AccountMailer, admission: AdmissionService, safety?: SafetyService) {
 const router = express.Router();
 const requests = new RequestLimiter(60, 60_000), emailNetwork = new RequestLimiter(10, 15 * 60_000),
  emailAddress = new RequestLimiter(3, 15 * 60_000), emailProfile = new RequestLimiter(3, 15 * 60_000),
  emailGlobal = new RequestLimiter(100, 60 * 60_000);
 const entryProfile = new RequestLimiter(5, 60_000);
 type EntryOutcome = { generation: number; result: AccountEntryResult };
 const entries = new Map<string, { fingerprint: string; expires: number; settled: boolean; issued: boolean; outcome: Promise<EntryOutcome> }>();
 const digest = (value: string) => createHash('sha256').update(value).digest('hex');
 function emailQuotaAvailable(email: string, profileId?: string) {
  return emailAddress.canTake(digest(email)) && (!profileId || emailProfile.canTake(profileId));
 }
 function takeEmailQuota(email: string, profileId?: string) {
  // Check and charge together after verification, with no await between the counters.
  if (!emailQuotaAvailable(email, profileId)) return false;
  return emailAddress.take(digest(email)) && (!profileId || emailProfile.take(profileId));
 }
 router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (!['GET','HEAD'].includes(req.method) && !isAllowedOrigin(req.headers.origin)) throw new AccountError('origin', 'Origin not allowed.', 403);
  const ip = clientAddress(req.headers) ?? (safety ? null : req.socket.remoteAddress);
  if (!ip) throw new AccountError('gateway_unavailable', 'Game gateway unavailable.', 503);
  safety?.checkBan(ip);
  if (!requests.take(networkKey(ip))) throw new AccountError('limited', 'Too many account requests. Please wait a minute.', 429);
  res.locals.ip = ip;
  next();
 });
 router.use(express.json({ limit: '4kb' }));
 router.get('/', async (req, res) => {
  const profile = await authenticateGuest(req.headers.cookie, guests);
  if (profile) safety?.checkProfile(res.locals.ip, profile);
  const status: AccountStatus = {
   profileId: profile?.id ?? null,
   ...(profile ? await accounts.status(profile.id) : { kind: 'none' as const, email: null }),
   emailEnabled: mailer.enabled,
   challenge: { enabled: admission.enabled, siteKey: admission.config.siteKey },
  };
  res.json(status);
 });
 router.post('/entry', async (req, res) => {
  const body = req.body, cookie = req.headers.cookie, ip = res.locals.ip as string;
  if (!body || !validProfileId(body.requestId) || !validProfileId(body.expectedProfileId) || !['guest', 'save'].includes(body.choice)) throw new AccountError('invalid_entry', 'Please open the entry panel again.', 400);
  const email = body.choice === 'save' ? normalizeAccountEmail(typeof body.email === 'string' ? body.email : '') : '';
  async function currentGuest() {
   const profile = await authenticateGuest(cookie, guests);
   if (!profile) throw new AccountError('session_required', 'Your guest session has ended. Please reload.', 401);
   if (profile.id !== body.expectedProfileId) throw new AccountError('session_changed', 'Your profile changed. Please reload before joining.');
   safety?.checkBan(ip); safety?.checkProfile(ip, profile); admission.checkMode(profile.id);
   if ((await accounts.status(profile.id)).kind !== 'guest') throw new AccountError('session_changed', 'Your profile changed. Please reload before joining.');
   return profile;
  }
  const profile = await currentGuest();
  const key = `${profile.id}:${digest(parseGuestCookie(cookie)!)}:${body.requestId}`;
  const fingerprint = digest(JSON.stringify([body.choice, email]));
  for (const [id, entry] of entries) if (entry.settled && entry.expires <= Date.now()) entries.delete(id);
  let entry = entries.get(key);
  if (entry && entry.fingerprint !== fingerprint) throw new AccountError('request_conflict', 'This entry request changed. Please complete a fresh check.');
  if (!entry) {
   if (!entryProfile.take(profile.id)) throw new AccountError('limited', 'Too many entry attempts. Please wait a minute.', 429);
   if (entries.size >= 512) throw new AccountError('entry_busy', 'Entry is busy. Please try again shortly.', 503);
   // Coalesce simultaneous requests before awaiting verification or sending email.
   const operation = async (): Promise<EntryOutcome> => {
    let emailStatus: AccountEntryResult['emailStatus'] = 'not_requested', message: string | null = null;
    const sendEmail = body.choice === 'save' && mailer.enabled && emailNetwork.take(networkKey(ip));
    const generation = await admission.verify(body.turnstileToken, ip, 'account_entry');
    await currentGuest();
    if (body.choice === 'save') {
     emailStatus = !mailer.enabled ? 'unavailable' : !sendEmail || !takeEmailQuota(email, profile.id) || !emailGlobal.take('all') ? 'limited' : 'sent';
     if (emailStatus === 'sent') {
      let link: Awaited<ReturnType<AccountRepository['issue']>> = null;
      try {
       link = await accounts.issue('upgrade', email, parseGuestCookie(cookie)!);
       if (link) await mailer.send(link);
      } catch {
       emailStatus = 'unavailable';
       // A delivery failure must not turn a verified entry into another check.
       if (link) await accounts.cancel(link.token).catch(() => {});
      }
     }
     message = emailStatus === 'sent'
      ? 'Check your email when you are ready to save your progress. The link expires in 15 minutes.'
      : emailStatus === 'limited'
       ? 'Email requests are busy. You can keep playing and save your progress from Settings later.'
       : 'The email could not be sent. You can keep playing and save your progress from Settings later.';
    }
    return { generation, result: { profileId: profile.id, emailStatus, message } };
   };
   entry = { fingerprint, expires: 0, settled: false, issued: false, outcome: operation() };
   entries.set(key, entry);
   const saved = entry;
   void entry.outcome.then(() => { saved.settled = true; saved.expires = Date.now() + 5 * 60_000; }, () => { entries.delete(key); });
  }
  const outcome = await entry.outcome;
  await currentGuest();
  // A retry may recover the response, but cannot mint another consumed grant.
  if (entry.issued) {
   if (admission.enabled && !admission.status(profile.id, cookie).verified) throw new SafetyError(403, 'verification_required', 'Please complete a fresh entry check.');
  } else {
   admission.issue(profile.id, cookie, outcome.generation);
   entry.issued = true;
  }
  res.json(outcome.result);
 });
 for (const purpose of ['upgrade','signin'] as const) router.post(`/${purpose}`, async (req, res) => {
  if (!mailer.enabled) throw new AccountError('email_unavailable', 'Email accounts are not configured yet.', 503);
  if (typeof req.body?.email !== 'string') throw new AccountError('invalid_email', 'Enter a valid email address.', 400);
  const email = normalizeAccountEmail(req.body.email);
  const profile = await authenticateGuest(req.headers.cookie, guests);
  if (purpose === 'upgrade' && !profile) throw new AccountError('session_required', 'Create or restore your guest profile first.', 401);
  if (profile) safety?.checkProfile(res.locals.ip, profile);
  if (purpose === 'upgrade' && (await accounts.status(profile!.id)).kind === 'member') throw new AccountError('already_member', 'This profile already has an email account.');
  // Failed checks spend only the requester's network allowance, never the recipient's quota.
  if (!emailNetwork.take(networkKey(res.locals.ip)) || !emailQuotaAvailable(email, profile?.id)) throw new AccountError('limited', 'Too many email requests. Please wait 15 minutes.', 429);
  await admission.verify(req.body.turnstileToken, res.locals.ip, 'account_email');
  if (!takeEmailQuota(email, profile?.id)) throw new AccountError('limited', 'Too many email requests. Please wait 15 minutes.', 429);
  if (!emailGlobal.take('all')) throw new AccountError('limited', 'Email sign-in is busy. Please try later.', 429);
  const link = await accounts.issue(purpose, email, parseGuestCookie(req.headers.cookie) ?? undefined);
  if (link) {
   try { await mailer.send(link); }
   catch {
    await accounts.cancel(link.token);
    throw new AccountError('email_unavailable', 'The email could not be sent. Please request a new link shortly.', 503);
   }
  }
  res.status(202).json({ message: 'If this email can be used, a link will arrive shortly. It expires in 15 minutes.' });
 });
 router.post('/inspect', async (req, res) => {
  res.json(await accounts.inspect(req.body?.token, parseGuestCookie(req.headers.cookie)));
 });
 router.post('/confirm', async (req, res) => {
  const body = req.body;
  if (!body || !(body.expectedCurrentProfileId === null || validProfileId(body.expectedCurrentProfileId)) || typeof body.confirmProfileSwitch !== 'boolean') throw new AccountError('invalid_confirmation', 'Open the email link again before confirming.', 400);
  const result = await accounts.confirm(body.token, parseGuestCookie(req.headers.cookie), body.expectedCurrentProfileId, body.confirmProfileSwitch, (id, name) => safety?.checkProfile(res.locals.ip, { id, name }));
  admission.invalidateProfiles(result.previousProfileIds);
  res.setHeader('Set-Cookie', guestCookie(result.secret, req.headers.origin?.startsWith('https:')));
  res.json({ profileId: result.profileId });
 });
 router.post('/logout', async (req, res) => {
  const secret = parseGuestCookie(req.headers.cookie);
  const profileId = secret ? await accounts.logout(secret) : null;
  if (profileId) admission.invalidateProfiles([profileId]);
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/game; HttpOnly; SameSite=Strict; Max-Age=0${req.headers.origin?.startsWith('https:') ? '; Secure' : ''}`);
  res.sendStatus(204);
 });
 router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof AccountError || error instanceof SafetyError) {
   if (error.status === 429) res.setHeader('Retry-After', '900');
   res.status(error.status).json({ code: error instanceof AccountError ? error.code : error.codeName, error: error.message });
   return;
  }
  const status = (error as { status?: number })?.status;
  res.status(status === 400 || status === 413 ? status : 503).json({ error: status === 413 ? 'Request too large.' : status === 400 ? 'Malformed JSON.' : 'Account service unavailable. Please try again shortly.' });
 });
 app.use('/api/account', router);
}
