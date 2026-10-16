// Research page: fields with estimated (random) breakthroughs, and the technologies within reach.
import { useState } from 'preact/hooks';
import { useStore, fmt, fmtPeople } from '../store';
import { Modal, Bar, Row, Num, CompIcon, HullImg, useSorted } from '../components';
import { FIELDS, type Field } from '../../engine/types';
import { FIELD_NAMES, TECHS, HULLS, canLearn, meetsLevels, FIELD_KEYS, hasTech, CATEGORY_NAMES, mainField } from '../../engine/tech';
import { TECH_HORIZON, researchCost, MAX_TECH, estimateNextLevel, techOdds, earliestLevel, pointsToReach, breakthroughChance, researchPace, yearsFor, goalTarget, goalProgress, type Pace } from '../../engine/research';
import { planetSpec } from '../../engine/planet';
import { raceSpec, researchCostFactor } from '../../engine/race';
import { tl } from '../../data/labels';
import { specialsOf, hasSpecial } from '../../engine/specials';
import { TechTip, techInfo, specialInfo, fieldInfo } from '../techinfo';
import type { HullData, TechData } from '../../data/types';
import type { GameState, Player } from '../../engine/types';
import { DOCTRINE_FORKS } from '../../engine/doctrines';
import { MEGAPROJECTS, megaVisible, techMissing, type MegaInfo } from '../../engine/megaprojects';
import { resolveGoal, goalReached, levelsReq, type GoalItem } from '../../engine/goals';
import type { SpecialTech } from '../../engine/specials';
import * as A from '../actions';
import { upgradeTargets } from '../../engine/upgrade';
import { partBrief } from './designer';

/** How many levels ahead the scientists can foresee; beyond, technologies show as "??????". */
export const HORIZON = TECH_HORIZON;

type Item = TechData | HullData;

function catOf(t: Item): string {
  if ('slots' in t) return (t as HullData).starbase ? 'StarbaseHull' : 'ShipHull';
  return (t as TechData).cat;
}
const catLabel = (c: string) => (CATEGORY_NAMES[c] ?? c).toLowerCase();

function yearsText(n: number): string { return !Number.isFinite(n) ? 'jamais au rythme actuel' : n <= 1 ? '≈ 1 an' : `≈ ${n} ans`; }

export function ResearchDialog() {
  const s = useStore();
  const g = s.game!, me = s.me!;
  const [view, setView] = useState<Field | 'all'>(me.researching);
  const planets = g.planets.filter(p => p.owner === me.id);
  const total = planets.reduce((a, p) => a + planetSpec(g, p, me).resources, 0);
  const budget = planets.reduce((a, p) => a + planetSpec(g, p, me).resourcesResearch, 0);
  const rs = raceSpec(me.race);
  const perYear = Math.trunc(Math.max(budget, me.researchLastYear) * rs.researchFactor + 0.5);
  const luck = !!g.settings.randomResearch;
  const set = (fn: () => void) => { s.checkpoint(); fn(); s.bump(); };
  const pace = researchPace(me, perYear);
  const cur = estimateNextLevel(g, me, me.researching, pace);
  const g0 = resolveGoal(g, me.researchGoal);
  const goal = g0 && !goalReached(me, g0) ? g0 : undefined;
  return (
    <Modal title="Recherche" wide onClose={() => s.close('research')} footer={<button class="primary" onClick={() => s.close('research')}>Terminé</button>}
      sub={<>Domaine en cours : {FIELD_NAMES[me.researching]} · niveau {me.tech[me.researching] + 1} {luck ? `${yearsText(cur.years)} (estimation)` : `dans ${cur.years} an${cur.years > 1 ? 's' : ''}`} · {fmt(perYear)} points par an</>}>
      <div class="research">
        <div class="r-fields">
          <table class="fields" data-tut="fields">
            <thead><tr><th></th><th>Domaine</th><th>Niv.</th><th>Progression vers le niveau suivant</th><th title="Chance de percée l'an prochain si le domaine reçoit toute la recherche">Cette année</th><th>Niveau suivant</th></tr></thead>
            <tbody>{FIELDS.map(f => {
              const cost = researchCost(g, me, f);
              const est = estimateNextLevel(g, me, f, pace);
              const r = cost ? me.researchSpent[f] / cost : 0;
              return <tr class={(f === view ? 'sel ' : '') + (f === me.researching ? 'cur' : '')} onClick={() => setView(f)}>
                <td><input type="radio" name="researching" checked={me.researching === f} onClick={e => { e.stopPropagation(); setView(f); if (me.researching !== f) set(() => { me.researching = f; me.researchGoal = undefined; }); }} onChange={() => {}} title="Rechercher ce domaine" /></td>
                <td><TechTip info={() => fieldInfo(g, me, f)}>{FIELD_NAMES[f]}</TechTip> <span class="muted small">{me.race.researchCost[f] === 'less' ? '−50 %' : me.race.researchCost[f] === 'extra' ? '+75 %' : ''}</span></td>
                <td class="b">{me.tech[f]}</td>
                <td>{me.tech[f] >= MAX_TECH ? 'maximum atteint' : <div class="rbar"><Bar value={me.researchSpent[f]} max={cost * (luck ? 1.3 : 1)} color={r >= 0.5 && luck ? '#4fd6e3' : '#3a7fbf'} label={`${fmt(me.researchSpent[f])} / ${fmt(cost)}`} />{luck && <><i class="tick" style={{ left: 50 / 1.3 + '%' }} title="Les percées deviennent possibles" /><i class="tick strong" style={{ left: 100 / 1.3 + '%' }} title="Coût nominal du niveau" /></>}</div>}</td>
                <td class="small">{me.tech[f] >= MAX_TECH ? '' : luck ? <span class={est.chanceThisYear >= 0.5 ? 'good' : est.chanceThisYear > 0 ? '' : 'muted'}>{Math.round(est.chanceThisYear * 100)} %</span> : est.chanceThisYear ? 'oui' : 'non'}</td>
                <td class="small">{me.tech[f] >= MAX_TECH ? '' : luck ? <span title={`Entre ${est.low} et ${est.high} ans dans 8 cas sur 10, si le domaine reçoit toute la recherche`}>{yearsText(est.years)}{est.high > est.low ? <span class="muted"> ({est.low}–{est.high})</span> : ''}</span> : `${est.years} a`}</td>
              </tr>;
            })}</tbody>
          </table>
          <div class="r-next">
            <Row k="Après une percée, passer à" v={<select value={me.nextField} onChange={e => set(() => { me.nextField = (e.target as HTMLSelectElement).value as any; })}>
              <option value="same">Même domaine</option><option value="lowest">Domaine le plus bas</option>{FIELDS.map(f => <option value={f}>{FIELD_NAMES[f]}</option>)}
            </select>} />
          </div>
        </div>
        <div class="r-side" data-tut="budget">
          <h4>Budget</h4>
          <Row k="Ressources annuelles" v={fmt(total)} />
          <Row k="Dépensé l'an dernier" v={fmt(me.researchLastYear)} />
          <Row k="Part consacrée à la recherche" v={<><Num value={me.researchPct} min={0} max={100} onChange={v => set(() => { me.researchPct = Math.max(0, Math.min(100, v)); })} width={60} /> %</>} />
          <Row k="Budget prévu l'an prochain" v={<>{fmt(budget)} <span class="muted small">+ ressources non utilisées</span></>} />
          {rs.researchFactor !== 1 && <p class="small muted">Recherche généralisée : 50 % au domaine choisi, 15 % à chacun des autres.</p>}
          <h4>Objectif</h4>
          {goal ? <div class="goal">
            <div><b>{tl(goal.name)}</b> <span class="muted small">≈ {Math.round(goalProgress(g, me, goal) * 100)} % · {goalYears(g, me, goal, pace)}</span></div>
            <div class="small muted">Les domaines nécessaires sont choisis automatiquement jusqu'à l'obtention.</div>
            <button class="small" onClick={() => set(() => { me.researchGoal = undefined; })}>Abandonner l'objectif</button>
          </div> : <p class="small muted">Aucun. « Cibler cette technologie », dans le tableau ci-dessous, oriente la recherche automatiquement.</p>}
          {luck && <p class="small muted">Les percées sont aléatoires : dès la moitié du coût d'un niveau, chaque année donne une chance de l'atteindre, d'autant plus forte qu'on approche du coût ; au-delà, elle continue de monter jusqu'à la certitude (130 %). Les points en trop passent au niveau suivant.</p>}
          <p class="small muted">Coût du niveau suivant = (base du niveau + 10 × somme de vos niveaux) × {researchCostFactor(me.race.researchCost[me.researching])}.</p>
        </div>
      </div>
      {g.settings.doctrines && <Doctrines g={g} me={me} />}
      <TechHorizon g={g} me={me} view={view} setView={setView} pace={pace} />
      <KnownTechs g={g} me={me} />
    </Modal>
  );
}

/** Constellations 3: exclusive doctrines, one choice per fork, final. */
function Doctrines({ g, me }: { g: GameState; me: Player }) {
  const [confirm, setConfirm] = useState<{ fork: string; pick: 'a' | 'b' } | null>(null);
  return <section class="doctrines" id="doctrines">
    <div class="hz-head"><h3>Doctrines</h3><span class="small muted">À certains niveaux, il faut choisir entre deux doctrines. Le choix est définitif : l'autre voie se ferme pour toujours.</span></div>
    <div class="doc-grid">{DOCTRINE_FORKS.map(f => {
      const pick = me.doctrines?.[f.id];
      const reached = me.tech[f.field] >= f.level;
      const opt = (k: 'a' | 'b') => {
        const o = f[k];
        const state = pick ? (pick === k ? 'chosen' : 'closed') : reached ? 'open' : 'later';
        const asking = confirm?.fork === f.id && confirm.pick === k;
        return <div class={'doc-opt ' + state}>
          <div class="doc-name">{o.name}</div>
          <div class="doc-eff">{o.effect}</div>
          <div class="small muted">{o.detail}</div>
          {state === 'open' && (asking
            ? <div class="btns"><button class="small primary" onClick={() => { A.pickDoctrine(f.id, k); setConfirm(null); }}>Confirmer : {o.name}</button><button class="small" onClick={() => setConfirm(null)}>Annuler</button></div>
            : <button class="small" onClick={() => setConfirm({ fork: f.id, pick: k })}>Adopter</button>)}
          {state === 'chosen' && <span class="tag">adoptée</span>}
          {state === 'closed' && <span class="tag off">fermée</span>}
        </div>;
      };
      return <div class={'doc-fork' + (reached && !pick ? ' pending' : '')}>
        <div class="doc-title"><b>{f.title}</b> <span class="muted small">{FIELD_NAMES[f.field]} {f.level}{reached ? '' : ` (vous êtes au niveau ${me.tech[f.field]})`}</span></div>
        <div class="doc-pair">{opt('a')}<span class="doc-or">ou</span>{opt('b')}</div>
      </div>;
    })}</div>
  </section>;
}

function goalYears(g: GameState, me: Player, t: GoalItem, pace: Pace): string {
  const target = goalTarget(g, me, t, HORIZON);
  if (!target) return '';
  const pts = pointsToReach(g, me, target);
  return pace(1) > 0 ? `${yearsText(yearsFor(pts, pace))} (estimation)` : '';
}

/** Sets the research goal (component, hull, technology without a component or megaproject). */
function setGoal(s: ReturnType<typeof useStore>, g: GameState, me: Player, name: string) {
  const item = resolveGoal(g, name);
  if (!item) return;
  s.checkpoint();
  me.researchGoal = name;
  const tg = goalTarget(g, me, item, HORIZON);
  me.researchGoalStart = tg ? pointsToReach(g, me, tg) : undefined;
  s.bump();
  s.notify(`Objectif de recherche : ${tl(name)}`);
}

/** Technologies foreseeable within HORIZON levels, with the chance that each level unlocks them. */
function TechHorizon({ g, me, view, setView, pace }: { g: GameState; me: Player; view: Field | 'all'; setView: (v: Field | 'all') => void; pace: Pace }) {
  const s = useStore();
  const fuzzy = !!g.settings.fuzzyTechTree;
  const items: Item[] = [...TECHS.values(), ...HULLS.values()].filter(t => canLearn(me.race, t.req) && !t.req.acquirable && !hasTech(me, t) && mainField(t.req));
  const fields = view === 'all' ? FIELDS : [view];
  // components and hulls (chances), technologies without a component and megaprojects (fixed levels): one table
  type HRow = { key: string; f: Field; chance: number[]; median: number; others: { field: Field; level: number }[]; years: number; t?: Item; sp?: SpecialTech; m?: MegaInfo };
  const rows: HRow[] = [];
  const beyond = new Map<string, { f: Field; cat: string; n: number; from: number }>();
  for (const t of items) {
    const f = mainField(t.req)!;
    if (!fields.includes(f)) continue;
    const c = me.tech[f];
    if (earliestLevel(g, t) > c + HORIZON) {
      const key = f + '|' + catOf(t);
      const b = beyond.get(key) ?? { f, cat: catOf(t), n: 0, from: c + HORIZON };
      b.n++; beyond.set(key, b);
      continue;
    }
    const odds = techOdds(g, me, t, c + HORIZON);
    if (!odds) continue;
    const target: Partial<Record<Field, number>> = { [f]: odds.median };
    for (const x of odds.others) target[x.field] = x.level;
    const years = pace(1) > 0 ? yearsFor(pointsToReach(g, me, target), pace) : Infinity;
    rows.push({ key: t.name, f, chance: [1, 2, 3, 4, 5].map(k => odds.byLevel[k - 1]?.chance ?? 1), median: odds.median, others: odds.others, years, t });
  }
  const fixedRow = (key: string, f: Field, req: Partial<Record<Field, number>>, extra: Partial<HRow>): HRow => {
    const c = me.tech[f], lvl = req[f] ?? 0;
    const others = (Object.entries(req) as [Field, number][]).filter(([f2, l]) => f2 !== f && me.tech[f2] < l).map(([field, level]) => ({ field, level }));
    return { key, f, chance: [1, 2, 3, 4, 5].map(k => c + k >= lvl ? 1 : 0), median: lvl, others, years: pace(1) > 0 ? yearsFor(pointsToReach(g, me, req), pace) : Infinity, ...extra };
  };
  // Constellations technologies without a component (automatic exploration, wormhole navigation)
  for (const sp of specialsOf(g)) {
    if (hasSpecial(me, sp) || !fields.includes(sp.field)) continue;
    const c = me.tech[sp.field];
    if (sp.fuzzy && g.settings.fuzzyTechTree) {
      // on the hidden tree: odds per level, like a component
      const item = { name: sp.name, req: levelsReq(sp.req) };
      if (earliestLevel(g, item) > c + HORIZON) continue;
      const odds = techOdds(g, me, item, c + HORIZON);
      if (!odds) continue;
      const target: Partial<Record<Field, number>> = { [sp.field]: odds.median };
      for (const x of odds.others) target[x.field] = x.level;
      rows.push({ key: sp.name, f: sp.field, chance: [1, 2, 3, 4, 5].map(k => odds.byLevel[k - 1]?.chance ?? 1), median: odds.median, others: odds.others, years: pace(1) > 0 ? yearsFor(pointsToReach(g, me, target), pace) : Infinity, sp });
    } else if ((sp.req[sp.field] ?? 0) <= c + HORIZON) rows.push(fixedRow(sp.name, sp.field, sp.req, { sp }));
  }
  // megaprojects come into view like technologies, within HORIZON levels of every field they need
  const megaMain = (m: MegaInfo): Field => (Object.keys(m.req) as Field[]).reduce((a, f) => (m.req[f] ?? 0) - me.tech[f] > (m.req[a] ?? 0) - me.tech[a] ? f : a);
  if (g.settings.megaprojects) for (const m of MEGAPROJECTS) if (megaVisible(me, m) && techMissing(me, m) && fields.includes(megaMain(m))) rows.push(fixedRow(m.name, megaMain(m), m.req, { m }));
  const nameOf = (r: HRow) => r.t ? tl(r.t.name) : r.key;
  rows.sort((a, b) => (a.median - me.tech[a.f]) - (b.median - me.tech[b.f]) || a.years - b.years || nameOf(a).localeCompare(nameOf(b)));
  const chanceAt = (r: HRow, k: number) => r.chance[k - 1] ?? 1;
  const { sorted, th } = useSorted(rows, [
    { key: 'name', get: r => nameOf(r) }, { key: 'field', get: r => FIELDS.indexOf(r.f) * 100 + me.tech[r.f] },
    ...[1, 2, 3, 4, 5].map(k => ({ key: 'k' + k, get: (r: typeof rows[number]) => chanceAt(r, k), num: true })),
    { key: 'years', get: r => Number.isFinite(r.years) ? r.years : 1e9, num: true }, { key: 'order', get: r => rows.indexOf(r), num: true },
  ], 'years', 1); // 3.4.1: the soonest first (ties: fewest levels to go, then name)
  const open = !s.collapsed['rs-horizon'];
  const toggle = () => { s.collapsed['rs-horizon'] = open; s.savePrefs(); s.bump(); };
  const count = rows.length;
  if (!open) return <section class="horizon closed"><div class="hz-head"><h3><button class="fold" aria-expanded={false} onClick={toggle}><span class="caret">▸</span> Technologies à portée <span class="muted small">({count})</span></button></h3></div></section>;
  return <section class="horizon">
    <div class="hz-head">
      <h3><button class="fold" aria-expanded={true} onClick={toggle}><span class="caret">▾</span> Technologies à portée <span class="muted small">({count})</span></button></h3>
      <div class="chips">{[['all', 'Tous les domaines'] as const, ...FIELDS.map(f => [f, FIELD_NAMES[f]] as const)].map(([k, l]) => <button class={view === k ? 'on' : ''} onClick={() => setView(k as Field | 'all')}>{l}</button>)}</div>
    </div>
    <p class="small muted">{fuzzy ? 'Dans chaque partie, le niveau qui débloque une technologie est décalé au hasard, jusqu\'à deux niveaux plus tôt ou plus tard : vos scientifiques ne peuvent donner que des chances. ' : ''}Au-delà de {HORIZON} niveaux d'avance, les technologies restent inconnues (??????). Les délais sont des estimations : toute la recherche consacrée à la technologie visée, au rythme actuel augmenté de la croissance récente de votre empire.</p>
    <div class="report-scroll"><table class="report hz">
      <thead><tr>{th('name', 'Technologie')}{view === 'all' && th('field', 'Domaine', { num: false })}{[1, 2, 3, 4, 5].map(k => th('k' + k, view === 'all' ? `+${k} niv.` : `Niv. ${me.tech[view] + k}`, { title: `Chance qu'elle soit débloquée une fois le domaine monté de ${k} niveau${k > 1 ? 'x' : ''}` }))}<th>Autres prérequis</th>{th('years', 'Délai estimé', { num: false })}<th></th></tr></thead>
      <tbody>
        {sorted.map(r => {
          const isGoal = me.researchGoal === r.key;
          const name = r.t
            ? <span class="hz-name">{'slots' in r.t ? <HullImg hull={r.t.name} color={me.color} w={30} /> : <CompIcon name={r.t.name} size={22} />}<span><TechTip info={() => techInfo(g, me, r.t!, HORIZON)}>{tl(r.t.name)}</TechTip><div class="muted small">{catLabel(catOf(r.t))}</div></span></span>
            : r.sp ? <span class="hz-name"><CompIcon name="" size={22} /><span><TechTip info={() => specialInfo(g, me, r.sp!)}>{r.sp.name}</TechTip><div class="muted small">{r.sp.what}</div></span></span>
            : <span class="hz-name"><span class="qm mega">✦</span><span><TechTip info={() => ({ title: r.m!.name, kind: 'Grand projet', lines: [r.m!.effect, `Au moins ${r.m!.minYears} ans de travaux sur une planète de ${fmtPeople(r.m!.minPop)} habitants ou plus.`], stats: [] })}>{r.m!.name}</TechTip><div class="muted small">grand projet</div></span></span>;
          return <tr class={(isGoal ? 'goal-row ' : '') + (r.t ? '' : 'special')}>
            <td>{name}</td>
            {view === 'all' && <td>{FIELD_NAMES[r.f]} <span class="muted small">({me.tech[r.f]})</span></td>}
            {[1, 2, 3, 4, 5].map(k => { const pc = Math.round(chanceAt(r, k) * 100); return <td class="num" title={`${FIELD_NAMES[r.f]} niveau ${me.tech[r.f] + k}`}><span class={'pc ' + (pc >= 100 ? 'p100' : pc >= 50 ? 'p50' : pc > 0 ? 'p1' : 'p0')}>{pc} %</span></td>; })}
            <td class="small wrap">{r.others.length ? r.others.map(o => `${FIELD_NAMES[o.field]} ${o.level}`).join(', ') : <span class="muted">—</span>}</td>
            <td class="small">{yearsText(r.years)}</td>
            <td>{isGoal ? <span class="tag">objectif</span> : <button class="small" onClick={() => setGoal(s, g, me, r.key)}>{r.m ? 'Cibler ce projet' : 'Cibler cette technologie'}</button>}</td>
          </tr>;
        })}
        {[...beyond.values()].sort((a, b) => FIELDS.indexOf(a.f) - FIELDS.indexOf(b.f)).map(b => <tr class="unknown">
          <td><span class="hz-name"><span class="qm">?</span><span><TechTip info={() => ({ title: '??????', kind: CATEGORY_NAMES[b.cat] ?? b.cat, lines: [`Vos scientifiques savent qu'il existe ${b.n > 1 ? `${b.n} technologies` : 'une technologie'} de ce type plus loin en ${FIELD_NAMES[b.f]}, mais pas ce qu'elle${b.n > 1 ? 's' : ''} fer${b.n > 1 ? 'ont' : 'a'} ni quand. Elle${b.n > 1 ? 's' : ''} apparaîtr${b.n > 1 ? 'ont' : 'a'} ici une fois le domaine à moins de ${HORIZON} niveaux.`], stats: [] })}>??????</TechTip><div class="muted small">meilleure technologie : {catLabel(b.cat)}</div></span></span></td>
          {view === 'all' && <td>{FIELD_NAMES[b.f]}</td>}<td colSpan={5} class="muted small">au-delà du niveau {b.from} : rien n'est prévisible</td><td /><td /><td />
        </tr>)}
        {rows.length === 0 && beyond.size === 0 && <tr><td colSpan={10} class="muted">Toutes les technologies de ce domaine sont acquises.</td></tr>}
      </tbody>
    </table></div>
  </section>;
}

/**
 * Technologies already found (3.2.5), folded like the horizon above. A component that improves some of your designs
 * offers to put it in all of them at once (see engine/upgrade.ts).
 */
function KnownTechs({ g, me }: { g: GameState; me: Player }) {
  const s = useStore();
  const open = !(s.collapsed['rs-known'] ?? true);
  const toggle = () => { s.collapsed['rs-known'] = open; s.savePrefs(); s.bump(); };
  const [cat, setCat] = useState<string>('upg');
  const owned: Item[] = [...TECHS.values(), ...HULLS.values()].filter(t => hasTech(me, t));
  const designs = g.designs.filter(d => d.owner === me.id && !d.deleted);
  const rows = owned.map(t => {
    const isHull = 'slots' in t;
    const f = mainField(t.req);
    const used = designs.filter(d => isHull ? d.hull === t.name : d.slots.some(x => x.part === t.name)).length;
    const upg = isHull ? [] : upgradeTargets(g, me, t.name);
    return { t, isHull, f, lvl: f ? (t.req as any)[FIELD_KEYS[f]] ?? 0 : 0, used, upg, cat: catOf(t) };
  });
  const cats = [...new Set(rows.map(r => r.cat))];
  const upgradable = rows.filter(r => r.upg.length > 0).length;
  const shown = rows.filter(r => cat === 'all' || (cat === 'upg' ? r.upg.length > 0 : r.cat === cat));
  const { sorted, th } = useSorted(shown, [
    { key: 'name', get: r => tl(r.t.name) }, { key: 'cat', get: r => catLabel(r.cat) }, { key: 'lvl', get: r => (r.f ? FIELDS.indexOf(r.f) : 9) * 100 + r.lvl, num: true },
    { key: 'used', get: r => r.used, num: true }, { key: 'upg', get: r => r.upg.length, num: true },
  ], 'lvl', -1);
  const head = <h3><button class="fold" aria-expanded={open} onClick={toggle}><span class="caret">{open ? '▾' : '▸'}</span> Technologies déjà trouvées <span class="muted small">({owned.length}{upgradable ? ` · ${upgradable} peuvent améliorer vos modèles` : ''})</span></button></h3>;
  if (!open) return <section id="known-techs" class="horizon known closed"><div class="hz-head">{head}</div></section>;
  const doUpgrade = (r: typeof rows[number]) => s.open('upgrade', { part: r.t.name });

  return <section id="known-techs" class="horizon known">
    <div class="hz-head">
      {head}
      <div class="chips">{[['upg', `À intégrer (${upgradable})`], ['all', 'Toutes'], ...cats.map(c => [c, CATEGORY_NAMES[c] ?? c])].map(([k, l]) => <button class={cat === k ? 'on' : ''} onClick={() => setCat(k)}>{l}</button>)}</div>
    </div>
    <div class="report-scroll"><table class="report hz known-t">
      <thead><tr>{th('name', 'Technologie')}{th('cat', 'Type')}{th('lvl', 'Niveau', { title: 'domaine principal et niveau requis' })}<th>Caractéristiques</th>{th('used', 'Modèles', { title: 'vos modèles en production qui l\'utilisent' })}{th('upg', 'Mise à jour', { title: 'vos modèles qu\'elle améliorerait' })}</tr></thead>
      <tbody>{sorted.map(r => <tr>
        <td><span class="hz-name">{r.isHull ? <HullImg hull={r.t.name} color={me.color} w={30} /> : <CompIcon name={r.t.name} size={22} />}<span><TechTip info={() => techInfo(g, me, r.t, HORIZON)}>{tl(r.t.name)}</TechTip>{r.t.req.acquirable && <span class="tag">extraterrestre</span>}</span></span></td>
        <td class="small">{catLabel(r.cat)}</td>
        <td class="small">{r.f ? `${FIELD_NAMES[r.f]} ${r.lvl}` : '—'}</td>
        <td class="small wrap">{r.isHull ? `blindage ${(r.t as HullData).armor} · carburant ${(r.t as HullData).fuel} · soute ${(r.t as HullData).cargo}` : partBrief(r.t as TechData)}</td>
        <td class="num">{r.used || <span class="muted">0</span>}</td>
        <td>{r.upg.length ? <button class="small primary" title={r.upg.map(u => `${u.design.name} : ${u.replaced.map(x => tl(x)).join(', ')} → ${tl(r.t.name)}`).join('\n')} onClick={() => doUpgrade(r)}>Mettre à jour {r.upg.length} modèle{r.upg.length > 1 ? 's' : ''}</button> : <span class="muted small">—</span>}</td>
      </tr>)}
      {sorted.length === 0 && <tr><td colSpan={6} class="muted">{cat === 'upg' ? 'Aucune technologie trouvée ne peut améliorer vos modèles actuels.' : 'Rien dans cette catégorie.'}</td></tr>}</tbody>
    </table></div>
  </section>;
}

/** Shared by the technology catalogue: what the player may know about an item. */
export function knownState(g: GameState, me: Player, t: Item): 'have' | 'horizon' | 'unknown' {
  if (hasTech(me, t)) return 'have';
  const f = mainField(t.req);
  if (!f) return 'horizon';
  return earliestLevel(g, t) > me.tech[f] + HORIZON ? 'unknown' : 'horizon';
}

export { meetsLevels, FIELD_KEYS, breakthroughChance };
