// Runs the collector + API (port 8787) and the Vite dev server (port 5173) together.
import { spawn } from 'node:child_process';

const procs = [
  spawn(process.execPath, ['--watch', 'src/main.ts'], { stdio: 'inherit' }),
  spawn('npx', ['vite'], { stdio: 'inherit' }),
];
const stop = () => procs.forEach((p) => p.kill('SIGTERM'));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach((p) => p.on('exit', () => { stop(); process.exit(0); }));
