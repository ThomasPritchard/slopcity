import { Client } from 'pg';

export function runtimeConfig(env: NodeJS.ProcessEnv = process.env) {
  const port = Number(env.PORT || 2567);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port');
  if (env.NODE_ENV === 'production') {
    const required = ['DATABASE_URL', 'APP_ORIGIN', 'LIVEKIT_URL', 'LIVEKIT_PUBLIC_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'];
    for (const name of required) {
      if (!env[name]?.trim() || /REPLACE_ME|CHANGE_ME/i.test(env[name]!)) throw new Error(`${name} must be configured for production`);
    }
    validateUrl('DATABASE_URL', env.DATABASE_URL!, ['postgres:', 'postgresql:']);
    for (const value of [env.APP_ORIGIN!, ...(env.APP_ORIGINS?.split(',').map(value => value.trim()).filter(Boolean) ?? [])]) {
      const url = validateUrl('APP_ORIGIN / APP_ORIGINS', value, ['https:']);
      if (url.origin !== value) throw new Error('APP_ORIGIN / APP_ORIGINS must contain exact HTTPS origins without paths');
    }
    validateUrl('LIVEKIT_URL', env.LIVEKIT_URL!, ['http:', 'https:', 'ws:', 'wss:']);
    validateUrl('LIVEKIT_PUBLIC_URL', env.LIVEKIT_PUBLIC_URL!, ['wss:']);
  }
  return { host: env.HOST || '127.0.0.1', port };
}

function validateUrl(name: string, value: string, protocols: string[]) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${name} must be a valid URL`); }
  if (!protocols.includes(url.protocol) || !url.hostname) throw new Error(`${name} uses an unsupported URL protocol`);
  if (name !== 'DATABASE_URL' && (url.username || url.password || url.hash || url.search)) throw new Error(`${name} must not contain credentials, a query or fragment`);
  return url;
}

// A session lock must live on its own connection, never a pooled connection that
// a later request could borrow. Database advisory locks are already DB-scoped;
// the schema key also permits isolated integration-test schemas.
export async function acquireRuntimeLock(connectionString: string, onLost: () => void) {
  const client = new Client({ connectionString, connectionTimeoutMillis: 3000, query_timeout: 5000, keepAlive: true });
  let closing = false;
  let acquired = false;
  let reported = false;
  const lost = () => {
    if (!closing && acquired && !reported) { reported = true; onLost(); }
  };
  client.on('error', lost);
  client.on('end', lost);
  try {
    await client.connect();
    const result = await client.query("SELECT pg_try_advisory_lock(1936486256, hashtext(current_schema())) AS acquired");
    if (!result.rows[0]?.acquired) throw new Error('Another Slop City server owns this database schema');
    acquired = true;
  } catch (error) {
    closing = true;
    await client.end().catch(() => {});
    if (error instanceof Error && error.message === 'Another Slop City server owns this database schema') throw error;
    throw new Error('Unable to acquire database ownership; check database connectivity and schema configuration');
  }
  // Detect a silent connection failure too. A lost lock requires immediate exit:
  // another instance may already be recovering wagers, so do not keep writing.
  const heartbeat = setInterval(() => { void client.query('SELECT 1').catch(lost); }, 5000);
  heartbeat.unref();
  return {
    async close() {
      closing = true;
      clearInterval(heartbeat);
      await client.end(); // PostgreSQL releases session locks on disconnect.
    },
  };
}
