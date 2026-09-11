import express, { type Application, type Request, type Response, type NextFunction } from 'express';
import { parseProfile, SHIRTS, SKINS } from '../shared/world.ts';
import { GuestRepository, CREDENTIAL_SECONDS, validCredential, validProfileId } from './persistence/guests.ts';
import { clientAddress } from './clientAddress.ts';
import { SafetyError, type SafetyService } from './safety.ts';
export const COOKIE_NAME = 'slop_guest';
export function parseGuestCookie(header: string | undefined): string | null {
 const values = (header ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${COOKIE_NAME}=`));
 if (values.length !== 1) return null;
 const secret = values[0].slice(COOKIE_NAME.length + 1);
 return validCredential(secret) ? secret : null;
}
export function guestCookie(secret: string, secure = new URL(process.env.APP_ORIGIN ?? 'http://localhost:5173').protocol === 'https:'): string {
 if (!validCredential(secret)) throw new Error('Invalid guest credential');
 return `${COOKIE_NAME}=${secret}; Path=/game; HttpOnly; SameSite=Strict; Max-Age=${CREDENTIAL_SECONDS}${secure ? '; Secure' : ''}`;
}
export function isAllowedOrigin(origin: string | undefined): boolean {
 return !!origin && [process.env.APP_ORIGIN ?? 'http://localhost:5173', ...(process.env.APP_ORIGINS ?? '').split(',')].map(value => value.trim()).includes(origin);
}
export async function authenticateGuest(cookieHeader: string | undefined, repository: GuestRepository) {
 const secret = parseGuestCookie(cookieHeader);
 return secret ? repository.resolve(secret) : null;
}
export type ActiveGuest = { sessionId: string; roomId: string };
export class SessionRegistry {
 private active = new Map<string, ActiveGuest>();
 private editing = new Set<string>();
 private listeners = new Set<(profileId: string) => void | Promise<void>>();
 get(id: string) { const session = this.active.get(id); return session ? { ...session } : undefined; }
 claim(id: string, sessionId: string, roomId: string): boolean {
  if (this.active.has(id) || this.editing.has(id)) return false;
  this.active.set(id, { sessionId, roomId }); return true;
 }
 release(id: string, sessionId: string, roomId?: string): boolean {
  const current = this.active.get(id);
  if (!current || current.sessionId !== sessionId || (roomId !== undefined && current.roomId !== roomId)) return false;
  this.active.delete(id); return true;
 }
 beginEdit(id: string) { if (this.active.has(id) || this.editing.has(id)) return false; this.editing.add(id); return true; }
 endEdit(id: string) { this.editing.delete(id); }
 onBlocksChanged(listener: (profileId: string) => void | Promise<void>) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
 async notifyBlocksChanged(id: string) { await Promise.all([...this.listeners].map(listener => listener(id))); }
}
function validCosmetics(value: unknown): boolean {
 if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
 const v = value as Record<string, unknown>;
 return typeof v.name === 'string' && v.name.length <= 100 && typeof v.shirt === 'number' && Number.isInteger(v.shirt) && v.shirt >= 0 && v.shirt < SHIRTS.length && typeof v.skin === 'number' && Number.isInteger(v.skin) && v.skin >= 0 && v.skin < SKINS.length;
}
export function mountGuestRoutes(app: Application, repository: GuestRepository, sessions: SessionRegistry, safety?: SafetyService) {
 const router = express.Router();
 router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  if (['POST','PATCH','PUT','DELETE'].includes(req.method) && !isAllowedOrigin(req.headers.origin)) { res.status(403).json({ error: 'Origin not allowed' }); return; }
  next();
 });
 router.use(express.json({ limit: '8kb' }));
 router.post('/guest', async (req, res) => {
  const existing = await authenticateGuest(req.headers.cookie, repository);
  if (existing) { res.json(existing); return; }
  if (req.headers.cookie?.split(';').some(part => part.trim().startsWith(`${COOKIE_NAME}=`))) { res.status(401).json({ error: 'Guest credential expired or invalid' }); return; }
  if (!validCosmetics(req.body)) { res.status(400).json({ error: 'Invalid profile' }); return; }
  const ip=clientAddress(req.headers);
  if(safety){if(!ip)throw new SafetyError(503,'untrusted_proxy','Game gateway unavailable.');safety.checkBan(ip);safety.limit('guest',ip);}
  const created = await repository.create(parseProfile(req.body));
  safety?.record('guest_created',ip??undefined,created.profile.id);
  res.setHeader('Set-Cookie', guestCookie(created.secret, req.headers.origin?.startsWith('https:'))); res.status(201).json(created.profile);
 });
 router.use(async (req, res, next) => {
  const profile = await authenticateGuest(req.headers.cookie, repository);
  if (!profile) {
   // An expired credential must not trap the browser in a permanent failed entry loop.
   if (req.headers.cookie?.includes(`${COOKIE_NAME}=`)) res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/game; HttpOnly; SameSite=Strict; Max-Age=0`);
   res.status(401).json({ error: 'Guest authentication required' }); return;
  }
  res.locals.profile = profile; next();
 });
 router.get('/profile', (_req,res) => { res.json(res.locals.profile); });
 router.patch('/profile', async (req,res) => {
  if (!validCosmetics(req.body) || !Number.isSafeInteger(req.body.revision) || req.body.revision < 1) { res.status(400).json({ error: 'Invalid profile' }); return; }
  const id = res.locals.profile.id as string;
  if (!sessions.beginEdit(id)) { res.status(409).json({ error: 'Leave town before editing your profile' }); return; }
  try {
   const profile = await repository.update(id, parseProfile(req.body), req.body.revision);
   if (!profile) { res.status(409).json({ error: 'Profile changed; reload before saving' }); return; }
   res.json({ ...profile, blocks: await repository.blocks(id) });
  } finally { sessions.endEdit(id); }
 });
 router.get('/blocks', (_req,res) => { res.json({ blocks: res.locals.profile.blocks }); });
 router.route('/blocks/:target').all((req,res,next) => {
  if (!validProfileId(req.params.target) || req.params.target === res.locals.profile.id) { res.status(400).json({ error: 'Invalid block target' }); return; } next();
 }).get((req,res) => { res.json({ blocked: res.locals.profile.blocks.includes(req.params.target) }); })
 .put(async (req,res) => {
  if (!await repository.setBlock(res.locals.profile.id, req.params.target as string, true)) { res.status(404).json({ error: 'Profile not found' }); return; }
  await sessions.notifyBlocksChanged(res.locals.profile.id); res.json({ blocks: await repository.blocks(res.locals.profile.id) });
 }).delete(async (req,res) => {
  await repository.setBlock(res.locals.profile.id, req.params.target as string, false);
  await sessions.notifyBlocksChanged(res.locals.profile.id); res.json({ blocks: await repository.blocks(res.locals.profile.id) });
 });
 router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if(error instanceof SafetyError){if(error.status===429)res.setHeader('Retry-After',String(error.retryAfter));res.status(error.status).json({code:error.codeName,error:error.message});return;}
  const status = (error as { status?: number })?.status;
  if (status === 400 || status === 413) { res.status(status).json({ error: status === 413 ? 'Request too large' : 'Malformed JSON' }); return; }
  res.status(503).json({ error: 'Guest service temporarily unavailable' });
 });
 app.use('/api', router);
}
