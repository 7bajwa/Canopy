// Updates from the GitHub releases (Settings → System → Updates). The PC app downloads the new Windows build and
// installs it over itself, then restarts; the Android app opens the new APK to install; the website reloads, since
// the site is always the newest build.
/* global __APP_VERSION__ */
const REPO = '7bajwa/Canopy';
export const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0';

// True when version a is newer than b ("0.46" vs "0.45.0").
export function isNewer(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

async function latest() {
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
  const j = await r.json();
  const asset = (re) => j.assets?.find((a) => re.test(a.name))?.browser_download_url || null;
  return { version: String(j.tag_name || '').replace(/^v/, ''), page: j.html_url, win: asset(/win32-x64.*\.zip$/i), apk: asset(/\.apk$/i) };
}

const platform = () => (window.canopyApp?.update ? 'pc' : window.Capacitor?.isNativePlatform?.() ? 'android' : 'web');

// auto: install without asking. manual: say so when it is already the newest, or when the check fails.
export async function checkForUpdate({ auto = false, manual = false, toast, okToLeave = () => true }) {
  let rel;
  try { rel = await latest(); } catch (e) { if (manual) toast(`Could not check for updates: ${e.message}`, 5000); return false; }
  if (!isNewer(rel.version, VERSION)) { if (manual) toast(`Canopy ${VERSION} is the newest version.`); return false; }
  const where = platform();
  const ask = (what) => auto || confirm(`Canopy ${rel.version} is out (you have ${VERSION}). ${what}`);
  if (where === 'pc') {
    if (!rel.win) { toast(`Canopy ${rel.version} is out: ${rel.page}`, 8000); return true; }
    if (!ask('Download and install it now? Canopy restarts when it is done.') || !okToLeave()) return true;
    toast(`Downloading Canopy ${rel.version}…`, 4000);
    window.canopyApp.onUpdateProgress?.((p) => toast(`Downloading Canopy ${rel.version}: ${Math.round(p * 100)}%`, 2000));
    const res = await window.canopyApp.update(rel.win);
    if (res !== true) toast(`The update could not be installed: ${res}`, 8000);
    return true;
  }
  if (where === 'android') {
    if (ask('Download the new app? Android asks you to install it.')) window.open(rel.apk || rel.page, '_system');
    return true;
  }
  if (ask('Reload to use it?') && okToLeave()) location.reload();
  return true;
}
