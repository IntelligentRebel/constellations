// Constellations i18n runtime. The sources are written in French; at build time every player-visible French text is
// rewritten into __t("texte") / __tf("texte {0}", [x]) (scripts/i18n-core.mjs), and these look the text up in the
// catalogue of the player's language (i18n/<lang>.json, compressed into the page). French needs no catalogue; a text
// missing from a catalogue falls back to English, then to French. The language is chosen once per page load (browser
// language, or the player's choice remembered in this browser).
import { inflateSync, strFromU8 } from 'fflate';

declare const __I18N__: Record<string, string> | undefined;

export interface LangInfo { id: string; name: string; locale: string }
/** English first (the default), then by number of players. */
export const LANGS: LangInfo[] = [
  { id: 'en', name: 'English', locale: 'en-US' },
  { id: 'zh', name: '简体中文', locale: 'zh-CN' },
  { id: 'de', name: 'Deutsch', locale: 'de-DE' },
  { id: 'es', name: 'Español', locale: 'es-ES' },
  { id: 'pt', name: 'Português', locale: 'pt-BR' },
  { id: 'ru', name: 'Русский', locale: 'ru-RU' },
  { id: 'fr', name: 'Français', locale: 'fr-FR' },
  { id: 'ja', name: '日本語', locale: 'ja-JP' },
  { id: 'ko', name: '한국어', locale: 'ko-KR' },
  { id: 'it', name: 'Italiano', locale: 'it-IT' },
  { id: 'pl', name: 'Polski', locale: 'pl-PL' },
];
const KEY = 'constellations.lang';
const available = (id: string) => id === 'fr' || (typeof __I18N__ !== 'undefined' && !!__I18N__[id]);

function detect(): string {
  try { const v = localStorage.getItem(KEY); if (v && LANGS.some(l => l.id === v) && available(v)) return v; } catch { /* ignore */ }
  const nav = typeof navigator !== 'undefined' ? (navigator.languages?.length ? navigator.languages : [navigator.language]) : [];
  for (const n of nav) {
    const base = (n || '').toLowerCase().split(/[-_]/)[0];
    if (LANGS.some(l => l.id === base) && available(base)) return base;
  }
  return available('en') ? 'en' : 'fr';
}

/** The language of this page load. */
export const LANG = detect();
export const LOCALE = LANGS.find(l => l.id === LANG)?.locale ?? 'fr-FR';
const DEC = (1.5).toLocaleString(LOCALE).charAt(1) || ',';

function load(id: string): Record<string, string> | null {
  if (id === 'fr' || typeof __I18N__ === 'undefined' || !__I18N__[id]) return null;
  try {
    const bin = Uint8Array.from(atob(__I18N__[id]), c => c.charCodeAt(0));
    return JSON.parse(strFromU8(inflateSync(bin)));
  } catch { return null; }
}
const CAT = load(LANG);
const FALLBACK = LANG !== 'en' && LANG !== 'fr' ? load('en') : null;

function lookup(s: string): string { return CAT?.[s] ?? FALLBACK?.[s] ?? s; }

/** "{0}" is an argument; "{1?s}" prints "s" when argument 1 is not empty (plural endings), "{1?a|b}" a or b. */
export function format(f: string, a: unknown[]): string {
  return f.replace(/\{(\d+)(\?([^}|]*)(?:\|([^}]*))?)?\}/g, (_m, i, cond, yes, no) => {
    const v = a[+i];
    if (cond === undefined) return String(v);
    return v !== '' && v !== 0 && v !== false && v !== null && v !== undefined && v !== '0' ? yes : (no ?? '');
  });
}
/** JSX children: the inner elements and values take the place of their placeholders (an array Preact renders). */
export function tj(s: string, a: unknown[]): unknown[] {
  const f = lookup(s), out: unknown[] = [];
  let last = 0;
  f.replace(/\{(\d+)(\?([^}|]*)(?:\|([^}]*))?)?\}/g, (m: string, i: string, cond: string | undefined, yes: string, no: string | undefined, off: number) => {
    out.push(f.slice(last, off));
    last = off + m.length;
    const v = a[+i];
    out.push(cond === undefined ? v : v !== '' && v !== 0 && v !== false && v !== null && v !== undefined && v !== '0' ? yes : (no ?? ''));
    return m;
  });
  out.push(f.slice(last));
  return out;
}
export const t = (s: string) => lookup(s);
export const tf = (s: string, a: unknown[]) => format(lookup(s), a);

/** Switches the language: remembered in this browser, applied at the next page load. */
export function setLang(id: string) {
  try { localStorage.setItem(KEY, id); } catch { /* ignore */ }
}
export const langAvailable = available;

const G = globalThis as unknown as Record<string, unknown>;
G.__t = t; G.__tf = tf; G.__tj = tj; G.__loc = () => LOCALE; G.__dec = () => DEC;
if (typeof document !== 'undefined') document.documentElement.lang = LANG;
