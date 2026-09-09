import { readFile, writeFile } from 'node:fs/promises';

// @colyseus/sdk 0.18.2 probes a Node-only WebSocket constructor overload in browsers.
// WebKit reports that invalid protocol as a page error even though the SDK catches it.
// Keep the browser on its valid overload; leave Node's custom-header path unchanged.
const directory = new URL('../node_modules/@colyseus/sdk/', import.meta.url);
const { version } = JSON.parse(await readFile(new URL('package.json', directory), 'utf8'));
if (version !== '0.18.2') throw new Error(`Review the WebKit socket patch for SDK ${version} before updating.`);
const original = 'this.ws = new WebSocket(url, { headers, protocols: this.protocols });';
const replacement = "this.ws = typeof window !== 'undefined'\n                ? new WebSocket(url, this.protocols)\n                : new WebSocket(url, { headers, protocols: this.protocols });";
for (const extension of ['mjs', 'cjs']) {
  const path = new URL(`build/transport/WebSocketTransport.${extension}`, directory);
  const source = await readFile(path, 'utf8');
  if (source.includes(replacement)) continue;
  if (source.split(original).length !== 2) throw new Error(`Unexpected SDK source in ${path.pathname}; patch not applied.`);
  await writeFile(path, source.replace(original, replacement));
}
