import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { zipSync, unzipSync, strToU8, zlibSync } from 'fflate';

const root = new URL('../', import.meta.url);
const { version } = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const output = new URL('dist/machstrike/browser/', root);
// Only npm metadata uses the semver "+build" suffix; app-facing versions use dots.
const displayVersion = version.replaceAll('+', '.');
const versionSource = `// Generated release metadata. Keep aligned with package.json.\nexport const VERSION = ${JSON.stringify(displayVersion)};\n`;
await writeFile(new URL('version.js', root), versionSource);
await writeFile(new URL('version.js', output), versionSource);

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0);
  name.copy(result, 4);
  Buffer.from(data).copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8);
  return result;
}

function createIcon() {
  const size = 256;
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  const polygon = [[128, 24], [140, 111], [223, 171], [223, 190], [145, 161], [139, 211],
    [164, 232], [128, 223], [92, 232], [117, 211], [111, 161], [33, 190], [33, 171], [116, 111]];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
      }
      const grid = x % 32 === 0 || y % 32 === 0;
      const color = inside ? [237, 178, 114] : grid ? [26, 47, 57] : [12, 27, 37];
      const index = y * (size * 4 + 1) + 1 + x * 4;
      pixels.set([...color, 255], index);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', zlibSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

await writeFile(new URL('icon.png', output), createIcon());
const files = {};
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else {
      const name = relative(output.pathname, path).replaceAll('\\', '/');
      if ((name.endsWith('.map') && !process.argv.includes('--debug')) || name === 'webxdc.js') continue;
      files[name] = new Uint8Array(await readFile(path));
    }
  }
}
await collect(output.pathname);
// Angular's legal notices live one directory above its browser output.
files['3rdpartylicenses.txt'] = strToU8(await readFile(new URL('../3rdpartylicenses.txt', output), 'utf8'));
for (const required of ['index.html', 'manifest.toml', 'icon.png', 'version.js']) {
  if (!files[required]) throw new Error(`Missing required package asset: ${required}`);
}
const archive = zipSync(files, { level: 9 });
const decoded = unzipSync(archive);
if (Object.keys(decoded).length !== Object.keys(files).length) throw new Error('Archive verification failed');
const archivePath = `dist/machstrike-${displayVersion}.xdc`;
await writeFile(new URL(archivePath, root), archive);
console.log(`Packaged MachStrike ${version}: ${archivePath} (${(archive.length / 1024 / 1024).toFixed(2)} MiB, ${Object.keys(files).length} files)`);
