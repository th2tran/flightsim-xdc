import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const { version } = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const child = spawn(process.execPath, [
  fileURLToPath(new URL('node_modules/@webxdc/webxdc-dev/dist/backend/cli.js', root)),
  'run', `dist/afterburner-${version.replaceAll('+', '.')}.xdc`, ...process.argv.slice(2),
], { cwd: fileURLToPath(root), stdio: 'inherit' });
child.on('error', error => { console.error('Unable to launch webxdc preview:', error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
