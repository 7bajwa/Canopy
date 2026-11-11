// Fills public/samples with the built-in plants as .canopy files (only where a file of that name isn't there yet,
// so samples you replace stay yours) and lists every .canopy file in the folder in index.json.
import { writeFileSync, mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { PRESETS } from '../src/graph/presets.js';

const dir = fileURLToPath(new URL('../public/samples/', import.meta.url));
mkdirSync(dir, { recursive: true });
for (const [name, make] of Object.entries(PRESETS)) {
  const file = join(dir, `${name}.canopy`);
  if (!existsSync(file)) writeFileSync(file, JSON.stringify({ app: 'canopy', version: 1, name, graph: make(), assets: {} }));
}
const list = readdirSync(dir).filter((f) => f.endsWith('.canopy')).sort().map((file) => {
  let name = file.replace(/\.canopy$/, '');
  try { name = JSON.parse(readFileSync(join(dir, file), 'utf8')).name || name; } catch { /* the file name will do */ }
  return { name, file };
});
writeFileSync(join(dir, 'index.json'), JSON.stringify(list, null, 1));
console.log(`samples: ${list.length}`);
