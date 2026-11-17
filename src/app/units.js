// Lengths are always stored in centimeters. This only changes how they read and how typed values are understood.
// system: metric or imperial. unit: m, cm or mm in metric; dec (decimal inches) or frac (fractions) in imperial.
let system = 'metric';
let unit = 'cm';
export const setUnits = (s, u) => { system = s; unit = u || (s === 'imperial' ? 'dec' : 'cm'); if (s === 'imperial' ? !['dec', 'frac'].includes(unit) : !['m', 'cm', 'mm'].includes(unit)) unit = s === 'imperial' ? 'dec' : 'cm'; };
export const unitSystem = () => system;
export const lengthUnit = () => unit;

const trim = (v, digits) => String(+v.toFixed(digits));
const METRIC = { m: 100, cm: 1, mm: 0.1 };

// Inches as a whole and a sixteenth-or-coarser fraction: 3 1/2.
function fraction(inches) {
  const n = Math.round(Math.abs(inches) * 16);
  let whole = Math.floor(n / 16); let part = n % 16; let den = 16;
  while (part && part % 2 === 0) { part /= 2; den /= 2; }
  const text = part ? (whole ? `${whole} ${part}/${den}` : `${part}/${den}`) : `${whole}`;
  return (inches < 0 && n ? '-' : '') + text;
}

// bare: no unit after a metric number (where the unit shows elsewhere).
export function showLength(cm, bare = false) {
  if (system !== 'imperial') {
    const v = cm / METRIC[unit];
    const digits = unit === 'm' ? (Math.abs(v) < 10 ? 3 : 2) : unit === 'mm' ? (Math.abs(v) < 10 ? 1 : 0) : (Math.abs(v) < 10 ? 2 : 1);
    return bare ? trim(v, digits) : `${trim(v, digits)} ${unit}`;
  }
  const inches = cm / 2.54;
  const inch = (x) => (unit === 'frac' ? fraction(x) : trim(x, Math.abs(x) < 12 ? 2 : 1));
  if (Math.abs(inches) < 12) return `${inch(inches)}"`;
  const sign = inches < 0 ? '-' : '';
  let ft = Math.floor(Math.abs(inches) / 12);
  let rest = unit === 'frac' ? Math.round((Math.abs(inches) - ft * 12) * 16) / 16 : +(Math.abs(inches) - ft * 12).toFixed(1);
  if (rest >= 12) { ft += 1; rest = 0; }
  return `${sign}${ft}' ${inch(rest)}"`;
}

// A number, a fraction (3/4) or a whole and a fraction (5 1/2).
const val = (t) => {
  const [a, b] = String(t).trim().split(/\s+/);
  const f = (x) => (x.includes('/') ? x.split('/').reduce((p, q) => +p / +q) : +x);
  return b ? Math.sign(f(a) || 1) * (Math.abs(f(a)) + f(b)) : f(a);
};

// Accepts 180, 180cm, 1.8m, 5'11", 5 ft 11 in, 71in. A bare number means the current system's small unit.
export function parseLength(text) {
  const s = String(text).trim().toLowerCase().replace(',', '.');
  const num = '(-?\\d*\\.?\\d+(?:\\s+\\d+/\\d+)?|-?\\d+/\\d+)';
  let m = s.match(new RegExp(`^${num}\\s*(?:'|ft|feet)\\s*(?:${num}\\s*(?:"|in|inch|inches)?)?$`));
  if (m) { const ft = val(m[1]); const inch = val(m[2] || '0'); return (ft * 12 + (ft < 0 ? -inch : inch)) * 2.54; }
  m = s.match(new RegExp(`^${num}\\s*(cm|m|mm|"|in|inch|inches)?$`));
  if (!m) return NaN;
  const v = val(m[1]);
  switch (m[2]) {
    case 'cm': return v;
    case 'm': return v * 100;
    case 'mm': return v / 10;
    case '"': case 'in': case 'inch': case 'inches': return v * 2.54;
    default: return system === 'imperial' ? v * 2.54 : v * METRIC[unit];
  }
}

// Marks for a ruler up to a height, by its size: every 10 cm up to 2 m, every metre up to 10 m, then every 5 m
// (6 inches, 3 feet and 15 feet in feet and inches).
export function rulerMarks(heightCm) {
  const steps = system === 'imperial' ? [15.24, 91.44, 457.2] : [10, 100, 500];
  const step = heightCm <= 200 ? steps[0] : heightCm <= 1000 ? steps[1] : steps[2];
  const marks = [];
  for (let k = 0; k * step <= heightCm * 1.0001; k++) marks.push(k * step);
  return marks;
}
