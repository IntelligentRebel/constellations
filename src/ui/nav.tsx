// Navigation helpers: jump to the object a report talks about, and report text with clickable names.
import type { ComponentChildren } from 'preact';
import { store, type ObjRef } from './store';
import type { GameState, Message, Player } from '../engine/types';
import { refPos } from './map';
import { knownAnomalies, defOf } from '../engine/anomalies';
import { RELICS } from '../engine/relics';
import { TECH_DATA } from '../data/techs';
import { HULL_DATA } from '../data/hulls';
import { tl } from '../data/labels';
import { capitalOf } from '../engine/empire';

type Target = NonNullable<Message['target']>;
/** Report targets plus interface-only ones (a technology of the catalogue). */
export type NavTarget = Target | { kind: ObjRef['kind']; id: number; x?: number; y?: number } | { kind: 'tech'; id: number; name: string } | { kind: 'empire'; id: number; section?: string };

/** Scrolls a section of the page into view once the page is drawn. */
function scrollTo(id: string) { setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80); }

/** Opens what a message refers to: map object, battle replay, research, diplomacy, discoveries, catalogue… */
export function gotoTarget(t: NavTarget) {
  const s = store, g = s.game, me = s.me;
  if (!g || !me) return;
  switch (t.kind) {
    case 'battle': s.open('battle', { battleId: t.id }); return;
    case 'research': s.goTab('research'); if (t.id === 1) { s.collapsed['rs-known'] = false; scrollTo('known-techs'); } return;
    case 'doctrine': s.goTab('research'); scrollTo('doctrines'); return;
    case 'player': s.goTab('diplomacy', { playerId: t.id }); return;
    case 'score': s.open('score'); return;
    case 'design': s.goTab('design', { designId: t.id }); return;
    case 'colonies': s.goTab('colonies'); return;
    case 'anomaly': s.goTab('empire', { anomalyId: t.id }); scrollTo('discoveries'); return;
    case 'relic': s.goTab('empire', { relic: t.id }); scrollTo('discoveries'); return;
    case 'tech': s.open('techBrowser', { name: (t as { name: string }).name }); return;
    case 'empire': s.goTab('empire'); { const sec = (t as { section?: string }).section; if (sec) scrollTo(sec); } return;
    case 'space': if (t.x !== undefined && t.y !== undefined) s.focus({ kind: 'space', id: 0, x: t.x, y: t.y }, { x: t.x, y: t.y }); return;
    default: {
      const ref = { kind: t.kind, id: t.id } as ObjRef;
      const pos = refPos(g, me, ref);
      if (pos) { s.focus(ref, pos); return; }
      // gone from the scanners since (a foreign fleet, the trader): show where it was
      if (t.x !== undefined && t.y !== undefined) {
        s.focus({ kind: 'space', id: 0, x: t.x, y: t.y }, { x: t.x, y: t.y });
        s.notify(t.kind === 'trader' ? 'Le Marchand nomade est hors de portée de vos scanners : voici où il a été repéré.' : 'Hors de portée de vos scanners : voici où il a été vu.');
      } else s.notify('Plus en vue de vos scanners.');
    }
  }
}

interface Ent { name: string; target: NavTarget }

let cache: { g: GameState; year: number; n: number; me: number; planets: Ent[] } | null = null;
function planetEnts(g: GameState): Ent[] {
  const me = store.me;
  // 0.3.7: not the hidden stars this empire has not found
  if (!cache || cache.g !== g || cache.year !== g.year || cache.n !== g.planets.length || cache.me !== me?.id) cache = { g, year: g.year, n: g.planets.length, me: me?.id ?? -1, planets: g.planets.filter(p => p.name.length >= 1 && !me?.intel.planets[p.id]?.unknown).map(p => ({ name: p.name, target: { kind: 'planet' as const, id: p.id } })) };
  return cache.planets;
}

/** Translated names of every technology and hull, for the research reports. */
let techNames: Ent[] | null = null;
function techEnts(): Ent[] {
  if (!techNames) {
    const seen = new Set<string>();
    techNames = [];
    for (const t of [...TECH_DATA, ...HULL_DATA]) {
      const n = tl(t.name);
      if (n.length < 3 || seen.has(n)) continue;
      seen.add(n); techNames.push({ name: n, target: { kind: 'tech', id: 0, name: t.name } });
    }
  }
  return techNames;
}

const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A name standing alone in the text, not inside a longer word ("Mû" is a planet, "Mûre" is not). */
const ALONE_BEFORE = '(?<![\\p{L}\\p{N}])', ALONE_AFTER = '(?![\\p{L}\\p{N}])';
function named(text: string, name: string): boolean {
  if (!text.includes(name)) return false;
  return new RegExp(ALONE_BEFORE + esc(name) + ALONE_AFTER, 'u').test(text);
}

/**
 * 3.4: phrases of the reports that name a page or an action ("Doctrine à choisir", "page Diplomatie", "onglet Empire,
 * Découvertes"...): they become links to it.
 */
const PHRASES: { re: RegExp; to: (m: Message, g: GameState) => NavTarget | null }[] = [
  { re: /Doctrine à choisir/, to: () => ({ kind: 'doctrine', id: 0 }) },
  { re: /Une décision vous attend/, to: m => m.target?.kind === 'anomaly' ? m.target : null },
  { re: /\(onglet Empire, Découvertes\)|onglet Empire, Découvertes/, to: m => m.target?.kind === 'anomaly' ? m.target : { kind: 'anomaly', id: -1 } },
  { re: /Recherche, Technologies déjà trouvées/, to: () => ({ kind: 'research', id: 1 }) },
  { re: /page Diplomatie|onglet Diplomatie/, to: (m, g) => ({ kind: 'player', id: m.target?.kind === 'player' ? m.target.id : (g.players.find(p => !p.monster && m.text.includes(p.name))?.id ?? -1) }) },
  // 3.6: a battle in deep space: the place is a link to it on the map (the word "Bataille" opens the replay)
  { re: /l'espace profond \(\d+, \d+\)/, to: m => { const c = m.text.match(/l'espace profond \((\d+), (\d+)\)/); return c ? { kind: 'space', id: 0, x: +c[1], y: +c[2] } : null; } },
  // 3.5: the embassies sit in the other empire's capital
  { re: /Ambassades ouvertes/, to: (m, g) => { const o = m.target?.kind === 'player' ? g.players[m.target.id] : undefined; const c = o ? capitalOf(g, o) : null; return c ? { kind: 'planet', id: c.id } : null; } },
  { re: /la Brèche/, to: (m, g) => g.crisis?.planetId !== undefined ? { kind: 'planet', id: g.crisis.planetId } : null },
  { re: /page Empire/, to: m => ({ kind: 'empire', id: 0, section: /pirate|prime/i.test(m.text) ? 'pirates' : /Brèche|Moissonneur|Nexus/.test(m.text) ? 'crisis' : undefined }) },
];

/**
 * The words of a report that stand for where it leads, by kind of destination, when no name in it does: "Bataille",
 * "niveau 5 en Énergie", "trou de ver", "(705, 1346)"... They become the link. The first that is found wins.
 */
const FIELDS_RE = '(?:Énergie|Armement|Propulsion|Construction|Électronique|Biotechnologie)';
const TARGET_WORDS: Record<string, RegExp[]> = {
  battle: [/\d+ enregistrements? de bataille/, /Bataille/, /bataille/],
  research: [new RegExp(`niveau \\d+ en ${FIELDS_RE}`), /Nouvelles technologies disponibles/, new RegExp(`progressé en ${FIELDS_RE}`), /Objectif atteint/, /points? de recherche/, new RegExp(FIELDS_RE)],
  score: [/Objectif secret accompli/, /objectifs? secrets?/, /remporte(?:nt)? la partie/, /conditions de victoire/, /Victoire/, /anéanti/],
  colonies: [/Constructions de l'année/],
  doctrine: [/[Dd]octrine/],
  anomaly: [/Anomalie/, /Site archéologique/, /[Dd]écision/, /chapitre/],
  wormhole: [/[Tt]rou de ver/],
  minefield: [/champ de mines/, /\(\d+, \d+\)/],
  packet: [/[Pp]aquet/],
  trader: [/Marchand nomade/, /marchand/],
  design: [/modèle/],
  space: [/\(\d+, \d+\)/, /l'espace profond/],
  fleet: [/Un contact non identifié/, /\(\d+, \d+\)/, /[Ff]lotte/],
  planet: [/\(\d+, \d+\)/],
};
/** Last resort: the report's first clause (up to its first colon or full stop). */
function firstClause(text: string): string {
  const cut = text.search(/ : |\. |\.$| \(/);
  let c = (cut > 0 ? text.slice(0, cut) : text).trim();
  if (c.length > 60) { const sp = c.lastIndexOf(' ', 60); c = c.slice(0, sp > 20 ? sp : 60); }
  return c;
}
const sameTarget = (a: NavTarget, b: NavTarget) => a.kind === b.kind && (a.id === b.id || ['doctrine', 'research', 'score', 'colonies'].includes(a.kind));

/**
 * The links of a report: names and phrases found in its text; when none leads where the report does, the words that
 * stand for it (or, at worst, its first clause) become that link.
 */
export function msgLinks(g: GameState, me: Player, m: Message): { ents: Ent[]; fallback?: string } {
  const ents: Ent[] = [];
  const add = (e: Ent) => { if (!ents.some(x => x.name === e.name)) ents.push(e); };
  const t = m.target;
  if (t?.kind === 'fleet') {
    const f = g.fleets.find(x => x.id === t.id);
    const fi = me.intel.fleets.find(x => x.id === t.id);
    const name = f && f.owner === me.id ? f.name : fi?.detail === 'full' ? fi.name : f && m.text.includes(f.name) ? f.name : undefined;
    if (name) add({ name, target: t });
  }
  for (const f of g.fleets) if (f.owner === me.id && f.name.length >= 3 && m.text.includes(f.name)) add({ name: f.name, target: { kind: 'fleet', id: f.id } });
  // empires (Diplomacy page, their entry unfolded)
  for (const p of g.players) if (p.id !== me.id && !p.monster && p.name.length >= 3 && m.text.includes(p.name)) add({ name: p.name, target: { kind: 'player', id: p.id } });
  // discoveries: the anomaly the report is about (its planet named in the text or targeted), then relics
  const known = knownAnomalies(g, me);
  for (const a of known) {
    const name = defOf(a).name;
    if (!m.text.includes(name) || ents.some(e => e.name === name)) continue;
    const here = known.filter(x => defOf(x).name === name);
    const pick = here.find(x => t?.kind === 'anomaly' && x.id === t.id) ?? here.find(x => (t?.kind === 'planet' && t.id === x.planetId) || m.text.includes(g.planets[x.planetId].name)) ?? here[0];
    add({ name, target: { kind: 'anomaly', id: pick.id } });
  }
  for (const [id, r] of Object.entries(RELICS)) if (m.text.includes(r.name)) add({ name: r.name, target: { kind: 'relic', id: Object.keys(RELICS).indexOf(id) } });
  // technologies, in research and trader reports only (names like "Laser" would match too much elsewhere)
  if (m.kind === 'research' || m.kind === 'trader') for (const e of techEnts()) if (m.text.includes(e.name)) add(e);
  for (const e of planetEnts(g)) if (named(m.text, e.name)) add(e);
  for (const ph of PHRASES) {
    const hit = m.text.match(ph.re);
    const to = hit ? ph.to(m, g) : null;
    if (hit && to) add({ name: hit[0], target: to });
  }
  // only names standing alone in the text become links
  const shown = ents.filter(e => named(m.text, e.name));
  if (!t || shown.some(e => sameTarget(e.target, t))) return { ents: shown };
  for (const re of TARGET_WORDS[t.kind] ?? []) {
    const hit = m.text.match(re);
    if (!hit || shown.some(e => e.name === hit[0]) || !named(m.text, hit[0])) continue;
    // a name already linked inside these words keeps its own link: the words are only taken if they do not overlap one
    const at = hit.index ?? 0;
    if (shown.some(e => { const k = m.text.indexOf(e.name); return k >= 0 && k < at + hit[0].length && at < k + e.name.length; })) continue;
    return { ents: [...shown, { name: hit[0], target: t }] };
  }
  const c = firstClause(m.text);
  const at = m.text.indexOf(c);
  if (c.length >= 3 && !shown.some(e => { const k = m.text.indexOf(e.name); return k >= 0 && k < at + c.length && at < k + e.name.length; })) return { ents: [...shown, { name: c, target: t }], fallback: c };
  return { ents: shown, fallback: '(none)' };
}

/** Message text where planet, fleet, empire, discovery and technology names, and the pages it mentions, are links. */
export function MsgText({ g, me, m }: { g: GameState; me: Player; m: Message }): ComponentChildren {
  const { ents } = msgLinks(g, me, m);
  if (!ents.length) return m.text;
  // longest names first, so that "Grand Faucheux 7" wins over "Faucheux"
  ents.sort((a, b) => b.name.length - a.name.length);
  const re = new RegExp(`${ALONE_BEFORE}(${ents.map(e => esc(e.name)).join('|')})${ALONE_AFTER}`, 'gu');
  const parts = m.text.split(re);
  return <>{parts.map((part, i) => {
    if (i % 2 === 0) return part;
    const e = ents.find(x => x.name === part)!;
    return <button class="lnk" onClick={ev => { ev.stopPropagation(); gotoTarget(e.target); }}>{part}</button>;
  })}</>;
}
