// Starts the demo API and the Vite dev server together. Ctrl+C stops both.
import { spawn } from 'node:child_process';
const children = [
  spawn('node', ['--env-file-if-exists=.env', '--import', 'tsx', 'server/main.ts'], { stdio: 'inherit', env: process.env }),
  spawn('npx', ['vite'], { stdio: 'inherit', env: process.env, shell: process.platform === 'win32' }),
];
const stop = () => { for (const child of children) child.kill('SIGINT'); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
// If either process dies for any reason (crash, port in use, killed), stop the other so the page never runs without its API.
const names = ['demo API (port 8788)', 'web (port 5180)'];
children.forEach((child, i) => child.on('exit', (code, signal) => {
  console.error(`\n${names[i]} exited${signal ? ` (${signal})` : ''}${code ? ` with code ${code}` : ''}. Stopping the other process. Run \`npm run demo\` again to restart both.`);
  stop(); if (code) process.exitCode = code;
}));
