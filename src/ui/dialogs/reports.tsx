// Reports: planets, fleets, foreign fleets, battles, messages, score.
import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { store, useStore, fmt, fmtPop, pct, saveFile, saveMode } from '../store';
import { Modal, Tabs, MineralLine, useSorted } from '../components';
import { planetSpec } from '../../engine/planet';
import { fleetSpec, estimateRoute, cargoMass } from '../../engine/fleet';
import { itemLabel, isAuto } from '../../engine/production';
import { habitability } from '../../engine/race';
import { wpName } from '../command';
import { VICTORY_LABELS, countBits } from '../../engine/score';
import { refPos } from '../map';
import { gotoTarget, MsgText } from '../nav';
import type { FactKey, Player, ScoreEntry } from '../../engine/types';
import { intelOn } from '../../engine/espionage';
import { DossierBlock, IntelLevel, known, scoresOpen } from '../intel';

export interface Col<T> { key: string; label: string; get: (r: T) => number | string; render?: (r: T) => ComponentChildren; num?: boolean; minerals?: (r: T) => { ironium: number; boranium: number; germanium: number }; /** 0.3.9.21: the value exported (the sort key is not always one: years from now, a fraction), or false to leave the column out */ csv?: ((r: T) => number | string) | false }

function toCsv<T>(all: Col<T>[], rows: T[]): string {
  const cols = all.filter(c => c.csv !== false);
  const cell = (v: number | string) => typeof v === 'number' ? String(v).replace('.', ',') : /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  // semicolons and a BOM so spreadsheets in French locales open it directly
  const head = cols.flatMap(c => c.minerals ? ['Ironium', 'Boranium', 'Germanium'].map(m => `${c.label} ${m}`) : [c.label]);
  const line = (r: T) => cols.flatMap(c => { if (!c.minerals) return [cell(c.csv ? c.csv(r) : c.get(r))]; const m = c.minerals(r); return [m.ironium, m.boranium, m.germanium].map(cell); });
  return '\ufeff' + [head.map(cell).join(';'), ...rows.map(r => line(r).join(';'))].join('\r\n');
}

export function SortTable<T>({ cols, rows, onRow, onDbl, isSel, initial, initialDir, csv, empty }: { cols: Col<T>[]; rows: T[]; onRow?: (r: T) => void; onDbl?: (r: T) => void; isSel?: (r: T) => boolean; initial?: string; initialDir?: number; csv?: string; empty?: string }) {
  const [sort, setSort] = useState<{ key: string; dir: number }>({ key: initial ?? cols[0].key, dir: initialDir ?? 1 });
  const col = cols.find(c => c.key === sort.key) ?? cols[0];
  const sorted = [...rows].sort((a, b) => {
    const x = col.get(a), y = col.get(b);
    return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir;
  });
  return (
    <div class="report-scroll">
      <table class="report">
        <thead><tr>{cols.map(c => <th class={c.num ? 'num' : ''} onClick={() => setSort({ key: c.key, dir: sort.key === c.key ? -sort.dir : (c.num ? -1 : 1) })}>{c.label}{sort.key === c.key ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>)}</tr></thead>
        <tbody>{sorted.map(r => <tr class={isSel?.(r) ? 'sel' : ''} onClick={() => onRow?.(r)} onDblClick={() => onDbl?.(r)}>{cols.map(c => <td class={c.num ? 'num' : ''}>{c.render ? c.render(r) : c.get(r)}</td>)}</tr>)}</tbody>
      </table>
      {rows.length === 0 && <p class="muted">{empty ?? 'Rien à afficher.'}</p>}
      {csv && rows.length > 0 && saveMode() !== 'none' && <button class="small csv" onClick={() => { void saveFile(`${csv}-${store.game?.year ?? ''}.csv`, toCsv(cols, sorted)); }}>Exporter en CSV</button>}
    </div>
  );
}

export function ReportsDialog({ tab: initialTab }: { tab?: string }) {
  const s = useStore();
  const g = s.game!, me = s.me!;
  const [tab, setTab] = useState(initialTab && ['messages', 'battles', 'others', 'score'].includes(initialTab) ? initialTab : 'messages');
  const goFleet = (id: number) => { const ref = { kind: 'fleet' as const, id }; s.focus(ref, refPos(g, me, ref)); };
  const n = me.messages.length;
  return (
    <Modal title="Rapports" wide onClose={() => s.close('reports')} sub={<>{g.year} · {n} nouveau{n > 1 ? 'x' : ''} rapport{n > 1 ? 's' : ''} cette année</>}>
      <Tabs tabs={[{ id: 'messages', label: `Messages (${n})` }, { id: 'battles', label: `Batailles (${g.battles.filter(b => b.players.includes(me.id)).length})` }, { id: 'others', label: `Flottes étrangères (${me.intel.fleets.length})` }, { id: 'score', label: 'Score' }]} value={tab} onChange={setTab} />
      {tab === 'others' && <SortTable csv="flottes-etrangeres" rows={me.intel.fleets} onRow={r => goFleet(r.id)} empty="Aucune flotte étrangère repérée." cols={[
        { key: 'name', label: 'Flotte', get: r => r.detail === 'full' ? r.name ?? '' : 'Contact inconnu' },
        { key: 'owner', label: 'Empire', get: r => r.owner >= 0 ? g.players[r.owner].name : '?', render: r => r.owner >= 0 ? <span style={{ color: g.players[r.owner].color }}>{g.players[r.owner].name}</span> : '?' },
        { key: 'loc', label: 'Position', get: r => r.orbiting !== undefined ? g.planets[r.orbiting].name : `(${Math.round(r.x)}, ${Math.round(r.y)})` },
        { key: 'ships', label: 'Vaisseaux', num: true, get: r => r.tokens?.reduce((a, t) => a + t.qty, 0) ?? 0, render: r => r.tokens ? String(r.tokens.reduce((a, t) => a + t.qty, 0)) : '?' },
        { key: 'mass', label: 'Masse', num: true, get: r => r.mass ?? 0, render: r => r.mass !== undefined ? fmt(r.mass) : '?' },
        { key: 'warp', label: 'Warp', num: true, get: r => r.warp ?? 0, render: r => r.warp ? String(r.warp) : '?' },
        { key: 'track', label: 'Suivi', num: true, get: r => me.intel.tracks[r.id]?.length ?? 0, render: r => `${me.intel.tracks[r.id]?.length ?? 0} obs.` },
      ]} />}
      {tab === 'battles' && <SortTable csv="batailles" rows={g.battles.filter(b => b.players.includes(me.id))} onRow={r => s.open('battle', { battleId: r.id })} empty="Aucune bataille cette année." cols={[
        { key: 'loc', label: 'Lieu', get: r => r.planetId !== undefined ? g.planets[r.planetId].name : `(${Math.round(r.x)}, ${Math.round(r.y)})` },
        { key: 'sb', label: 'Station', get: r => { const sb = r.tokens.find(t => t.starbase); return !sb ? '' : sb.owner === me.id ? 'nôtre' : 'adverse'; } },
        { key: 'players', label: 'Camps', get: r => r.players.map(p => g.players[p].name).join(' / ') },
        { key: 'ours', label: 'Nos unités', num: true, get: r => r.tokens.filter(t => t.owner === me.id).reduce((a, t) => a + t.qty, 0) },
        { key: 'theirs', label: 'Adverses', num: true, get: r => r.tokens.filter(t => t.owner !== me.id).reduce((a, t) => a + t.qty, 0) },
        { key: 'ourdead', label: 'Nos pertes', num: true, get: r => r.losses[me.id] ?? 0 },
        { key: 'theirdead', label: 'Pertes adverses', num: true, get: r => Object.entries(r.losses).filter(([k]) => +k !== me.id).reduce((a, [, v]) => a + v, 0) },
        { key: 'rounds', label: 'Rounds', num: true, get: r => r.rounds },
      ]} />}
      {tab === 'messages' && <MessageList />}
      {tab === 'score' && <ScoreBody />}
    </Modal>
  );
}

export function ScoreDialog() {
  const s = useStore();
  return <Modal title="Score" wide onClose={() => s.close('score')}><ScoreBody /></Modal>;
}

function ScoreBody() {
  const s = useStore();
  const g = s.game!, me = s.me!;
  const open = scoresOpen(g);
  // 3.5: with the Intelligence rule, what is known of the others (estimates, then exact figures)
  const intel = !open && intelOn(g);
  const [sel, setSel] = useState<number | null>(null);
  const show = (pid: number) => pid === me.id || open || me.intel.met.includes(pid);
  type R = { p: Player; sc: ScoreEntry | undefined };
  // ships in sight are shown in brackets next to other empires' figures, public scores included
  const fig = (r: R, k: FactKey) => intel || (open && intelOn(g)) ? known(g, me, r.p.id, k, r.sc) : open || r.p.id === me.id ? { v: Number(r.sc?.[k] ?? 0), node: fmt(Number(r.sc?.[k] ?? 0)) } : { v: null, node: null };
  const rows: R[] = g.players.map(p => ({ p, sc: p.scores[p.scores.length - 1] })).filter(r => show(r.p.id) && !r.p.monster);
  // the ranking among the empires whose score is known (all of them when scores are public)
  const ranked = rows.filter(r => fig(r, 'score').v !== null).sort((a, b) => (fig(b, 'score').v ?? 0) - (fig(a, 'score').v ?? 0));
  const rank = new Map(open || intel ? ranked.map((r, i) => [r.p.id, i + 1]) : []);
  const ordered = open || intel ? [...ranked, ...rows.filter(r => !rank.has(r.p.id)).sort((a, b) => a.p.name.localeCompare(b.p.name))]
    : [...rows].sort((a, b) => a.p.id === me.id ? -1 : b.p.id === me.id ? 1 : a.p.name.localeCompare(b.p.name));
  const n = (k: FactKey) => (r: R) => fig(r, k).v ?? -1;
  const { sorted, th } = useSorted(ordered, [
    { key: 'rank', get: r => rank.get(r.p.id) ?? 999, num: true }, { key: 'name', get: r => r.p.name },
    { key: 'score', get: n('score'), num: true }, { key: 'planets', get: n('planets'), num: true }, { key: 'starbases', get: n('starbases'), num: true },
    { key: 'unarmed', get: n('unarmed'), num: true }, { key: 'escort', get: n('escort'), num: true }, { key: 'capital', get: n('capital'), num: true },
    { key: 'tech', get: n('techLevels'), num: true }, { key: 'res', get: n('resources'), num: true },
    { key: 'intel', get: r => r.p.id === me.id ? 101 : me.intel.dossiers?.[r.p.id]?.level ?? 0, num: true },
  ], 'rank', 1);
  const v = g.settings.victory;
  const W = 640, H = 200;
  // the lines: yours, everyone's when public, the others as observed (dotted) with the Intelligence rule
  const lines: { p: Player; pts: { year: number; v: number }[]; est: boolean }[] = g.players.filter(p => !p.monster && show(p.id)).map(p => (
    p.id === me.id || open ? { p, pts: p.scores.map(x => ({ year: x.year, v: x.score })), est: false }
      : intel ? { p, pts: (me.intel.dossiers?.[p.id]?.history ?? []).map(x => ({ year: x.year, v: x.v })), est: true } : { p, pts: [], est: false })).filter(l => l.pts.length);
  const maxS = Math.max(10, ...lines.flatMap(l => l.pts.map(x => x.v)));
  const years = Math.max(1, g.year - 2400);
  const cols = 9 + (intel ? 1 : 0);
  return (
    <div class="score">
      <table class="report">
        <thead><tr>{th('rank', 'Rang', { num: false, title: intel ? 'parmi les empires dont vous connaissez le score' : undefined })}{th('name', 'Empire')}{intel && th('intel', 'Rens.', { title: 'votre renseignement sur cet empire (0 à 100) ; cliquez sur une ligne pour voir le dossier' })}{th('score', 'Score')}{th('planets', 'Planètes')}{th('starbases', 'Stations')}{th('unarmed', 'Non armés')}{th('escort', 'Escorte')}{th('capital', 'Capitaux')}{th('tech', 'Tech')}{th('res', 'Ressources')}</tr></thead>
        <tbody>{sorted.map(r => {
          const mine = r.p.id === me.id;
          const click = intel && !mine ? () => setSel(sel === r.p.id ? null : r.p.id) : undefined;
          return <>
            <tr class={(mine ? 'me' : '') + (click ? ' go' : '') + (sel === r.p.id ? ' sel' : '')} onClick={click} title={click ? 'Voir le dossier' : undefined}><td>{rank.get(r.p.id) ?? '–'}{intel && rank.has(r.p.id) ? <span class="muted small">/{ranked.length}</span> : null}</td><td style={{ color: r.p.color }}>{r.p.name}{r.p.dead ? ' (anéanti)' : ''}</td>
              {intel && <td>{mine ? '' : <IntelLevel me={me} pid={r.p.id} />}</td>}
              {mine || open || intel ? <><td class="num b">{fig(r, 'score').node}</td><td class="num">{fig(r, 'planets').node}</td><td class="num">{fig(r, 'starbases').node}</td><td class="num">{fig(r, 'unarmed').node}</td><td class="num">{fig(r, 'escort').node}</td><td class="num">{fig(r, 'capital').node}</td><td class="num">{fig(r, 'techLevels').node}</td><td class="num">{fig(r, 'resources').node}</td></>
                : <td colSpan={8} class="muted">Scores privés (option « Scores publics » désactivée)</td>}
            </tr>
            {sel === r.p.id && <tr class="diplo-sub"><td colSpan={cols + 1}><DossierBlock pid={r.p.id} /></td></tr>}
          </>;
        })}</tbody>
      </table>
      {open && intelOn(g) && <p class="small muted">Entre parenthèses : les vaisseaux de chaque catégorie visibles en ce moment dans vos scanners (« + » : des contacts non identifiés en plus).</p>}
      {intel && <p class="small muted">Les chiffres des autres empires dépendent de votre renseignement : « ? » inconnu, « ≈ » estimation, un chiffre daté est le dernier relevé ; entre parenthèses, les vaisseaux de chaque catégorie visibles en ce moment dans vos scanners (« + » : des contacts non identifiés en plus). Cliquez sur un empire pour voir son dossier et ce qui vous en apprendrait davantage.</p>}
      <svg class="score-graph" viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
        <rect x="0" y="0" width={W} height={H} fill="#0a1020" />
        {[0.25, 0.5, 0.75].map(f => <line x1="0" x2={W} y1={H * f} y2={H * f} stroke="#1c2840" />)}
        {lines.map(l => <polyline fill="none" stroke={l.p.color} stroke-width="2" stroke-dasharray={l.est ? '5 4' : undefined} points={l.pts.map(x => `${(x.year - 2400) / years * W},${H - x.v / maxS * (H - 10)}`).join(' ')} />)}
      </svg>
      {intel && lines.some(l => l.est) && <p class="small muted">En pointillés : les scores des autres empires tels que vous les avez observés.</p>}
      <h4>Conditions de victoire (il faut en remplir {v.numCriteria}, après au moins {v.minYears} ans)</h4>
      <ul class="victory">
        {[v.ownPlanets !== null && VICTORY_LABELS[0].replace('{ownPlanets}', String(v.ownPlanets)), v.attainTech && VICTORY_LABELS[1].replace('{level}', String(v.attainTech.level)).replace('{fields}', String(v.attainTech.fields)), v.exceedScore !== null && VICTORY_LABELS[2].replace('{exceedScore}', String(v.exceedScore)), v.exceedSecond !== null && VICTORY_LABELS[3].replace('{exceedSecond}', String(v.exceedSecond)), v.production !== null && VICTORY_LABELS[4].replace('{production}', String(v.production)), v.capitalShips !== null && VICTORY_LABELS[5].replace('{capitalShips}', String(v.capitalShips)), v.highestAfter !== null && VICTORY_LABELS[6].replace('{highestAfter}', String(v.highestAfter))]
          .map((l, i) => l ? <li class={me.victoryMet & (1 << i) ? 'green' : ''}>{me.victoryMet & (1 << i) ? '✔ ' : '○ '}{l}</li> : null)}
      </ul>
      <p class="small muted">Vous remplissez actuellement {countBits(me.victoryMet)} condition(s).{g.victor !== null ? ` Vainqueur : ${g.players[g.victor].name}.` : ''}</p>
      <button class="small" onClick={() => s.open('victory')}>Course à la victoire…</button>
    </div>
  );
}

export { habitability };

const MSG_GROUPS: { id: string; label: string; kinds: string[] }[] = [
  { id: 'alert', label: 'Alertes', kinds: ['warning', 'diplomacy', 'event', 'victory'] },
  { id: 'combat', label: 'Combats', kinds: ['battle', 'combat', 'minefield', 'packet'] },
  { id: 'colony', label: 'Colonies', kinds: ['colony', 'population'] },
  { id: 'fleet', label: 'Flottes', kinds: ['fleet', 'scan', 'wormhole', 'trader'] },
  { id: 'research', label: 'Recherche', kinds: ['research'] },
  { id: 'production', label: 'Production', kinds: ['production'] },
  { id: 'info', label: 'Divers', kinds: ['info'] },
];

function MessageList() {
  const s = useStore();
  const me = s.me!;
  const [off, setOff] = useState<Record<string, boolean>>({});
  const groupOf = (k: string) => MSG_GROUPS.find(gr => gr.kinds.includes(k))?.id ?? 'info';
  const counts: Record<string, number> = {};
  for (const m of me.messages) counts[groupOf(m.kind)] = (counts[groupOf(m.kind)] ?? 0) + 1;
  return <>
    <div class="chips">{MSG_GROUPS.filter(gr => counts[gr.id]).map(gr => <button class={off[gr.id] ? '' : 'on'} onClick={() => setOff({ ...off, [gr.id]: !off[gr.id] })}>{gr.label} <span class="muted">{counts[gr.id]}</span></button>)}</div>
    <ul class="msg-list">{me.messages.map((m, i) => off[groupOf(m.kind)] ? null : <li class={'kind-' + m.kind + (m.target ? ' go' : '')} onClick={() => { s.messageIndex = i; if (m.target) gotoTarget(m.target); }}><MsgText g={s.game!} me={me} m={m} /></li>)}</ul>
    {me.messages.length === 0 && <p class="muted">Aucun rapport cette année.</p>}
  </>;
}
