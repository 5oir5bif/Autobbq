import { spawn } from 'node:child_process';

const commands = [
  ['cargo', ['run', '--manifest-path', 'backend-rs/Cargo.toml']],
  ['npm', ['run', 'dev', '-w', 'frontend']],
];

const children = commands.map(([command, args]) => {
  const child = spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  child.on('exit', (code, signal) => {
    if (signal) {
      shutdown(signal);
      return;
    }
    if (code !== 0) {
      shutdown('SIGTERM', code ?? 1);
    }
  });
  return child;
});

let stopping = false;
function shutdown(signal = 'SIGTERM', exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
  setTimeout(() => process.exit(exitCode), 200);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
