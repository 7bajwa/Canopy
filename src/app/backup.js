// Backups while you work: every few minutes, while the plant changes, a dated copy goes to the Canopy project folder.
// A plant never saved is Canopy-YYMMDD_HHMM.canopy; a saved one is <its name>_YYMMDD_HHMM.canopy.
export const stamp = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
};

export const backupName = (saved, name, when = stamp()) => (saved ? `${name}_${when}.canopy` : `Canopy-${when}.canopy`);

// write(fileName, stampText, body) puts it wherever this platform keeps backups.
export function makeBackups({ text, write, toast }) {
  let timer = 0;
  let last = '';

  async function tick() {
    const body = text();
    // Nothing new since the last one means no pile of identical files.
    if (body === last) return;
    try {
      if (await write(stamp(), body) === false) return;
      last = body;
      toast(`Backup saved at ${new Date().toLocaleTimeString()}.`, 1800);
    } catch (e) {
      console.error(e);
      toast('The backup could not be saved. Save the file by hand to keep your work.', 6000);
    }
  }

  return {
    start(minutes) {
      clearInterval(timer);
      timer = setInterval(tick, Math.max(0.25, minutes) * 60000);
    },
    setInterval(minutes) { if (timer) this.start(minutes); },
    stop() { clearInterval(timer); timer = 0; },
    running: () => !!timer,
    tick,
  };
}
