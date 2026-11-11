// Small form parts shared by the pop-ups, Settings and the cutout editor.
export const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

// A number field: drag the label to scrub, type in the box, arrows to nudge. toText and fromText change how it reads, not what it stores.
export function numberField(label, value, opts, onChange, onDone) {
  const row = el('div', 'field num');
  const lab = el('label', '', label);
  const box = el('div', 'num-box');
  const fill = el('div', 'num-fill');
  const input = el('input');
  input.type = 'text';
  input.inputMode = opts.toText ? 'text' : 'decimal';
  input.setAttribute('aria-label', label);
  const { min, max, unit, int: isInt, toText, fromText } = opts;
  const ranged = min !== undefined && max !== undefined;
  let cur = +value;
  const show = () => {
    input.value = toText ? toText(cur) : `${Number.isInteger(cur) ? cur : +cur.toFixed(3)}`;
    if (ranged) fill.style.width = `${((cur - min) / (max - min || 1)) * 100}%`;
  };
  const clampV = (v) => {
    if (isInt) v = Math.round(v);
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    return v;
  };
  const set = (v, draft) => { cur = clampV(v); show(); onChange(cur, draft); };
  const commitTyped = () => {
    const v = fromText ? fromText(input.value) : parseFloat(input.value.replace(',', '.'));
    if (Number.isFinite(v)) { set(v, false); onDone?.(); } else show();
  };
  input.addEventListener('change', commitTyped);
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { input.blur(); }
    if (e.key === 'Escape') { show(); input.blur(); }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const step = isInt ? 1 : ranged ? (max - min) / 100 : Math.max(Math.abs(cur) * 0.05, 0.1);
      set(cur + (e.key === 'ArrowUp' ? step : -step) * (e.shiftKey ? 10 : 1), false);
      onDone?.();
    }
  });
  const scrub = (e, target) => {
    e.preventDefault();
    target.setPointerCapture(e.pointerId);
    const x0 = e.clientX; const base = cur;
    const step = ranged ? (max - min) / 240 : Math.max(Math.abs(base) * 0.006, isInt ? 0.12 : 0.01);
    let moved = false;
    const move = (ev) => {
      if (Math.abs(ev.clientX - x0) > 2) moved = true;
      if (moved) set(base + (ev.clientX - x0) * step * (ev.shiftKey ? 0.15 : 1), true);
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      if (moved) { onChange(cur, false); onDone?.(); }
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };
  lab.addEventListener('pointerdown', (e) => scrub(e, lab));
  lab.style.touchAction = 'none';
  box.append(fill, input);
  if (unit && !toText) box.append(el('span', 'unit', unit));
  row.append(lab, box);
  show();
  return row;
}

export function checkField(label, value, fn) {
  const row = el('label', 'field check');
  const box = el('input'); box.type = 'checkbox'; box.checked = value;
  box.addEventListener('change', () => fn(box.checked));
  row.append(box, el('span', '', label));
  return row;
}

export function selectField(label, value, options, fn) {
  const row = el('div', 'field');
  row.append(el('label', '', label));
  const pick = el('select');
  pick.setAttribute('aria-label', label);
  for (const [v, text] of options) { const o = el('option', '', text); o.value = v; pick.append(o); }
  pick.value = value;
  pick.addEventListener('change', () => fn(pick.value));
  row.append(pick);
  return row;
}

// Color stops along a length. redraw is called when stops are added or removed.
export function gradientEditor(stopsIn, set, done, redraw) {
  const box = el('div', 'list');
  const stops = (stopsIn || []).map((s) => [...s]);
  stops.forEach((s, i) => {
    const row = el('div', 'list-row');
    row.append(numberField('Pos', s[0], { min: 0, max: 1 }, (x, d) => { stops[i][0] = x; set(stops.map((a) => [...a]), d); }, done));
    const c = el('input'); c.type = 'color'; c.value = s[1];
    c.setAttribute('aria-label', 'Stop color');
    c.addEventListener('input', () => { stops[i][1] = c.value; set(stops.map((a) => [...a]), true); });
    c.addEventListener('change', () => { stops[i][1] = c.value; set(stops.map((a) => [...a])); done(); });
    const del = el('button', 'mini', '×');
    del.setAttribute('aria-label', 'Remove stop');
    del.addEventListener('click', () => { if (stops.length > 1) { stops.splice(i, 1); set(stops); done(); redraw(); } });
    row.append(c, del);
    box.append(row);
  });
  const add = el('button', 'mini', 'Add stop');
  add.addEventListener('click', () => { stops.push([1, '#ffffff']); set(stops); done(); redraw(); });
  box.append(add);
  return box;
}

export function pointsEditor(listIn, set, done, redraw) {
  const box = el('div', 'list');
  const list = (listIn || []).map((s) => [...s]);
  list.forEach((pt, i) => {
    const row = el('div', 'list-row');
    ['X', 'Y', 'Z'].forEach((a, k) => row.append(numberField(a, pt[k], {}, (x, d) => { list[i][k] = x; set(list.map((q) => [...q]), d); }, done)));
    const del = el('button', 'mini', '×');
    del.setAttribute('aria-label', 'Remove point');
    del.addEventListener('click', () => { list.splice(i, 1); set(list); done(); redraw(); });
    row.append(del);
    box.append(row);
  });
  const add = el('button', 'mini', 'Add point');
  add.addEventListener('click', () => { list.push([0, 0, 0]); set(list); done(); redraw(); });
  box.append(add);
  return box;
}
