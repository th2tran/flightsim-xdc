import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const packageUrl = new URL('package.json', root);
const lockUrl = new URL('package-lock.json', root);
const manifestUrl = new URL('public/manifest.toml', root);
const pkg = JSON.parse(await readFile(packageUrl, 'utf8'));
const lock = JSON.parse(await readFile(lockUrl, 'utf8'));
const manifest = await readFile(manifestUrl, 'utf8');
const match = /^(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\+(\d+))?$/.exec(pkg.version);
if (!match) throw new Error(`Expected version MAJOR.MINOR.PATCH+BUILD, received ${pkg.version}`);
if (!/^version\s*=\s*"[^"]*"\s*$/m.test(manifest)) throw new Error('Missing manifest version');
if (!lock.packages?.['']) throw new Error('Missing root package-lock metadata');
const version = `${match[1]}+${BigInt(match[2] ?? '0') + 1n}`;
pkg.version = lock.version = lock.packages[''].version = version;
await writeFile(packageUrl, `${JSON.stringify(pkg, null, 2)}\n`);
await writeFile(lockUrl, `${JSON.stringify(lock, null, 2)}\n`);
// Only npm metadata uses the semver "+build" suffix; app-facing versions use dots.
const displayVersion = version.replaceAll('+', '.');
await writeFile(manifestUrl, manifest.replace(/^version\s*=\s*"[^"]*"[ \t]*$/m, `version = "${displayVersion}"`));
await writeFile(new URL('version.js', root), `// Generated release metadata. Keep aligned with package.json.\nexport const VERSION = ${JSON.stringify(displayVersion)};\n`);
console.log(`Build version: ${version}`);
