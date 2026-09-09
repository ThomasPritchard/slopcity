import { spawn } from 'node:child_process';
const children = ['dev:server', 'dev:client'].map(script => spawn('npm', ['run', script], { stdio: 'inherit' }));
let stopping = false;
function stop(code = 0) { if (stopping) return; stopping = true; for (const child of children) child.kill('SIGTERM'); process.exitCode = code; }
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => stop());
for (const child of children) child.on('exit', code => stop(code || 0));
