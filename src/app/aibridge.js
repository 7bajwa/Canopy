// AI control: a small set of commands an AI assistant (through an MCP server, or the browser console) can use
// to read the node types, build or change the plant and look at a render. Nothing runs until it's turned on in
// Settings → Developer. Every input is checked, since it comes from outside the editor.

const SKIP = new Set(['data', 'section', 'action', 'mods', 'obj', 'ref']);

export function makeApi(d) {
  const { doc, NODE_TYPES, defaultParams, addNode, connect, removeNodes, changed, commit, loadGraph, renderImage } = d;
  const types = () => Object.values(NODE_TYPES).filter((t) => !t.hidden);
  const node = (id) => {
    const n = doc.graph.nodes.find((x) => x.id === id);
    if (!n) throw new Error(`There is no node "${id}".`);
    return n;
  };

  // A value must fit its setting: known key, right kind, inside its range.
  function checkParams(type, params) {
    const defs = new Map(NODE_TYPES[type].params.map((p) => [p.k, p]));
    const out = {};
    for (const [k, v] of Object.entries(params || {})) {
      const p = defs.get(k);
      if (!p || SKIP.has(p.t)) throw new Error(`${type} has no setting "${k}".`);
      if (p.t === 'num') {
        if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`"${k}" needs a number.`);
        out[k] = Math.min(p.max ?? Infinity, Math.max(p.min ?? -Infinity, v));
      } else if (p.t === 'bool') {
        if (typeof v !== 'boolean') throw new Error(`"${k}" needs true or false.`);
        out[k] = v;
      } else if (p.t === 'enum') {
        if (!p.opts.includes(v)) throw new Error(`"${k}" must be one of ${p.opts.join(', ')}.`);
        out[k] = v;
      } else if (p.t === 'toggles') {
        const parts = String(v).split('+');
        if (v !== 'none' && !parts.every((x) => p.opts.includes(x))) throw new Error(`"${k}" must be none, or one or more of ${p.opts.join(', ')} joined with +, like tube+leaf.`);
        out[k] = v;
      } else if (p.t === 'color') {
        if (!/^#[0-9a-f]{6}$/i.test(String(v))) throw new Error(`"${k}" needs a color like #6ea336.`);
        out[k] = v;
      } else if (p.t === 'vec') {
        if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite)) throw new Error(`"${k}" needs three numbers.`);
        out[k] = v;
      } else out[k] = JSON.parse(JSON.stringify(v));
    }
    return out;
  }

  const done = () => { changed({ layout: true }); commit(); };
  const parentOf = (id) => doc.graph.links.find((l) => l.to === id && l.toSock === 'parent')?.from ?? null;

  return {
    schema() {
      return {
        nodeTypes: types().map((t) => ({
          type: t.type, title: t.title, description: t.desc, tabs: t.tabs || null,
          params: t.params.filter((p) => !SKIP.has(p.t) && p.l).map((p) => ({
            key: p.k, label: p.l, type: p.t, default: p.d, unit: p.unit, min: p.min, max: p.max, options: p.opts, tab: p.tab, hint: p.hint,
          })),
        })),
        materials: (doc.graph.materials || []).map((m) => ({ id: m.id, name: m.name, texture: m.texture, cutouts: (m.cutouts || []).length })),
      };
    },
    listNodes() {
      return doc.graph.nodes.map((n) => ({ id: n.id, type: n.type, name: n.name || '', parent: parentOf(n.id) }));
    },
    getPlant() {
      // Imported meshes and cutout meshes are large and not needed to read a plant.
      const nodes = doc.graph.nodes.map((n) => ({ ...n, params: Object.fromEntries(Object.entries(n.params).filter(([k]) => k !== 'obj' && k !== 'cutouts')) }));
      return { name: doc.name, graph: { nodes, links: doc.graph.links, settings: doc.graph.settings } };
    },
    setPlant({ graph, name } = {}) {
      if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.links)) throw new Error('A plant needs nodes and links.');
      const ids = new Set();
      const nodes = graph.nodes.map((n) => {
        if (!NODE_TYPES[n?.type] || NODE_TYPES[n.type].hidden) throw new Error(`Unknown node type "${n?.type}".`);
        if (typeof n.id !== 'string' || ids.has(n.id)) throw new Error('Every node needs its own id.');
        ids.add(n.id);
        return { id: n.id, type: n.type, name: String(n.name || ''), x: +n.x || 0, y: +n.y || 0, on: n.on !== false, params: { ...defaultParams(n.type), ...checkParams(n.type, n.params) } };
      });
      const links = graph.links.map((l, i) => {
        if (!ids.has(l.from) || !ids.has(l.to)) throw new Error(`Link ${i + 1} joins a node that isn't there.`);
        return { id: `l${i + 1}`, from: l.from, fromSock: String(l.fromSock || 'children'), to: l.to, toSock: String(l.toSock || 'parent') };
      });
      loadGraph({ nodes, links, groups: [], materials: doc.graph.materials || [], settings: { seed: 1, ...(graph.settings || {}) } }, name || doc.name);
      done();
      return { nodes: nodes.length, links: links.length };
    },
    addNode({ type, name, params, parent } = {}) {
      if (!NODE_TYPES[type] || NODE_TYPES[type].hidden) throw new Error(`Unknown node type "${type}".`);
      const checked = checkParams(type, params);
      const p = parent ? node(parent) : null;
      const n = addNode(type, p ? p.x + 260 : 0, p ? p.y + doc.graph.links.filter((l) => l.from === p.id).length * 70 : doc.graph.nodes.length * 90);
      if (name) n.name = String(name);
      Object.assign(n.params, checked);
      if (p) {
        const r = connect(p.id, 'children', n.id, 'parent');
        if (!r.ok) throw new Error(r.why);
        Object.assign(n.params, checked);
      }
      done();
      return { id: n.id };
    },
    setParams({ id, params } = {}) {
      const n = node(id);
      Object.assign(n.params, checkParams(n.type, params));
      done();
      return { id };
    },
    connect({ from, to } = {}) {
      node(from); node(to);
      const r = connect(from, 'children', to, 'parent');
      if (!r.ok) throw new Error(r.why);
      done();
      return { ok: true };
    },
    removeNode({ id } = {}) {
      node(id);
      removeNodes([id]);
      done();
      return { ok: true };
    },
    render({ size = 1024 } = {}) {
      return { image: renderImage(Math.max(256, Math.min(2048, Math.round(+size) || 1024))) };
    },
    stats() { return doc.result?.stats || null; },
  };
}

let host = null;

// Turns the connection on: the PC app passes commands in from its local server; any page can use window.canopyAI.
export function startBridge(api) {
  window.canopyAI = api;
  host = window.canopyHost?.aiBridge || null;
  if (!host) return false;
  host.onCommand(async ({ id, tool, args }) => {
    try {
      if (typeof api[tool] !== 'function') throw new Error(`There is no command "${tool}".`);
      host.reply({ id, ok: true, result: await api[tool](args || {}) });
    } catch (e) {
      host.reply({ id, ok: false, error: e.message });
    }
  });
  host.setEnabled(true);
  return true;
}

export function stopBridge() {
  delete window.canopyAI;
  host?.setEnabled(false);
}
