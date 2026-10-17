// 0.3.9.18: the copy of the game opened from the disk (index.html from a release) asks GitHub, twice a day at most,
// whether a newer version was published. If so, the opening screen and the top bar offer it, with the notes of every
// version since this one, in French or in English. Only the local copy asks (the online game is always the latest one,
// and a page inside claude.ai cannot reach GitHub); the check can be turned off in « Affichage et son ». It reads the
// public list of releases and sends nothing.
import { useEffect, useState } from 'preact/hooks';
import { VERSION } from './version';
import { LANG } from '../i18n';
import { uiPrefs } from './prefs';

export const REPO = 'IntelligentRebel/constellations';
export const RELEASES_URL = `https://github.com/${REPO}/releases`;
export const ONLINE_URL = 'https://intelligentrebel.github.io/constellations/';
export interface ReleaseInfo { version: string; date: string; body: string; page: string; html?: string; zip?: string; htmlSize?: number }

const KEY = 'constellations.update';
const EVERY = 12 * 3600 * 1000;

export const isLocalCopy = () => typeof location !== 'undefined' && location.protocol === 'file:';

/** Compares two versions number by number ("0.3.9.18" > "0.3.9.9"). */
export function cmpVersion(a: string, b: string): number {
  const x = a.split('.').map(n => parseInt(n, 10) || 0), y = b.split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return d; }
  return 0;
}

/** The published releases (newest first), from the answer of the GitHub API. */
export function parseReleases(list: unknown): ReleaseInfo[] {
  if (!Array.isArray(list)) return [];
  return list.filter(r => r && !r.draft && !r.prerelease && /^v?\d+(\.\d+)*$/.test(r.tag_name ?? '')).map(r => {
    const assets: { name: string; browser_download_url: string; size: number }[] = Array.isArray(r.assets) ? r.assets : [];
    const html = assets.find(a => /\.html$/i.test(a.name)), zip = assets.find(a => /\.zip$/i.test(a.name));
    return { version: String(r.tag_name).replace(/^v/, ''), date: String(r.published_at ?? ''), body: String(r.body ?? ''), page: String(r.html_url ?? RELEASES_URL), html: html?.browser_download_url, zip: zip?.browser_download_url, htmlSize: html?.size };
  }).sort((a, b) => cmpVersion(b.version, a.version));
}

const FR_PART = /<details>\s*<summary>\s*En français\s*<\/summary>([\s\S]*?)<\/details>/i;
/**
 * The notes of a release in the player's language (the French part for French, the English one otherwise), from its
 * first heading on, without the lines on where to play and download (the dialog gives them).
 */
export function releaseNotes(body: string, lang: string = LANG): string {
  const fr = body.match(FR_PART);
  const text = (lang === 'fr' && fr ? fr[1] : body.replace(FR_PART, '')).replace(/\r/g, '');
  const lines = text.split('\n');
  const start = lines.findIndex(l => /^#{2,3}\s/.test(l));
  return (start >= 0 ? lines.slice(start) : lines)
    .filter(l => !/^(\*\*Play in your browser|\*\*Jouer dans le navigateur|Or download|Ou téléchargez|The full history|L'historique complet|Created with the help|Créé avec l'aide)/i.test(l.trim()))
    .join('\n').trim();
}

interface Cache { checked: number; releases: ReleaseInfo[] }
function readCache(): Cache | null {
  try { const c = JSON.parse(localStorage.getItem(KEY) ?? 'null'); return c && Array.isArray(c.releases) ? c : null; } catch { return null; }
}
function writeCache(c: Cache) { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* private mode */ } }

let newer: ReleaseInfo[] = [];
let checking = false;
const listeners = new Set<() => void>();
function publish(list: ReleaseInfo[]) {
  newer = list.filter(r => cmpVersion(r.version, VERSION) > 0);
  for (const f of listeners) f();
}
/** The versions published since this one, newest first (empty when up to date or not checked). */
export const newerReleases = () => newer;

/** Asks GitHub (at most twice a day, or now with force); the answer is kept for the next launches. */
export async function checkForUpdate(force = false): Promise<ReleaseInfo[] | null> {
  if (!isLocalCopy() || VERSION === 'dev' || checking) return newer;
  if (!force && uiPrefs.checkUpdates === false) return newer;
  const cache = readCache();
  if (cache) publish(cache.releases);
  if (!force && cache && Date.now() - cache.checked < EVERY) return newer;
  checking = true;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) return null;
    const list = parseReleases(await r.json());
    writeCache({ checked: Date.now(), releases: list.filter(x => cmpVersion(x.version, VERSION) > 0).slice(0, 20) });
    publish(list);
    return newer;
  } catch { return null; } finally { checking = false; }
}

/** The newer releases, kept up to date in a component. */
export function useUpdate(): ReleaseInfo[] {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick(n => n + 1); listeners.add(f); return () => { listeners.delete(f); }; }, []);
  return newer;
}
