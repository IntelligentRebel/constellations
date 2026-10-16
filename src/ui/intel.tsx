// Constellations 3.5: what the player knows of another empire (intelligence level, sources, figures, spies).
import type { ComponentChildren } from 'preact';
import { useStore, fmt, store } from './store';
import type { FactKey, GameState, Planet, Player, ScoreEntry } from '../engine/types';
import { FIELDS } from '../engine/types';
import * as I from '../engine/espionage';
import { FIELD_NAMES } from '../engine/tech';
import { objectiveText, objectivesOn } from '../engine/objectives';
import { capitalOf } from '../engine/empire';
import * as DIP from '../engine/diplomacy';
import * as A from './actions';

/** Figures are open to all (public scores, game over), or the rule is off. */
export const scoresOpen = (g: GameState) => g.settings.publicScores || g.victor !== null;

export function IntelLevel({ me, pid }: { me: Player; pid: number }) {
  const d = me.intel.dossiers?.[pid];
  const v = d?.level ?? 0;
  const tip = d?.lines.length ? `Renseignement ${v}/100 :\n${d.lines.map(l => `${l.label} +${l.value}`).join('\n')}` : 'Renseignement 0/100 : aucune source cette année';
  return <span class="intel-lvl" title={tip}><span class="intel-bar"><i style={{ width: `${v}%` }} /></span><b class={v >= 60 ? 'green' : v >= 30 ? 'yellow' : 'muted'}>{v}</b></span>;
}

/** A figure of another empire as the player knows it: value for sorting (null unknown) and what to show. */
export function known(g: GameState, me: Player, pid: number, key: FactKey, sc?: ScoreEntry): { v: number | null; node: ComponentChildren } {
  const ships = key === 'unarmed' || key === 'escort' || key === 'capital';
  if (pid === me.id || (scoresOpen(g) && !ships)) { const v = Number(sc?.[key] ?? 0); return { v, node: fmt(v) }; }
  const f = scoresOpen(g) ? { v: Number(sc?.[key] ?? 0), err: 0, year: g.year } : me.intel.dossiers?.[pid]?.facts[key];
  // ships of another empire: those seen right now in the scanners, in brackets, whatever is known of the total
  if (ships) {
    const vis = I.visibleShips(g, me, pid);
    const n = vis[key];
    const pl = n > 1;
    const what = key === 'unarmed' ? (pl ? 'non armés' : 'non armé') : key === 'escort' ? 'd\'escorte' : (pl ? 'capitaux' : 'capital');
    const tip = `${n ? `${n} vaisseau${pl ? 'x' : ''} ${what} en vue en ce moment dans vos scanners${f && !f.err && f.year === g.year ? ` (sur ${f.v})` : ' : ils en ont au moins autant'}` : `Aucun vaisseau ${key === 'unarmed' ? 'non armé' : what} en vue en ce moment dans vos scanners`}${vis.unsure ? ` ; plus environ ${vis.unsure} vaisseaux non identifiés (contacts estimés)` : ''}`;
    const seen = <span class="seen" title={tip}> ({fmt(n)}{vis.unsure ? '+' : ''})</span>;
    if (!f) return { v: n, node: <><span class="muted" title={`Total inconnu : il faut un renseignement de ${I.FACT[key].approx}`}>?</span>{seen}</> };
    const stale = f.year < g.year;
    // a figure of this year cannot be below what is in sight
    const v = stale ? f.v : Math.max(f.v, n);
    const title = `${f.err ? `Estimation à ±${f.err} %` : 'Chiffre exact'}${stale ? `, relevé en ${f.year}` : ''}`;
    return { v: Math.max(v, n), node: <><span class={stale ? 'stale' : ''} title={title}>{f.err ? '≈ ' : ''}{fmt(v)}{stale ? <sup> {f.year}</sup> : null}</span>{seen}</> };
  }
  if (!f) {
    if (key === 'planets') {
      const k = me.intel.planets.filter(pi => pi.owner === pid).length;
      if (k) return { v: k, node: <span class="muted" title="colonies que vous avez repérées ; leur nombre réel reste inconnu">≥ {k}</span> };
    }
    return { v: null, node: <span class="muted" title={`Inconnu : il faut un renseignement de ${I.FACT[key].approx}`}>?</span> };
  }
  const stale = f.year < g.year;
  const title = `${f.err ? `Estimation à ±${f.err} %` : 'Chiffre exact'}${stale ? `, relevé en ${f.year}` : ''}`;
  return { v: f.v, node: <span class={stale ? 'stale' : ''} title={title}>{f.err ? '≈ ' : ''}{fmt(f.v)}{stale ? <sup> {f.year}</sup> : null}</span> };
}

/** Their figure as known, for a comparison: value, margin (%), year, or only a lower bound (ships in sight, colonies found). */
function theirFigure(g: GameState, me: Player, pid: number, key: FactKey, sc?: ScoreEntry): { v: number; err: number; year: number; atLeast?: boolean } | null {
  if (scoresOpen(g)) return { v: Number(sc?.[key] ?? 0), err: 0, year: g.year };
  const f = me.intel.dossiers?.[pid]?.facts[key];
  const ships = key === 'unarmed' || key === 'escort' || key === 'capital';
  const lower = ships ? I.visibleShips(g, me, pid)[key] : key === 'planets' ? me.intel.planets.filter(pi => pi.owner === pid).length : 0;
  if (f) return { v: ships && f.year === g.year ? Math.max(f.v, lower) : f.v, err: f.err, year: f.year };
  return lower > 0 ? { v: lower, err: 0, year: g.year, atLeast: true } : null;
}

/** Better or worse than us, and by how much (against our own figure of the same year). */
export function Versus({ g, me, pid, k, sc }: { g: GameState; me: Player; pid: number; k: FactKey; sc?: ScoreEntry }) {
  const t = theirFigure(g, me, pid, k, sc);
  if (!t) return <span class="muted" title="Leur chiffre est inconnu">–</span>;
  const mine = (t.year < g.year ? me.scores.find(x => x.year === t.year) : undefined) ?? me.scores[me.scores.length - 1];
  const ours = Number(mine?.[k] ?? 0);
  const tip = `${t.atLeast ? 'Au moins ' : t.err ? 'Environ ' : ''}${fmt(t.v)} contre ${fmt(ours)} chez vous${t.year < g.year ? ` en ${t.year}` : ''}${t.err ? ` (estimation à ±${t.err} %)` : ''}`;
  if (t.atLeast && t.v <= ours) return <span class="muted" title={`${tip} : impossible de dire qui l'emporte`}>–</span>;
  if (t.err && ours >= t.v * (1 - t.err / 100) && ours <= t.v * (1 + t.err / 100)) return <span class="vs unsure" title={`${tip} : votre chiffre est dans la marge d'erreur`}>≈ Comparable à vous (incertain)</span>;
  const gap = I.gapOf(t.v, ours);
  if (gap === 'equal') return <span class="vs eq" title={tip}>= Comme vous</span>;
  const up = t.v > ours;
  return <span class={'vs ' + (up ? 'up' : 'down')} title={tip}>{up ? '▲ Mieux que vous' : '▼ Moins bien que vous'}, {t.atLeast ? 'au moins ' : ''}{I.GAP_WORDS[gap]}</span>;
}

/** A level of theirs against ours (technology by field). */
const diff = (d: number) => d === 0 ? <span class="vs eq" title="comme vous"> (=)</span> : <span class={'vs ' + (d > 0 ? 'up' : 'down')} title={d > 0 ? `${d} niveau${d > 1 ? 'x' : ''} de plus que vous` : `${-d} niveau${d < -1 ? 'x' : ''} de moins que vous`}> ({d > 0 ? '+' : '−'}{Math.abs(d)})</span>;

/** Where spies are paid: the capital, else the most populous world. */
function payer(g: GameState, me: Player): Planet | null {
  return capitalOf(g, me) ?? g.planets.filter(p => p.owner === me.id).sort((a, b) => b.pop - a.pop)[0] ?? null;
}

const dated = (g: GameState, year: number) => year < g.year ? <span class="muted"> (relevé en {year})</span> : null;

/** The dossier on an empire: level and sources, figures, technology, research, victory, objectives, spies. */
export function DossierBlock({ pid }: { pid: number }) {
  const s = useStore();
  const g = s.game!, me = s.me!;
  if (!I.intelOn(g)) return null;
  const o = g.players[pid];
  const d = me.intel.dossiers?.[pid];
  const level = d?.level ?? 0;
  const next = I.nextSteps(level)[0];
  const net = d?.network ?? 0;
  const pay = payer(g, me);
  const spyWhy = I.spyBlocker(g, me, pid);
  const queued = g.planets.filter(pl => pl.owner === me.id).reduce((a, pl) => a + pl.queue.filter(q => q.kind === 'spy' && q.bountyOn === pid).reduce((b, q) => b + q.qty, 0), 0);
  const addSpies = (n: number) => {
    if (!pay) return;
    A.queueAdd(pay.id, 'spy', undefined, n, 0, undefined, undefined, pid);
    store.notify(`Commande de ${n} unité${n > 1 ? 's' : ''} d'espions chez les ${o.name} (${n * I.SPY_UNIT} R) ajoutée en tête de la file de ${pay.name}.`);
  };
  const pr = DIP.pairOf(g, me.id, pid);
  const agency = I.agencyOf(g, me.id);
  // what they know of you: your diplomats or your spies can tell
  const theirs = o.intel.dossiers?.[me.id]?.level ?? 0;
  const tellsYou = pr?.embassy !== undefined && pr.status !== 'war' ? 'selon vos diplomates' : level >= 50 ? 'selon vos espions' : null;
  const sc = o.scores[o.scores.length - 1];
  const mineSc = me.scores[me.scores.length - 1];
  return <div class="dossier">
    <div class="dossier-head"><b>Renseignement</b> <IntelLevel me={me} pid={pid} /><span class="small muted">/100</span>
      {next ? <span class="small muted"> · prochain palier à {next.at} : {next.what}</span> : <span class="small green"> · rien ne vous échappe</span>}</div>
    {d?.lines.length ? <div class="diplo-why">{d.lines.map(l => <span class="chip small">{l.label} <b class="green">+{l.value}</b></span>)}</div>
      : <p class="small muted">Aucune source cette année.</p>}
    <div class="dossier-grid">
      <table class="report compact dossier-facts">
        <thead><tr><th /><th class="num" title={`Ce que vous savez des ${o.name}`}>{o.name}</th><th class="num mine" title="Vos propres chiffres, cette année">Vous</th><th /><th /></tr></thead>
        <tbody>
        {I.FACTS.map(f => {
          const fact = scoresOpen(g) ? undefined : d?.facts[f.key];
          const step = scoresOpen(g) || (fact && !fact.err) ? '' : fact ? `exact dès le renseignement ${f.exact}` : `estimation dès le renseignement ${f.approx}`;
          // 0.3.7: our own figure beside theirs
          return <tr><td>{f.label}</td><td class="num">{known(g, me, pid, f.key, sc).node}</td><td class="num mine">{fmt(Number(mineSc?.[f.key] ?? 0))}</td><td class="small vs-cell"><Versus g={g} me={me} pid={pid} k={f.key} sc={sc} /></td><td class="small muted">{step}</td></tr>;
        })}
      </tbody></table>
      <div class="dossier-more small">
        <div><b>Technologie :</b> {d?.techs ? <>{FIELDS.map((f, i) => <>{i ? ' · ' : ''}{FIELD_NAMES[f]} {d.techs!.v[f]}{diff(d.techs!.v[f] - me.tech[f])}</>)}{dated(g, d.techs.year)}</> : <span class="muted">domaine par domaine dès le renseignement {I.STEPS.techs}</span>}</div>
        <div><b>Recherche en cours :</b> {d?.research ? <>{FIELD_NAMES[d.research.field]}{dated(g, d.research.year)}</> : <span class="muted">{`à partir du renseignement ${I.STEPS.research}`}</span>}</div>
        <div><b>Conditions de victoire remplies :</b> {d?.victory ? <>{d.victory.v} sur {g.settings.victory.numCriteria} nécessaires{dated(g, d.victory.year)}</> : <span class="muted">{`à partir du renseignement ${I.STEPS.victory}`}</span>}</div>
        {objectivesOn(g) && <div><b>Objectifs secrets :</b> {d?.objectives ? <>{d.objectives.list.map((x, i) => <>{i ? ' ; ' : ''}{objectiveText(g, x)}{x.done ? ' (accompli)' : x.failed ? ' (manqué)' : ''}</>)}{dated(g, d.objectives.year)}</> : <span class="muted">{`à partir du renseignement ${I.STEPS.objectives}`}</span>}</div>}
        {tellsYou && <div><b>Ce qu'ils savent de vous :</b> renseignement {theirs}/100 ({tellsYou})</div>}
      </div>
    </div>
    <div class="diplo-act dossier-spies">
      <span class="small"><b>Réseau d'espions</b> : {net >= 1 ? <>force {Math.round(net)} (soit {Math.min(I.SPY_CAP, Math.round(net))} points de renseignement), risque d'être démasqué ≈ {Math.round(I.detectChance(g, me, pid, net) * 100)} % par an</> : 'aucun'}{queued ? <span class="muted"> · {queued} unité{queued > 1 ? 's' : ''} en commande</span> : null}</span>
      {spyWhy || !pay ? <span class="small muted">{spyWhy ?? 'aucune planète pour payer'}</span>
        : <span class="row-btns"><button class="small" onClick={() => addSpies(1)} title={`${I.SPY_UNIT} R, payés par la production de ${pay.name}`}>+1 unité ({I.SPY_UNIT} R)</button> <button class="small" onClick={() => addSpies(3)}>+3 unités</button></span>}
    </div>
    <p class="small muted">Chaque unité ajoute {I.spyGain(g, me)} de force (maximum {I.SPY_MAX}) ; un réseau s'use de {Math.round(I.SPY_DECAY * 100)} % par an et, démasqué, perd l'essentiel de sa force et leur sympathie. {agency ? <>Votre Agence de renseignement (sur {agency.name}) renforce vos réseaux et protège des leurs.</> : <>Une Agence de renseignement (une par empire, {FIELD_NAMES.electronics} {I.AGENCY_REQ.electronics}) renforcerait vos réseaux et protégerait des leurs.</>}</p>
    <p class="small muted">Sources de renseignement : leurs mondes sous vos scanners pénétrants ou vos vaisseaux en orbite (jusqu'à 35, +5 pour la capitale), leurs vaisseaux identifiés (10), ambassades (25), accords (10 chacun), alliance (20), réseau d'espions (jusqu'à {I.SPY_CAP}), combats et conquêtes récents, ce que partagent vos alliés (jusqu'à 20).</p>
  </div>;
}
