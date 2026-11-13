// The Age & Season panel: three sliders for the whole plant (see engine/life.js). It floats, so you can scrub a
// slider and watch the plant grow, turn and wither; Variations keep the values with everything else.
import { doc, regenerate, commit } from './doc.js';
import { el, numberField, checkField } from './fields.js';
import { floatPanel } from './floatpanel.js';
import { LIFE_DEFAULTS } from '../engine/life.js';

const SEASONS = [[0.08, 'Spring'], [0.25, 'Summer'], [0.62, 'Autumn'], [0.85, 'Winter']];
const seasonName = (s) => (s < 0.12 || s >= 0.95 ? 'Spring' : s < 0.4 ? 'Summer' : s < 0.68 ? 'Autumn' : 'Winter');
const ageName = (a) => (a < 0.25 ? 'Seedling' : a < 0.6 ? 'Young' : a < 0.95 ? 'Growing' : a <= 1.05 ? 'Mature' : a < 1.3 ? 'Old' : 'Elder');

export function makeLife() {
  let panel = null;
  const life = () => (doc.graph.settings.life ||= { ...LIFE_DEFAULTS });

  function set(k, v, draft) {
    const L = life();
    L[k] = v;
    if (k !== 'on') L.on = true;
    regenerate({ draft });
    if (!draft) { commit(); draw(); }
  }

  function draw() {
    if (!panel) return;
    const L = { ...LIFE_DEFAULTS, ...life() };
    const seasons = el('div', 'row-buttons');
    for (const [v, name] of SEASONS) {
      const b = el('button', 'mini', name);
      b.classList.toggle('on', seasonName(L.season) === name);
      b.addEventListener('click', () => set('season', v, false));
      seasons.append(b);
    }
    const ages = el('div', 'row-buttons');
    for (const [v, name] of [[0.15, 'Seedling'], [0.5, 'Young'], [1, 'Mature'], [1.4, 'Elder']]) {
      const b = el('button', 'mini', name);
      b.classList.toggle('on', ageName(L.age) === name);
      b.addEventListener('click', () => set('age', v, false));
      ages.append(b);
    }
    const reset = el('button', 'wide', 'Back to as designed');
    reset.addEventListener('click', () => { Object.assign(life(), { age: 1, season: 0.25, health: 1 }); regenerate(); commit(); draw(); });
    panel.body.replaceChildren(
      checkField('Use Age, Season and Health', !!L.on, (v) => set('on', v, false)),
      numberField(`Age · ${ageName(L.age)}`, L.age, { min: 0.05, max: 1.5 }, (v, d) => set('age', v, d)),
      ages,
      numberField(`Season · ${seasonName(L.season)}`, L.season, { min: 0, max: 1 }, (v, d) => set('season', v, d)),
      seasons,
      numberField('Health', L.health, { min: 0, max: 1 }, (v, d) => set('health', v, d)),
      numberField('Fallen leaves', L.fallen, { min: 0, max: 1 }, (v, d) => set('fallen', v, d)),
      numberField('Snow', L.snow, { min: 0, max: 1 }, (v, d) => set('snow', v, d)),
      el('h4', 'section', 'Growth timing'),
      numberField('Level delay', L.levelDelay, { min: 0, max: 0.4 }, (v, d) => set('levelDelay', v, d)),
      numberField('Base-to-tip delay', L.spread, { min: 0, max: 0.5 }, (v, d) => set('spread', v, d)),
      el('p', 'hint', 'Age 1 and Season Summer are the plant as you built it. Younger: each level starts later and lines grow from the base. Older: thicker, some branches wither. Autumn turns each leaf on its own day; winter is bare. Low health withers branches and thins and yellows leaves. Save a Variation to keep a stage.'),
      reset,
    );
  }

  return {
    open() { panel ||= floatPanel('life', 'Age & season', { width: 340 }); draw(); panel.show(); },
    refresh: draw,
  };
}
