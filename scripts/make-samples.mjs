// Fills public/samples with the built-in plants as .canopy files (only where a file of that name isn't there yet,
// so samples you replace stay yours) and lists every .canopy file in index.json. Each category is a subfolder
// (Trees, Bushes, Flowers, Grass, Vines, Misc); a file in the samples folder itself counts as Misc. A plant's
// picture is the .png of the same name beside it. An existing entry keeps its price.
import { writeFileSync, mkdirSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { PRESETS } from '../src/graph/presets.js';

const dir = fileURLToPath(new URL('../public/samples/', import.meta.url));
mkdirSync(dir, { recursive: true });
const folders = ['', ...readdirSync(dir).filter((f) => statSync(join(dir, f)).isDirectory())];
const files = folders.flatMap((f) => readdirSync(join(dir, f)).filter((x) => x.endsWith('.canopy')).map((x) => (f ? `${f}/${x}` : x)));
for (const [name, make] of Object.entries(PRESETS)) {
  if (files.some((f) => f.split('/').pop() === `${name}.canopy`)) continue;
  mkdirSync(join(dir, 'Misc'), { recursive: true });
  writeFileSync(join(dir, 'Misc', `${name}.canopy`), JSON.stringify({ app: 'canopy', version: 1, name, graph: make(), assets: {} }));
  files.push(`Misc/${name}.canopy`);
}
let old = [];
try { old = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')); } catch { /* first run */ }
const list = files.sort().map((file) => {
  let name = file.split('/').pop().replace(/\.canopy$/, '');
  try { name = JSON.parse(readFileSync(join(dir, file), 'utf8')).name || name; } catch { /* the file name will do */ }
  const thumb = file.replace(/\.canopy$/, '.png');
  const prev = old.find((x) => x.file === file);
  return { name, file, thumb: existsSync(join(dir, thumb)) ? thumb : undefined, category: file.includes('/') ? file.split('/')[0] : 'Misc', price: prev?.price || 0 };
});
writeFileSync(join(dir, 'index.json'), JSON.stringify(list, null, 1));
console.log(`samples: ${list.length}`);
