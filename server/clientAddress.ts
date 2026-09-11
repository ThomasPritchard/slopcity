import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { Server as HttpServer, type IncomingMessage, type ServerResponse } from 'node:http';

export const socketIdentities = new WeakMap<object, { ip: string; cookie?: string; isOpen: () => boolean; terminate: () => void }>();

export class AddressedHttpServer extends HttpServer {
 constructor(private readonly addressSecret?: string, private readonly guard?: (req: IncomingMessage, res: ServerResponse) => boolean) { super(); }
 override emit(event: string, ...args: any[]): boolean {
  // Colyseus prepends request listeners while binding its router. Capture at
  // dispatch, so no router or later middleware can run before validation.
  if(event==='request'||event==='upgrade')captureClientAddress(args[0],this.addressSecret);
  if(event==='request'&&this.guard&&!this.guard(args[0],args[1]))return true;
  return super.emit(event,...args);
 }
}

export function normalizeIP(value: unknown): string | null {
  if (typeof value !== 'string' || !isIP(value) || value.includes('%')) return null;
  if (isIP(value) === 4) return value;
  const canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  // IPv4-mapped IPv6 must share bans and quotas with its IPv4 spelling.
  const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(canonical);
  if (mapped) { const a = parseInt(mapped[1], 16), b = parseInt(mapped[2], 16); return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`; }
  return canonical;
}

export function proxySecret(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env.ABUSE_PROXY_SECRET;
  if (value && !/^[a-f0-9]{64}$/.test(value)) throw new Error('ABUSE_PROXY_SECRET must be 64 lowercase hexadecimal characters');
  if (env.NODE_ENV === 'production' && !value) throw new Error('Configure ABUSE_PROXY_SECRET and the trusted gateway before starting production');
  return value || undefined;
}

// Run at the raw HTTP server boundary, before Express and Colyseus create contexts.
// No client-controlled X-Forwarded-For/Colyseus context.ip is ever trusted.
export function captureClientAddress(req: IncomingMessage, secret?: string): void {
  const supplied = req.headers['x-slop-proxy-key'];
  const verified = secret && typeof supplied === 'string' && /^[a-f0-9]{64}$/.test(supplied) && timingSafeEqual(Buffer.from(supplied), Buffer.from(secret));
  const ip = secret ? (verified ? normalizeIP(req.headers['x-slop-client-ip']) : null) : normalizeIP(req.socket.remoteAddress);
  for (const name of ['x-slop-proxy-key', 'x-slop-client-ip', 'x-forwarded-for', 'x-real-ip', 'x-client-ip', 'cf-connecting-ip']) delete req.headers[name];
  req.headers['x-slop-client-ip'] = ip ?? '';
}

export function clientAddress(headers: Headers | IncomingMessage['headers']): string | null {
  return normalizeIP(headers instanceof Headers ? headers.get('x-slop-client-ip') : headers['x-slop-client-ip']);
}

// Pool privacy IPv6 addresses into /64 for quotas, but bans remain exact addresses.
export function networkKey(ip: string): string {
  if (isIP(ip) === 4) return ip;
  const [left, right = ''] = ip.split('::'), a = left ? left.split(':') : [], b = right ? right.split(':') : [];
  const full = ip.includes('::') ? [...a, ...Array(8 - a.length - b.length).fill('0'), ...b] : a;
  return `${full.slice(0, 4).map(part => parseInt(part, 16).toString(16)).join(':')}::/64`;
}
