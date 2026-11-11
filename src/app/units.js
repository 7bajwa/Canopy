// Lengths are always stored in centimeters. This only changes how they read and how typed values are understood.
let system = 'metric';
export const setUnits = (s) => { system = s; };
export const unitSystem = () => system;

const trim = (v, digits) => String(+v.toFixed(digits));

export function showLength(cm) {
  if (system !== 'imperial') return `${trim(cm, Math.abs(cm) < 10 ? 2 : 1)} cm`;
  const inches = cm / 2.54;
  if (Math.abs(inches) < 12) return `${trim(inches, 2)}"`;
  const sign = inches < 0 ? '-' : '';
  let ft = Math.floor(Math.abs(inches) / 12);
  let rest = +(Math.abs(inches) - ft * 12).toFixed(1);
  if (rest >= 12) { ft += 1; rest = 0; }
  return `${sign}${ft}' ${rest}"`;
}

// Accepts 180, 180cm, 1.8m, 5'11", 5 ft 11 in, 71in. A bare number means the current system's small unit.
export function parseLength(text) {
  const s = String(text).trim().toLowerCase().replace(',', '.');
  const num = '(-?\\d*\\.?\\d+)';
  let m = s.match(new RegExp(`^${num}\\s*(?:'|ft|feet)\\s*(?:${num}\\s*(?:"|in|inch|inches)?)?$`));
  if (m) { const ft = +m[1]; const inch = +(m[2] || 0); return (ft * 12 + (ft < 0 ? -inch : inch)) * 2.54; }
  m = s.match(new RegExp(`^${num}\\s*(cm|m|mm|"|in|inch|inches)?$`));
  if (!m) return NaN;
  const v = +m[1];
  switch (m[2]) {
    case 'cm': return v;
    case 'm': return v * 100;
    case 'mm': return v / 10;
    case '"': case 'in': case 'inch': case 'inches': return v * 2.54;
    default: return system === 'imperial' ? v * 2.54 : v;
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
