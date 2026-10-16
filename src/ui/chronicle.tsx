// 0.3.9: the chronicle of the game and its ending: the events year by year, the territory replayed, an epilogue for
// each empire, the distinctions, and a page to share (a self-contained HTML file).
import { useEffect, useRef, useState } from 'preact/hooks';
import { useStore, store } from './store';
import { Modal, Tabs } from './components';
import type { ChronicleEvent, ChronicleKind, GameState, Player } from '../engine/types';
import { chronicleFor, epilogue, awards, ownerAt, worldsOver } from '../engine/chronicle';
import { ACHIEVEMENTS, unlocked } from './achievements';
import { ORIGIN } from '../engine/origins';
import { SHARE_CSS, shareScript } from './sharepage';

type Tab = 'events' | 'replay' | 'epilogue' | 'awards';
type Filter = 'all' | 'mine' | 'war' | 'great';
const WAR: ChronicleKind[] = ['war', 'peace', 'alliance', 'conquest', 'nemesis', 'death'];
const GREAT: ChronicleKind[] = ['mega', 'crisis', 'victory', 'guardian', 'secret', 'golden', 'cataclysm', 'act', 'veteran', 'event', 'diaspora'];

export const gameEnded = (g: GameState, me: Player) => g.victor !== null || me.dead;

function EventList({ g, me, list }: { g: GameState; me: Player; list: ChronicleEvent[] }) {
  if (!list.length) return <p class="muted">Rien à raconter pour l'instant.</p>;
  const decades = new Map<number, ChronicleEvent[]>();
  for (const e of list) { const d = Math.floor(e.year / 10) * 10; decades.set(d, [...(decades.get(d) ?? []), e]); }
  return <div class="chron-list">{[...decades.entries()].map(([d, evs]) => <section>
    <h4>{d}</h4>
    <ul>{evs.map(e => <li class={'ck-' + e.kind}>
      <b>{e.year}</b> <span>{e.text}</span>
      {e.x !== undefined && <button class="lnk small" onClick={() => { store.close('chronicle'); store.close('gameOver'); store.goTab('map'); store.center(e.x!, e.y!); }} title="Voir sur la carte">◎</button>}
      {e.who.some(w => w === me.id) && <i class="mine-dot" title="Votre empire" />}
    </li>)}</ul>
  </section>)}</div>;
}

/** The territory year by year: every world in the colour of its owner (only yours before the end of the game). */
export function Replay({ g, me }: { g: GameState; me: Player }) {
  const frames = g.chronicle?.frames ?? [];
  const all = gameEnded(g, me);
  const [i, setI] = useState(frames.length - 1);
  const [play, setPlay] = useState(false);
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!play) return;
    const t = setInterval(() => setI(x => { if (x >= frames.length - 1) { setPlay(false); return x; } return x + 1; }), 260);
    return () => clearInterval(t);
  }, [play, frames.length]);
  const f = frames[Math.max(0, Math.min(i, frames.length - 1))];
  useEffect(() => {
    const c = cv.current; if (!c || !f) return;
    const W = c.clientWidth, H = c.clientHeight, dpr = window.devicePixelRatio || 1;
    c.width = W * dpr; c.height = H * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#04070d'; ctx.fillRect(0, 0, W, H);
    const xs = g.planets.map(p => p.x), ys = g.planets.map(p => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const k = Math.min((W - 20) / Math.max(1, x1 - x0), (H - 20) / Math.max(1, y1 - y0));
    const ox = (W - (x1 - x0) * k) / 2, oy = (H - (y1 - y0) * k) / 2;
    for (const p of g.planets) {
      if (p.hidden && !me.intel.planets[p.id]?.year) continue;
      const o = ownerAt(f.owners, p.id);
      const visible = o >= 0 && (all || o === me.id);
      const px = ox + (p.x - x0) * k, py = oy + (p.y - y0) * k;
      if (visible) {
        const col = g.players[o]?.color ?? '#888';
        ctx.fillStyle = col + '33'; ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(px, py, 2.6, 0, Math.PI * 2); ctx.fill();
      } else { ctx.fillStyle = '#3a4456'; ctx.fillRect(px - 0.6, py - 0.6, 1.2, 1.2); }
    }
  }, [f, all]);
  if (!frames.length) return <p class="muted">Pas encore d'images du territoire.</p>;
  const counts = g.players.filter(p => !p.monster && (all || p.id === me.id)).map(p => {
    let n = 0; const ch = String.fromCharCode(49 + p.id);
    for (let k = 0; k < f.owners.length; k++) if (f.owners[k] === ch) n++;
    return { p, n };
  }).sort((a, b) => b.n - a.n);
  return <div class="replay">
    <canvas ref={cv} class="replay-cv" />
    <div class="replay-bar">
      <button class="primary small" onClick={() => { if (i >= frames.length - 1) setI(0); setPlay(!play); }}>{play ? 'Pause' : 'Lecture'}</button>
      <input type="range" min={0} max={frames.length - 1} value={i} onInput={e => { setPlay(false); setI(+(e.target as HTMLInputElement).value); }} />
      <b class="replay-year">{f.year}</b>
    </div>
    <div class="replay-legend">{counts.map(({ p, n }) => <span><i style={{ background: p.color }} /> {p.name} <b>{n}</b></span>)}</div>
    {!all && <p class="small muted">Avant la fin de la partie, seul votre territoire apparaît : celui des autres sera révélé à la fin.</p>}
  </div>;
}

function Epilogues({ g }: { g: GameState }) {
  const emp = g.players.filter(p => !p.monster).sort((a, b) => (b.id === g.victor ? 1 : 0) - (a.id === g.victor ? 1 : 0) || (a.dead ? 1 : 0) - (b.dead ? 1 : 0));
  return <div class="epilogues">{emp.map(p => <div class={'epi' + (p.dead ? ' dead' : '') + (p.id === g.victor ? ' won' : '')}>
    <h4 style={{ color: p.color }}>{p.name}</h4>
    <Sparkline g={g} p={p} />
    {epilogue(g, p).map(t => <p>{t}</p>)}
  </div>)}</div>;
}

function Sparkline({ g, p }: { g: GameState; p: Player }) {
  const c = worldsOver(g, p.id);
  if (c.length < 2) return null;
  const max = Math.max(1, ...g.players.filter(x => !x.monster).flatMap(x => worldsOver(g, x.id).map(v => v.n)));
  const W = 220, H = 34;
  const pts = c.map((v, i) => `${(i / (c.length - 1) * W).toFixed(1)},${(H - v.n / max * (H - 2) - 1).toFixed(1)}`).join(' ');
  return <svg class="spark" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true"><polyline points={pts} fill="none" stroke={p.color} stroke-width="1.6" /></svg>;
}

function Awards({ g }: { g: GameState }) {
  const list = awards(g);
  if (!list.length) return <p class="muted">Aucune distinction cette fois.</p>;
  return <div class="awards">{list.map(a => <div class="award">
    <div class="aw-title">{a.title}</div>
    <div class="aw-who" style={{ color: g.players[a.who].color }}>{g.players[a.who].name}</div>
    <div class="small muted">{a.text}{a.value ? ` (${a.value})` : ''}</div>
  </div>)}</div>;
}

/** Events, territory, epilogues and distinctions; at the end of a game, everything is revealed. */
export function ChronicleView({ initial }: { initial?: Tab }) {
  const s = useStore();
  const g = s.game!, me = s.me!;
  const end = gameEnded(g, me);
  const [tab, setTab] = useState<Tab>(initial ?? 'events');
  const [filter, setFilter] = useState<Filter>('all');
  const evs = chronicleFor(g, me);
  const list = evs.filter(e => filter === 'all' || (filter === 'mine' ? e.who.includes(me.id) : filter === 'war' ? WAR.includes(e.kind) : GREAT.includes(e.kind)));
  const tabs: { id: Tab; label: string }[] = [{ id: 'events', label: 'Événements' }, { id: 'replay', label: 'Territoire' }, ...(end ? [{ id: 'epilogue' as Tab, label: 'Épilogues' }, { id: 'awards' as Tab, label: 'Distinctions' }] : [])];
  return <div class="chronicle">
    <Tabs tabs={tabs} value={tab} onChange={setTab} />
    {tab === 'events' && <>
      <div class="chips">{([['all', 'Tout'], ['mine', 'Votre empire'], ['war', 'Guerres et conquêtes'], ['great', 'Grands événements']] as [Filter, string][]).map(([id, l]) => <button class={'chip' + (filter === id ? ' on' : '')} onClick={() => setFilter(id)}>{l}</button>)}</div>
      {!end && <p class="small muted">Vous ne lisez que ce qui concerne votre empire ou ceux que vous avez rencontrés ; à la fin de la partie, toute l'histoire sera révélée.</p>}
      <EventList g={g} me={me} list={[...list].reverse()} />
    </>}
    {tab === 'replay' && <Replay g={g} me={me} />}
    {tab === 'epilogue' && <Epilogues g={g} />}
    {tab === 'awards' && <Awards g={g} />}
  </div>;
}

export function ChronicleDialog({ tab }: { tab?: Tab }) {
  const s = useStore();
  const g = s.game!, me = s.me!;
  return <Modal title="Chronique" wide onClose={() => s.close('chronicle')} footer={gameEnded(g, me) ? <><span class="sp" /><button onClick={() => shareChronicle(g)}>Page à partager…</button><button class="primary" onClick={() => s.close('chronicle')}>Fermer</button></> : undefined}>
    <ChronicleView initial={tab} />
  </Modal>;
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A self-contained page: the territory replayed, the events, the epilogues and the distinctions. */
export function chronicleHtml(g: GameState): string {
  const emp = g.players.filter(p => !p.monster);
  const data = {
    planets: g.planets.map(p => [p.x, p.y, p.hidden ? 1 : 0]),
    frames: (g.chronicle?.frames ?? []).map(f => [f.year, f.owners]),
    players: g.players.map(p => [p.name, p.color, p.monster ? 1 : 0]),
    play: 'Lecture', pause: 'Pause',
  };
  const events = (g.chronicle?.events ?? []).map(e => `<li><b>${e.year}</b> ${esc(e.text)}</li>`).join('');
  const epis = emp.map(p => `<section class="epi"><h3 style="color:${p.color}">${esc(p.name)}</h3>${epilogue(g, p).map(t => `<p>${esc(t)}</p>`).join('')}</section>`).join('');
  const aw = awards(g).map(a => `<div class="aw"><div class="t">${esc(a.title)}</div><div class="w" style="color:${g.players[a.who].color}">${esc(g.players[a.who].name)}</div><div class="m">${esc(a.text)}${a.value ? ` (${esc(a.value)})` : ''}</div></div>`).join('');
  const winner = g.victor !== null ? g.players[g.victor] : undefined;
  const years = `${g.chronicle?.frames[0]?.year ?? 2400}–${g.year}`;
  const title = `${g.name} · ${years}`;
  const css = SHARE_CSS;
  const js = shareScript(data);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${css}</style></head><body><main>
<h1>${esc(g.name)}</h1><div class="sub">${esc(years)}${winner ? ` · ${esc(winnerLine(g))}` : ''}</div>
<h2>${esc('Le territoire, année après année')}</h2><canvas id="cv"></canvas><div class="bar"><button id="b">${esc(data.play)}</button><input id="r" type="range" min="0" value="0"><span class="yr" id="y"></span></div><div class="leg" id="leg"></div>
<h2>${esc('Distinctions')}</h2><div class="aws">${aw}</div>
<h2>${esc('Épilogues')}</h2>${epis}
<h2>${esc('Chronique')}</h2><ul class="ev">${events}</ul>
</main><script>${js}</script></body></html>`;
}

function winnerLine(g: GameState): string {
  const w = g.players[g.victor!];
  return g.victoryKind === 'megaproject' ? `victoire des ${w.name}, par le Portail de l'Ascension` : g.victoryKind === 'crisis' ? `victoire des ${w.name}, qui ont abattu le Nexus` : g.victoryKind === 'lastStanding' ? `victoire des ${w.name}, derniers debout` : g.victoryKind === 'seal' ? `victoire des ${w.name}, qui ont scellé la Brèche` : g.victoryKind === 'origin' ? `victoire des ${w.name}, par le destin de leur origine` : `victoire des ${w.name}`;
}

export function shareChronicle(g: GameState) {
  store.open('export', { title: 'Page à partager', text: chronicleHtml(g), file: `constellations-chronique-${g.name.replace(/\W+/g, '_')}-${g.year}.html`, note: 'Une page autonome : le territoire rejoué, les distinctions, les épilogues et toute la chronique. Elle s\'ouvre dans n\'importe quel navigateur, sans le jeu.' });
}

/** The achievements of this browser. */
export function AchievementsDialog() {
  const s = useStore();
  const n = ACHIEVEMENTS.filter(a => unlocked(a.id)).length;
  return <Modal title={`Succès · ${n} sur ${ACHIEVEMENTS.length}`} width={640} onClose={() => s.close('achievements')}>
    <p class="small muted">Gardés par ce navigateur, d'une partie à l'autre (jamais dans le tutoriel). Certains débloquent un emblème pour vos races, dans l'assistant de race.</p>
    <div class="ach-list">{ACHIEVEMENTS.map(a => {
      const u = unlocked(a.id);
      const hidden = a.secret && !u;
      return <div class={'ach' + (u ? ' on' : '')}>
        <div class="ach-ico">{u ? '✓' : '·'}</div>
        <div><b>{hidden ? 'Succès secret' : a.name}</b><div class="small">{hidden ? 'Il se révélera de lui-même.' : a.text}</div>
          {a.unlocks?.icon !== undefined && !hidden && <div class="small muted">Débloque un emblème de race.</div>}
          {a.unlocks?.origin && !hidden && <div class="small muted">Débloque l'origine « {ORIGIN[a.unlocks.origin]?.name ?? a.unlocks.origin} ».</div>}
          {u && <div class="small muted">{u.game}, {u.year} ({u.date})</div>}</div>
      </div>;
    })}</div>
  </Modal>;
}
