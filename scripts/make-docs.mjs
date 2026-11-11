// Writes the node reference (public/docs/index.html) from the node definitions, so it never goes out of date.
// Each part is a picture of it (public/docs/img, taken from the editor) with short notes on the same lines beside it.
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NODE_TYPES } from '../src/graph/schema.js';
import { TABS, SHAPE_MODS, SURFACE_MODS } from '../src/graph/defs-unified.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const slug = (...p) => p.map((s) => String(s).replace(/[^\w]+/g, '-')).join('--');
const imgDir = fileURLToPath(new URL('../public/docs/img/', import.meta.url));
const pic = (name, alt) => (existsSync(`${imgDir}${name}.png`) ? `<img src="img/${name}.png" alt="${esc(alt)}" loading="lazy">` : '');

// A setting as one line: its name, then what it does, with its unit and default in small type.
const note = (p) => {
  const extra = [p.unit, p.d !== null && p.d !== undefined && typeof p.d !== 'object' ? `starts at ${p.d}` : '', p.vc ? 'can vary ± and follow a curve' : ''].filter(Boolean).join(' · ');
  return `<li><b>${esc(p.l)}</b>${p.hint ? ` — ${esc(p.hint)}` : ''}${extra ? ` <small>${esc(extra)}</small>` : ''}</li>`;
};
const notes = (params) => {
  const out = []; let open = false;
  for (const p of params) {
    if (!p.l || ['data', 'action'].includes(p.t)) continue;
    if (p.t === 'section') { if (open) out.push('</ul>'); out.push(`<h5>${esc(p.l)}</h5><ul>`); open = true; continue; }
    if (!open) { out.push('<ul>'); open = true; }
    out.push(note(p));
  }
  if (open) out.push('</ul>');
  return out.join('');
};
// A picture on the left, its notes on the right.
const pair = (id, title, picture, text, body) => `<div class="pair" id="${id}"><div class="shot">${picture}</div><div class="text"><h4>${esc(title)}</h4>${text ? `<p class="muted">${esc(text)}</p>` : ''}${body}</div></div>`;

function nodeDoc(t, picOf) {
  const id = slug(t.type);
  const tabs = t.tabs || [null];
  const nav = []; const html = [`<section id="${id}"><h3>${esc(t.title)}</h3><p>${esc(t.desc || '')}</p>`];
  for (const k of tabs) {
    const tid = slug(t.type, k || 'all');
    const label = k ? `${TABS[k]?.label || k} tab` : t.title;
    html.push(pair(tid, label, pic(picOf(k), label), k ? TABS[k]?.text : '', notes(t.params.filter((p) => !k || p.tab === k))));
    if (k) nav.push(`<a href="#${tid}">${esc(TABS[k]?.label || k)}</a>`);
  }
  html.push('</section>');
  return { nav: nav.length ? `<details open><summary><a href="#${id}">${esc(t.title)}</a></summary>${nav.join('')}</details>` : `<a href="#${id}">${esc(t.title)}</a>`, html: html.join('') };
}

const modList = (title, set) => `<h4 id="${slug(title)}">${esc(title)}</h4><ul class="mods">${Object.values(set).map((m) => `<li><b>${esc(m.title)}</b> — ${esc(m.desc)}<ul>${m.params.filter((p) => p.l).map(note).join('')}</ul></li>`).join('')}</ul>`;
const splineMods = Object.fromEntries(Object.values(NODE_TYPES).filter((t) => t.cat === 'mod' && !t.hidden).map((t) => [t.type, { title: t.title, desc: t.desc || '', params: t.params.filter((p) => p.t !== 'data') }]));

const spline = nodeDoc(NODE_TYPES.Spline, (k) => `spline-${k}`);
const mesh = nodeDoc(NODE_TYPES.Mesh, (k) => `mesh-${k}`);
const mix = nodeDoc(NODE_TYPES.Mix, () => 'mix');

const INTERFACE = `<ul>
<li><b>Toolbar</b> (top) — File (new, open a file or a sample, save, backup, import, export), undo and redo, add a Spline, Mesh or Mix node, materials and the cutout editor, layout, shading, wireframe, and Render · Bake · Pack. Each group can be folded into one button or hidden in Settings › Toolbar. Drag its grip to dock it on any edge.</li>
<li><b>Node graph</b> (left) — the plant as nodes. A node's eye switches it on and off; its tabs hold its settings. Right-click empty space to add a node.</li>
<li><b>3D view</b> (right) — the plant itself. Click a part to pick its node.</li>
<li><b>Navigation icons</b> — pan, zoom and frame each view without a mouse; drag their grip to dock them on a wall.</li>
<li><b>Gizmo and dials</b> (top corner of the 3D view) — click an axis to look along it; the dials turn the light and the wind (click the middle to switch one off); the ruler shows the scale figure.</li>
</ul>`;

const GUIDE = `<p>A plant is a graph of nodes. A <b>Spline</b> node is one part of the plant: a line (its length and steps, bent by modifiers), where those lines start (Placement), what wraps them (a tube, leaf blades or cutout leaves), how they look (a material) and how they move (wind). A <b>Mesh</b> node is a solid shape placed as copies, which other parts can also grow on.</p>
<p>Connect a node's <i>Children</i> output to another node's <i>Parent</i> input to grow the second from the first. Each setting can vary from copy to copy (±) and follow a curve along its line or up the chain (〜). A setting's sockets start hidden: right-click a value to expose it, copy, paste or reset it.</p>`;

const EXPORT = `<p>The Export window picks the format (GLB, FBX, or OBJ in a zip), whether pictures are packed inside the file, and whether the plant goes out as one mesh, one mesh per node, or each piece on its own with its pivot at its base.</p>
<ul><li><b>Vertex colors</b> — each of R, G, B and A can carry a gradient: height, along each branch, along each leaf, or a random number per piece.</li>
<li><b>Pivot Painter 2</b> — two EXR textures (pivot position + parent index, X axis + extent); each piece points at its pixel in the second UV set.</li>
<li><b>Vertex animation</b> — the wind baked as offsets per frame into an EXR, read through the third UV set.</li>
<li><b>Bone rig</b> (GLB) — one bone per branch; leaves ride the branch they grow on.</li></ul>
<p><b>Bake</b> and <b>Pack</b> write texture maps. Each map has a checkbox in front and its settings under the arrow at its end: the suffix added to the file name, Dilate (bleeds colors past the edges so mipmaps don't show a fringe), and its own extras. The Packed texture puts any maps into one file's R, G, B and A.</p>`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Canopy node reference</title><link rel="icon" href="../favicon.ico">
<style>
body{margin:0;background:#11160f;color:#e9efe4;font:14px/1.55 Poppins,system-ui,sans-serif}
header{padding:28px 32px 8px}main{display:grid;grid-template-columns:220px 1fr;gap:28px;padding:0 32px 60px}
nav{position:sticky;top:12px;align-self:start;max-height:calc(100vh - 24px);overflow:auto;font-size:13px}
nav a{display:block;color:#a3b09a;text-decoration:none;padding:2px 0}nav a:hover{color:#7fc241}
nav h6{margin:14px 0 4px;color:#7fc241;font-size:12px;text-transform:uppercase;letter-spacing:.06em}
nav details>a{margin-left:12px}nav summary{cursor:pointer;list-style:none}nav summary a{display:inline}
h1{margin:0;font-size:28px}h2{color:#7fc241;margin:40px 0 8px}h3{margin:26px 0 6px;font-size:20px}h4{margin:0 0 6px;color:#cfe8b4}h5{margin:12px 0 2px;color:#9fd36a;font-size:12px;text-transform:uppercase;letter-spacing:.05em}
.muted,small{color:#a3b09a}ul{margin:4px 0 8px;padding-left:18px}li{margin:2px 0}
.pair{display:grid;grid-template-columns:minmax(0,300px) 1fr;gap:24px;align-items:start;padding:16px 0;border-top:1px solid rgba(255,255,255,.08)}
.pair .shot{position:sticky;top:12px}.pair img,.wide img{max-width:100%;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.45)}
.wide{display:grid;grid-template-columns:minmax(0,1.4fr) 1fr;gap:24px;align-items:start}
ul.mods>li{margin:10px 0}
@media(max-width:900px){main,.pair,.wide{grid-template-columns:1fr}nav{position:static;max-height:none}.pair .shot{position:static}}
</style></head><body>
<header><h1>Canopy node reference</h1><p class="muted">The editor, each node tab by tab, the modifiers, and exporting.</p></header>
<main><nav><h6>Guide</h6><a href="#how">How Canopy works</a><a href="#interface">The editor</a>
<h6>Plant parts</h6>${spline.nav}${mesh.nav}${mix.nav}
<h6>Modifiers</h6><a href="#${slug('Spline modifiers')}">Spline modifiers</a><a href="#${slug('Mesh modifiers')}">Mesh modifiers</a><a href="#${slug('Shape modifiers')}">Shape modifiers</a>
<h6>Exporting</h6><a href="#export">Export, Bake and Pack</a></nav>
<div>
<section id="how"><h2>How Canopy works</h2>${GUIDE}</section>
<section id="interface"><h2>The editor</h2><div class="wide"><div>${pic('interface', 'The editor')}</div><div>${INTERFACE}</div></div></section>
<h2>Plant parts</h2>${spline.html}${mesh.html}${mix.html}
<h2 id="modifiers">Modifiers</h2>
<div class="pair"><div class="shot">${pic('modifiers', 'Modifiers on a Spline node')}</div><div class="text"><p>Modifiers sit in a list on a node's tab. The checkbox switches one on and off, the arrow opens its settings, the six-dot pad drags it up or down (the order matters: each works on what the one above made), and × removes it. <b>+ Add modifier</b> adds one.</p>
${modList('Spline modifiers', splineMods)}${modList('Mesh modifiers', SURFACE_MODS)}${modList('Shape modifiers', SHAPE_MODS)}</div></div>
<section id="export"><h2>Exporting</h2>${EXPORT}</section>
</div></main></body></html>`;
const out = fileURLToPath(new URL('../public/docs/index.html', import.meta.url));
mkdirSync(fileURLToPath(new URL('../public/docs/', import.meta.url)), { recursive: true });
writeFileSync(out, html);
console.log('docs: written');
