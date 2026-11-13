// One pointer router for the single view. What the pointer is over decides what scroll and right-drag move:
// the tree when over the tree, the graph everywhere else. Middle-drag always orbits the 3D view.
import { doc, commit, changed, select, connect, removeLink, setRowValue, nodeById, emit, removeNodes, duplicate, undo, redo, groupSelected, regenerate, selected, mergeNodes } from './doc.js';
import { describeHit, rowBox } from './graphview.js';
import { kindFits } from '../graph/schema.js';

const WHEEL_LATCH = 280;
const TAP_MOVE = 6;
const LONG_PRESS = 550;

export function attachInput(stage, graph, view, ui) {
  const state = { focus: 'auto', layout: 'overlay', mouse: { x: innerWidth / 2, y: innerHeight / 2 }, gesture: null, wheelZone: null, wheelAt: 0, draw: null, clip: null };
  const pointers = new Map();
  const pos = (e) => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const inRect = (r, p) => p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h;

  function zoneAt(p) {
    // With one layer in front, everything but the icons goes to it.
    if (state.layout === 'overlay' && state.focus !== 'auto') return state.focus;
    if (state.layout === 'tree') return 'tree';
    if (state.layout === 'graph') return 'graph';
    if (state.layout === 'split') return inRect(view.rect, p) ? 'tree' : 'graph';
    return view.isOverTree(p.x, p.y) ? 'tree' : 'graph';
  }

  let shownZone = null;
  function showZone(z) {
    if (z === shownZone) return;
    shownZone = z;
    stage.dataset.zone = z;
    ui.status(z);
  }

  stage.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---- Scroll ----
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    ui.hoverTip(null);
    const p = pos(e);
    const now = performance.now();
    // One scroll gesture stays on one target, even when zooming moves the tree out from under the pointer.
    if (now - state.wheelAt > WHEEL_LATCH) state.wheelZone = e.shiftKey ? 'graph' : zoneAt(p);
    state.wheelAt = now;
    let dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
    if (e.ctrlKey) dy *= 4; // trackpad pinch reports small steps
    const f = Math.exp(Math.max(-300, Math.min(300, dy)) * 0.0016);
    if (state.wheelZone === 'tree') view.zoomAt(p.x, p.y, f);
    else graph.zoomAt(p.x, p.y, 1 / f);
    showZone(state.wheelZone);
  }, { passive: false });

  // ---- Press ----
  stage.addEventListener('pointerdown', (e) => {
    document.activeElement?.blur?.();
    ui.hoverTip(null);
    stage.setPointerCapture(e.pointerId);
    const p = pos(e);
    state.mouse = p;
    pointers.set(e.pointerId, { ...p, type: e.pointerType });
    const finger = e.pointerType === 'touch' || e.pointerType === 'pen';
    if (finger) {
      // Otherwise the mouse events a browser adds after a tap take focus from a field that tap just opened.
      e.preventDefault();
      clearTimeout(state.longPress);
      if (pointers.size === 2) { startPinch(); return; }
      if (pointers.size > 2) return;
    }
    // The Transform tool's gizmo takes a press that lands on one of its handles.
    if (e.button === 0 && ui.gizmo?.pointer('down', p, 0)) { state.gesture = { kind: 'gizmo' }; return; }
    if (state.draw && e.button === 0) { startStroke(p); return; }
    if (e.button === 1) { state.gesture = { kind: 'orbit', last: p }; e.preventDefault(); return; }
    if (e.button === 2) { state.gesture = { kind: 'pan', zone: e.shiftKey ? 'graph' : zoneAt(p), last: p, start: p, moved: false }; return; }
    if (e.button !== 0) return;
    startLeft(p, e, finger);
  });

  function startLeft(p, e, finger) {
    const hit = graph.hit(p.x, p.y);
    // The entity editor: a drag anywhere in the 3D view (not on a node) draws a box that picks entities.
    if (ui.gizmo?.on && !finger && !hit?.node && state.layout !== 'graph' && inRect(view.rect, p)) {
      state.gesture = { kind: 'tree-tap', last: p, start: p, moved: false };
      return;
    }
    const showGraph = state.layout !== 'tree' && (state.layout !== 'split' || !inRect(view.rect, p));
    let onTree = state.layout !== 'graph' && !e.shiftKey && (state.layout === 'tree' || state.layout === 'split' ? inRect(view.rect, p) : view.isOnTree(p.x, p.y));
    if (state.layout === 'overlay' && state.focus !== 'auto') onTree = state.focus === 'tree';
    // The tree is in front: an opaque tree pixel takes the click. Shift reaches through it to the graph.
    if (onTree || !showGraph) {
      state.gesture = { kind: finger ? 'orbit-or-tap' : 'tree-tap', last: p, start: p, moved: false };
      return;
    }
    if (hit?.part === 'socket') { startWire(hit, p); return; }
    if (hit?.part === 'tab') {
      hit.node.tab = hit.node.tab === hit.tab ? null : hit.tab;
      if (!doc.sel.has(hit.node.id)) select([hit.node.id]);
      changed({ layout: true, rebuild: false });
      return;
    }
    if (hit?.part === 'fold') { hit.node.view = ((hit.node.view ?? 1) + 1) % 3; changed({ layout: true, rebuild: false }); commit(); return; }
    if (hit?.part === 'power') { hit.node.on = hit.node.on === false; changed(); commit(); return; }
    if (hit?.part === 'group') { startMove(hit.group.nodes.map(nodeById).filter(Boolean), p); select(hit.group.nodes); return; }
    if (hit?.part === 'link') { doc.sel = new Set(); doc.link = hit.link.id; emit('selection'); graph.invalidate(); return; }
    if (hit?.node) {
      const { node } = hit;
      if (hit.part === 'row' && !hit.row.linked && rowPress(hit, p)) {
        if (!doc.sel.has(node.id)) select([node.id]);
        if (finger && state.gesture?.kind === 'scrub') armLongPress(p, hit);
        graph.invalidate();
        return;
      }
      if (e.ctrlKey || e.metaKey) select([node.id], 'toggle');
      else if (e.shiftKey) select([node.id], 'add');
      else if (!doc.sel.has(node.id)) select([node.id]);
      startMove(selected(), p);
      state.gesture.clicked = !e.ctrlKey && !e.metaKey && !e.shiftKey ? node : null;
      if (finger) armLongPress(p);
      graph.invalidate();
      return;
    }
    if (finger) {
      state.gesture = { kind: 'pan', zone: 'graph', last: p, start: p, moved: false, tapClears: true };
      armLongPress(p);
      return;
    }
    state.gesture = { kind: 'box', start: p, mode: e.shiftKey ? 'add' : e.ctrlKey || e.metaKey ? 'toggle' : 'set' };
  }

  // A value's own menu from its row; the node's menu from its title bar; otherwise the add menu.
  function pressMenu(p, hit) {
    if (hit?.part === 'row' && hit.row.param && !hit.row.mod) ui.paramMenu(p, hit.node, hit.row, hit.zone);
    else if (hit?.node) ui.nodeMenu(p, hit.node);
    else ui.addMenu(p);
  }

  // Holding a finger still opens the same menu a right-click would.
  function armLongPress(p, hit = graph.hit(p.x, p.y)) {
    state.longPress = setTimeout(() => {
      if (state.gesture?.moved) return;
      state.gesture = null;
      pressMenu(p, hit);
    }, LONG_PRESS);
  }

  function startMove(nodes, p) {
    state.gesture = { kind: 'move', nodes, last: p, start: p, moved: false, offsets: nodes.map((n) => [n.x, n.y]) };
  }

  function startWire(hit, p) {
    const { node, sock } = hit;
    // Grabbing a connected input picks its wire up again, so it can be moved or dropped off.
    if (sock.dir === 'in' && !sock.multi) {
      const old = doc.graph.links.find((l) => l.to === node.id && l.toSock === sock.k);
      if (old) {
        const from = nodeById(old.from);
        removeLink(old.id);
        changed({ layout: true });
        const out = graph.layout(from).sockets.get(old.fromSock);
        beginWire(from, out, p);
        state.gesture.regrab = true;
        return;
      }
    }
    beginWire(node, sock, p);
  }

  function beginWire(node, sock, p) {
    const at = graph.socketPos(node, sock.k);
    graph.drag = { kind: sock.kind, also: sock.also, dir: sock.dir, nodeId: node.id, sockKey: sock.k, from: at, to: { x: at.x, y: at.y } };
    state.gesture = { kind: 'wire', node, sock, last: p };
    graph.invalidate();
  }

  const wireFits = (sock, d = graph.drag) => {
    if (sock.dir === d.dir) return false;
    return d.dir === 'out' ? kindFits(d.kind, sock) : kindFits(sock.kind, { kind: d.kind, also: d.also });
  };

  const scrubBy = (p, base, param, write, tap) => {
    state.gesture = { kind: 'scrub', start: p, base, param, write, tap, moved: false };
    return true;
  };

  // What a press on a value row does, by the part of the row under the pointer. Anywhere else on a row drags the node.
  function rowPress(hit, p) {
    const { node, row, zone } = hit;
    if (row.kind === 'add') { ui.edit.addMod(p, node, row.key, row.set); return true; }
    if (row.kind === 'mod') {
      if (zone === 'del') ui.edit.removeMod(node, row.key, row.mod);
      else if (zone === 'grip') {
        // Drag the pad up or down to move the modifier in its list, one row at a time.
        const list = node.params[row.key] || [];
        state.gesture = { kind: 'modmove', start: p, list, mod: row.mod, from: list.indexOf(row.mod), step: Math.max(8, (row.h || 22) * graph.z), moved: false };
      }
      else if (zone === 'check') ui.edit.toggleMod(row.mod);
      else ui.edit.foldMod(row.mod);
      return true;
    }
    if (zone === 'fold') {
      node.folds = { ...node.folds, [row.fold]: !row.open };
      changed({ layout: true, rebuild: false });
      return true;
    }
    const param = row.param;
    if (!param) return false;
    const { owner } = row;
    if (zone === 'var') {
      const write = (v, draft) => setRowValue(node, owner, 'vary', { ...owner.vary, [param.k]: v }, { draft });
      const edit = () => ui.edit.vary(p, node, owner, param);
      const range = { min: 0, max: param.abs || 100, int: !param.abs || param.abs > 2 };
      if (graph.varBox) return scrubBy(p, +owner.vary?.[param.k] || 0, range, write, () => ui.edit.number(p, `${param.l}: ±`, +owner.vary?.[param.k] || 0, range, write));
      edit();
      return true;
    }
    if (zone === 'curve') { ui.edit.curve(p, node, owner, param); return true; }
    // A number scrubs from anywhere on its row, name included; other kinds still drag the node by their name.
    if (zone !== 'box' && !(zone === 'label' && param.t === 'num')) return false;
    const write = (v, draft) => setRowValue(node, owner, param.k, v, { draft });
    switch (param.t) {
      case 'num':
        return scrubBy(p, +owner[param.k] || 0, param, write, () => ui.edit.number(p, param.l, +owner[param.k] || 0, param, write));
      case 'vec': {
        // Each of the three small boxes scrubs its own axis.
        const b = rowBox(row);
        const axis = Math.max(0, Math.min(2, Math.floor(((hit.lx - b[0]) / (b[1] - b[0])) * 3)));
        const put = (v, draft) => { const next = [...owner[param.k]]; next[axis] = v; write(next, draft); };
        return scrubBy(p, +owner[param.k]?.[axis] || 0, { step: 1 }, put, () => ui.edit.number(p, `${param.l} ${'XYZ'[axis]}`, +owner[param.k]?.[axis] || 0, { unit: param.unit }, put));
      }
      case 'bool': write(!owner[param.k]); commit(); return true;
      case 'toggles': {
        // The switch under the pointer flips; switching on one of an exclusive pair turns the other off.
        const b = rowBox(row);
        const o = param.opts[Math.max(0, Math.min(param.opts.length - 1, Math.floor(((hit.lx - b[0]) / (b[1] - b[0])) * param.opts.length)))];
        const on = new Set(String(owner[param.k] || 'none').split('+').filter((x) => x !== 'none'));
        if (on.has(o)) on.delete(o); else { on.add(o); if (param.excl?.includes(o)) for (const x of param.excl) if (x !== o) on.delete(x); }
        write(param.opts.filter((x) => on.has(x)).join('+') || 'none'); commit();
        return true;
      }
      case 'enum': ui.menu(p, param.opts.map((o) => ({ label: o, fn: () => { write(o); commit(); } }))); return true;
      case 'matref': ui.edit.material(p, node); return true;
      // The color square or the picture square of a material slot on a node.
      case 'matslot': {
        const b = rowBox(row);
        if (hit.lx > b[1] - (row.h - 4) - 2) ui.edit.texture(p, node, owner, { k: param.map, l: `${param.l.trim()} map`, t: 'texture' });
        else ui.edit.color(node, owner, { k: param.k, l: param.l.trim(), t: 'color' }, p);
        return true;
      }
      case 'cutpick': ui.edit.cutouts(p, node); return true;
      case 'color': ui.edit.color(node, owner, param, p); return true;
      case 'texture': case 'atlas': ui.edit.texture(p, node, owner, param); return true;
      case 'curve': ui.edit.curve(p, node, owner, param, false); return true;
      case 'gradient': case 'points': ui.edit.list(p, node, owner, param); return true;
      case 'obj': ui.edit.mesh(node, owner, param); return true;
      case 'ref': ui.edit.ref(p, node, owner, param); return true;
      case 'action': ui.action(param.act, node, p); return true;
      default: return false;
    }
  }

  function startPinch() {
    const [a, b] = [...pointers.values()];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    state.gesture = { kind: 'pinch', zone: zoneAt(mid), d: Math.hypot(a.x - b.x, a.y - b.y), mid };
  }

  function startStroke(p) {
    const { node } = state.draw;
    // The Draw tool's strokes start on the picked node's lines, or float in the view without one.
    const hit = state.draw.pen ? (state.draw.parentId ? view.pick(p.x, p.y, state.draw.parentId, 60) : null) : node.type === 'DrawPath' ? parentHit(node, p) : null;
    const through = hit ? { x: hit.point[0], y: hit.point[1], z: hit.point[2] } : view.orbit.target;
    state.draw.through = through;
    state.draw.anchor = hit ? view.strokeAnchor(hit) : null;
    const first = view.pointAt(p.x, p.y, through);
    state.draw.pts = first ? [first.toArray()] : [];
    state.gesture = { kind: 'stroke', last: p };
  }

  function parentHit(node, p) {
    const l = doc.graph.links.find((x) => x.to === node.id && x.toSock === 'parent');
    return l ? view.pick(p.x, p.y, l.from, 60) : null;
  }

  // ---- Move ----
  stage.addEventListener('pointermove', (e) => {
    const p = pos(e);
    state.mouse = p;
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { ...p, type: e.pointerType });
    const g = state.gesture;
    if (!g) { ui.gizmo?.pointer('hover', p); hoverUpdate(p, e); return; }
    switch (g.kind) {
      case 'gizmo': ui.gizmo.pointer('move', p); break;
      case 'orbit': view.orbitBy(p.x - g.last.x, p.y - g.last.y); g.last = p; break;
      case 'orbit-or-tap':
        if (Math.hypot(p.x - g.start.x, p.y - g.start.y) > TAP_MOVE) g.moved = true;
        if (g.moved) view.orbitBy(p.x - g.last.x, p.y - g.last.y);
        g.last = p;
        break;
      case 'tree-tap':
        if (Math.hypot(p.x - g.start.x, p.y - g.start.y) > TAP_MOVE) g.moved = true;
        // With the entity editor on, a drag on the plant draws a box that picks entities.
        if (g.moved && ui.gizmo?.on) { graph.box = { x0: Math.min(g.start.x, p.x), y0: Math.min(g.start.y, p.y), x1: Math.max(g.start.x, p.x), y1: Math.max(g.start.y, p.y) }; graph.invalidate(); }
        break;
      case 'pan': {
        const dx = p.x - g.last.x; const dy = p.y - g.last.y;
        if (Math.hypot(p.x - g.start.x, p.y - g.start.y) > TAP_MOVE) g.moved = true;
        if (g.moved) { if (g.zone === 'tree') view.panBy(dx, dy); else graph.panBy(dx, dy); }
        g.last = p;
        showZone(g.zone);
        break;
      }
      case 'move': {
        const dx = (p.x - g.start.x) / graph.z; const dy = (p.y - g.start.y) / graph.z;
        if (!g.moved && Math.hypot(p.x - g.start.x, p.y - g.start.y) < TAP_MOVE) break;
        if (!g.moved) { g.moved = true; clearTimeout(state.longPress); stage.classList.add('fade-tree'); }
        g.nodes.forEach((n, i) => {
          const x = g.offsets[i][0] + dx; const y = g.offsets[i][1] + dy;
          n.x = graph.snap ? Math.round(x / 25) * 25 : x;
          n.y = graph.snap ? Math.round(y / 25) * 25 : y;
        });
        graph.invalidate();
        break;
      }
      case 'wire': {
        const w = graph.toWorld(p.x, p.y);
        const hit = graph.hit(p.x, p.y);
        const fit = hit?.part === 'socket' && wireFits(hit.sock) && hit.node.id !== graph.drag.nodeId;
        graph.drag.to = fit ? graph.socketPos(hit.node, hit.sock.k) : w;
        graph.invalidate();
        break;
      }
      case 'scrub': {
        const dx = p.x - g.start.x;
        if (!g.moved && Math.abs(dx) < 3) break;
        g.moved = true;
        const { param } = g;
        const step = param.max !== undefined && param.min !== undefined ? (param.max - param.min) / 260 : Math.max(Math.abs(g.base) * 0.006, param.int ? 0.12 : 0.01);
        let v = g.base + dx * step * (e.shiftKey ? 0.15 : 1);
        if (param.int) v = Math.round(v);
        else v = +v.toFixed(3);
        if (param.min !== undefined) v = Math.max(param.min, v);
        if (param.max !== undefined) v = Math.min(param.max, v);
        g.write(v, true);
        break;
      }
      case 'modmove': {
        const to = Math.max(0, Math.min(g.list.length - 1, g.from + Math.round((p.y - g.start.y) / g.step)));
        const at = g.list.indexOf(g.mod);
        if (to !== at) { g.list.splice(at, 1); g.list.splice(to, 0, g.mod); g.moved = true; changed({ layout: true }); }
        break;
      }
      case 'box':
        graph.box = { x0: Math.min(g.start.x, p.x), y0: Math.min(g.start.y, p.y), x1: Math.max(g.start.x, p.x), y1: Math.max(g.start.y, p.y) };
        graph.invalidate();
        break;
      case 'pinch': {
        const list = [...pointers.values()];
        if (list.length < 2) break;
        const [a, b] = list;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const k = d / Math.max(g.d, 1);
        if (g.zone === 'tree') { view.zoomAt(mid.x, mid.y, 1 / k); view.panBy(mid.x - g.mid.x, mid.y - g.mid.y); }
        else { graph.zoomAt(mid.x, mid.y, k); graph.panBy(mid.x - g.mid.x, mid.y - g.mid.y); }
        g.d = d; g.mid = mid;
        break;
      }
      case 'stroke': {
        if (Math.hypot(p.x - g.last.x, p.y - g.last.y) < 6) break;
        g.last = p;
        const q = view.pointAt(p.x, p.y, state.draw.through);
        if (q) { state.draw.pts.push(q.toArray()); view.showPreview(state.draw.pts); }
        break;
      }
      default:
    }
  });

  let hoverRaf = 0;
  function hoverUpdate(p, e) {
    if (e.pointerType === 'touch' || hoverRaf) return;
    hoverRaf = requestAnimationFrame(() => {
      hoverRaf = 0;
      const m = state.mouse;
      showZone(e.shiftKey ? 'graph' : zoneAt(m));
      // No graph tooltips while the opaque tree is in the way, since a click there picks the tree.
      const blocked = state.layout === 'tree' || (state.layout === 'overlay' && state.focus === 'tree') || (state.layout === 'split' && inRect(view.rect, m))
        || (state.layout === 'overlay' && !e.shiftKey && view.isOnTree(m.x, m.y));
      ui.hoverTip(blocked ? null : describeHit(graph.hit(m.x, m.y)), m);
    });
  }

  // ---- Release ----
  function finish(e) {
    const p = pos(e);
    pointers.delete(e.pointerId);
    clearTimeout(state.longPress);
    const g = state.gesture;
    if (g?.kind === 'pinch') { if (pointers.size < 2) state.gesture = null; return; }
    state.gesture = null;
    stage.classList.remove('fade-tree');
    if (!g) return;
    switch (g.kind) {
      case 'tree-tap':
      case 'orbit-or-tap':
        if (g.moved && g.kind === 'tree-tap' && ui.gizmo?.on && graph.box) {
          const b = graph.box; graph.box = null; graph.invalidate();
          if (!ui.gizmo.pickBox(b, e.shiftKey)) ui.toast('No entities in that box. Pick the node, or draw the box around where branches and leaves start.');
          break;
        }
        if (!g.moved) {
          const hit = view.pick(p.x, p.y);
          ui.gizmo?.picked(hit, e.shiftKey);
          if (hit) { select([hit.nodeId], e.shiftKey ? 'add' : 'set'); graph.invalidate(); } else if (!e.shiftKey) select([]);
        }
        break;
      case 'pan':
        if (!g.moved) {
          if (g.tapClears) select([]);
          else if (g.zone === 'graph') pressMenu(p, graph.hit(p.x, p.y));
        }
        break;
      case 'move':
        if (g.moved) commit();
        else if (g.clicked && doc.sel.size > 1) select([g.clicked.id]);
        break;
      case 'wire': finishWire(g, p); break;
      case 'scrub':
        if (g.moved) { regenerate({ draft: false }); commit(); } else g.tap?.();
        break;
      case 'modmove': if (g.moved) commit(); break;
      case 'box': finishBox(g); break;
      case 'stroke': finishStroke(); break;
      case 'gizmo': ui.gizmo.pointer('up', p); break;
      default:
    }
  }
  stage.addEventListener('pointerup', finish);
  stage.addEventListener('pointercancel', finish);

  function finishWire(g, p) {
    const d = graph.drag;
    graph.drag = null;
    const hit = graph.hit(p.x, p.y);
    if (hit?.part === 'socket' && wireFits(hit.sock, d)) {
      const [a, as, b, bs] = d.dir === 'out' ? [g.node.id, g.sock.k, hit.node.id, hit.sock.k] : [hit.node.id, hit.sock.k, g.node.id, g.sock.k];
      const res = connect(a, as, b, bs);
      if (!res.ok) ui.toast(res.why);
      changed({ layout: true });
      commit();
      return;
    }
    if (!hit && !g.regrab) {
      // Dropped on empty space: offer only nodes that can plug into this wire.
      ui.addMenu(p, { kind: d.kind, dir: d.dir, node: g.node, sock: g.sock });
    } else if (g.regrab) { commit(); }
    graph.invalidate();
  }

  function finishBox(g) {
    const b = graph.box;
    graph.box = null;
    if (!b) { if (g.mode === 'set') select([]); graph.invalidate(); return; }
    const a = graph.toWorld(b.x0, b.y0); const c = graph.toWorld(b.x1, b.y1);
    const ids = doc.graph.nodes.filter((n) => { const l = graph.layout(n); return n.x < c.x && n.x + l.w > a.x && n.y < c.y && n.y + l.h > a.y; }).map((n) => n.id);
    select(ids, g.mode);
    graph.invalidate();
  }

  function finishStroke() {
    const d = state.draw;
    view.showPreview([]);
    if (d.pen) {
      // The first stroke makes a Spline under the picked node; the next ones join it until the tool is put down.
      if (d.pts.length < 2) return;
      const stroke = { pts: d.pts, ...(d.anchor || {}) };
      if (d.node && doc.graph.nodes.includes(d.node)) setRowValue(d.node, d.node.params, 'strokes', [...d.node.params.strokes, stroke]);
      else d.node = ui.drawnSpline(d.parentId, stroke, d.styleId);
      changed({ layout: true }); commit();
      return;
    }
    if (d.pts.length >= 2) {
      const strokes = [...(d.node.params.strokes || []), { pts: d.pts, ...(d.anchor || {}) }];
      setRowValue(d.node, d.node.params, 'strokes', strokes);
      commit();
    }
  }

  // ---- Keys ----
  addEventListener('keydown', (e) => {
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || '')) return;
    if (ui.modalOpen()) return;
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); redo(); return; }
    if (mod && k === 's') { e.preventDefault(); ui.save(); return; }
    if (mod && k === 'g') { e.preventDefault(); groupSelected(); return; }
    if (mod && k === 'a') { e.preventDefault(); select(doc.graph.nodes.map((n) => n.id)); graph.invalidate(); return; }
    if (mod && k === 'd') { e.preventDefault(); const ids = duplicate([...doc.sel]); select(ids); changed({ layout: true }); commit(); return; }
    if (mod && k === 'c') { copy(); return; }
    if (mod && k === 'v') { paste(); return; }
    if (mod) return;
    if (k === 'f') { frameUnderMouse(); e.preventDefault(); }
    else if (k === 'delete' || k === 'backspace' || k === 'x') { if (!(ui.gizmo?.on && ui.gizmo.removePicked())) removeSelection(); }
    else if (k === 'h') { for (const n of selected()) n.on = n.on === false; changed(); commit(); }
    else if (k === ' ') { e.preventDefault(); ui.addMenu(state.mouse); }
    else if (k === 'tab') { e.preventDefault(); ui.cycleLayout(); }
    else if (k === 'l') { ui.setMode(view.mode === 'mesh' ? 'lines' : 'mesh'); }
    else if (ui.gizmo?.on && 'qwer'.includes(k)) ui.xfMode({ q: 'all', w: 'translate', e: 'rotate', r: 'scale' }[k]);
    else if (k === 'escape') { if (state.draw) stopDraw(); else select([]); graph.invalidate(); }
  });

  function frameUnderMouse() {
    const zone = zoneAt(state.mouse);
    const nodes = selected();
    if (zone === 'tree') {
      const b = nodes.length ? view.boxOf([...doc.sel]) : null;
      if (b) view.frameBox(b); else view.frameAll();
    } else {
      // Frames beside the tree, not behind it.
      graph.frameNodes(nodes.length ? nodes : doc.graph.nodes, ui.graphRegion(), false, nodes.length ? 1.25 : 1);
    }
    ui.toast(zone === 'tree' ? (nodes.length ? 'Framed the selected node in the 3D view' : 'Framed the whole tree') : (nodes.length ? 'Framed the selected node in the graph' : 'Framed the whole graph'), 1200);
  }

  function removeSelection() {
    if (doc.link) { removeLink(doc.link); changed({ layout: true }); commit(); graph.invalidate(); return; }
    if (!doc.sel.size) return;
    removeNodes([...doc.sel]);
    emit('selection');
    changed({ layout: true });
    commit();
  }

  function copy() {
    const ids = new Set(doc.sel);
    if (!ids.size) return;
    state.clip = JSON.stringify({ nodes: selected(), links: doc.graph.links.filter((l) => ids.has(l.from) && ids.has(l.to)) });
  }

  function paste() {
    if (!state.clip) return;
    const { nodes, links } = JSON.parse(state.clip);
    const w = graph.toWorld(state.mouse.x, state.mouse.y);
    const x0 = Math.min(...nodes.map((n) => n.x)); const y0 = Math.min(...nodes.map((n) => n.y));
    select(mergeNodes(nodes, links, w.x - x0, w.y - y0));
    changed({ layout: true });
    commit();
  }

  // The Draw tool: strokes in the 3D view become a Spline under the picked node (or on its own).
  function startPen(parentId, styleId = null) { state.draw = { pen: true, parentId, styleId, node: null, pts: [] }; stage.classList.add('drawing'); if (!styleId) ui.toast('Draw in the 3D view. Press Esc or the Draw button again when you are done.', 3500); }
  function startDraw(node) { state.draw = { node, pts: [] }; stage.classList.add('drawing'); ui.toast('Draw in the 3D view. Press Esc when you are done.', 3000); }
  function stopDraw() { state.draw = null; stage.classList.remove('drawing'); view.showPreview([]); ui.onDrawStop?.(); }

  return {
    state,
    setFocus(f) { state.focus = f; shownZone = null; },
    setLayout(l) {
      state.layout = l;
      shownZone = null;
      if (l === 'tree' || l === 'graph') showZone(l);
    },
    frameUnderMouse, removeSelection, startDraw, stopDraw, startPen,
  };
}
