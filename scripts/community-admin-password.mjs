import { readFile, writeFile, chmod } from 'node:fs/promises';
import { randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';

async function hidden(prompt) {
 if (!process.stdin.isTTY) throw new Error('Run this command in an interactive terminal');
 process.stdin.setRawMode(true);
 process.stdin.resume();
 return new Promise((resolve, reject) => {
  let value = '';
  const finish = () => {
   process.stdin.off('data', onData);
   process.stdin.setRawMode(false);
   process.stdin.pause();
   process.stdout.write('\n');
  };
  const onData = data => {
   for (const char of data.toString()) {
    if (char === '\u0003') { finish(); reject(new Error('Cancelled')); return; }
    if (char === '\r' || char === '\n') { finish(); resolve(value); return; }
    if (char === '\u007f') value = value.slice(0, -1);
    else if (char >= ' ' && value.length < 1024) value += char;
   }
  };
  process.stdin.on('data', onData);
  process.stdout.write(prompt);
 });
}

try {
 const args = process.argv.slice(2);
 if (args.length !== 0 && (args.length !== 2 || args[0] !== '--file' || !args[1] || args[1].startsWith('--'))) {
  throw new Error('Usage: node scripts/community-admin-password.mjs [--file PATH]');
 }
 const envFile = args[1] ?? '.env';
 const password = await hidden('New community admin password (hidden): ');
 if (password.length < 12) throw new Error('Use at least 12 characters');
 if (password !== await hidden('Confirm password (hidden): ')) throw new Error('Passwords did not match');
 let env = '';
 try { env = await readFile(envFile, 'utf8'); }
 catch (error) { if (error.code !== 'ENOENT') throw error; }
 const salt = randomBytes(16).toString('hex');
 const hash = await promisify(scrypt)(password, salt, 64);
 const line = `COMMUNITY_ADMIN_PASSWORD_HASH=scrypt:${salt}:${hash.toString('hex')}`;
 env = /^COMMUNITY_ADMIN_PASSWORD_HASH=.*$/m.test(env)
  ? env.replace(/^COMMUNITY_ADMIN_PASSWORD_HASH=.*$/gm, line)
  : `${env.trimEnd()}\n${line}\n`;
 // Restrict an existing file before adding the credential.
 try { await chmod(envFile, 0o600); }
 catch (error) { if (error.code !== 'ENOENT') throw error; }
 await writeFile(envFile, env, { mode: 0o600 });
 await chmod(envFile, 0o600);
 console.log('Community admin password saved. Restart the target server to use it.');
} catch (error) {
 console.error(error instanceof Error ? error.message : 'Password setup failed');
 process.exitCode = 1;
}
