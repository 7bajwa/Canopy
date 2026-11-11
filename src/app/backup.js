// Saving backups while you work. The desktop app writes dated files beside the first save; the web version downloads them.
export const stamp = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
};

export function makeBackups({ text, download, name, toast, app = globalThis.canopyApp }) {
  let timer = 0;
  let last = '';
  // With a store, backups go there quietly instead of beside a first save.
  let quiet = null;

  async function firstSave() {
    const body = text();
    if (app) {
      const saved = await app.saveAs(`${name()}.canopy`, body);
      if (!saved) return false;
    } else download(`${name()}.canopy`, body);
    last = body;
    return true;
  }

  async function tick() {
    const body = text();
    // Nothing new since the last one means no pile of identical files.
    if (body === last) return;
    last = body;
    try {
      if (quiet) { await quiet(stamp(), body); return; }
      if (app) await app.backup(stamp(), body, name());
      else download(`${name()} ${stamp()}.canopy`, body);
      toast(`Backup saved at ${new Date().toLocaleTimeString()}.`, 1800);
    } catch (e) {
      console.error(e);
      toast('The backup could not be saved. Save the file by hand to keep your work.', 6000);
    }
  }

  return {
    startQuiet(minutes, store) {
      quiet = store;
      clearInterval(timer);
      timer = setInterval(tick, Math.max(0.25, minutes) * 60000);
    },
    async start(minutes) {
      if (!await firstSave()) return false;
      quiet = null;
      clearInterval(timer);
      timer = setInterval(tick, Math.max(0.25, minutes) * 60000);
      return true;
    },
    setInterval(minutes) {
      if (!timer) return;
      clearInterval(timer);
      timer = setInterval(tick, Math.max(0.25, minutes) * 60000);
    },
    stop() { clearInterval(timer); timer = 0; },
    running: () => !!timer,
    tick,
  };
}
