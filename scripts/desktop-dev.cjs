const { spawn } = require('node:child_process');
const { platform } = process;
const next = platform === 'win32' ? 'next.cmd' : 'next';
const electron = platform === 'win32' ? 'electron.cmd' : 'electron';

const nextProcess = spawn(next, ['dev', '-H', '127.0.0.1', '-p', '3187'], { stdio: 'inherit', shell: true });
const electronProcess = spawn(electron, ['desktop/main.cjs'], { stdio: 'inherit', shell: true });

function stop() {
  nextProcess.kill();
  electronProcess.kill();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
electronProcess.on('exit', code => { nextProcess.kill(); process.exit(code ?? 0); });
