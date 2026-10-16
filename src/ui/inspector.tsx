// Right panel: everything about the selected planet or fleet, with the actions that make sense for it.
import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { store, useStore, fmt, fmtPop, fmtGrowth, pct, MINERAL_COLORS } from './store';
import { HabBar, HullImg, Row, Num, Bar, WarpBar, Cost } from './components';
import type { Fleet, GameState, Planet, Player, WaypointTask } from '../engine/types';
import { habitability, habString, HAB_NAMES, raceSpec } from '../engine/race';
import { planetSpec, terraformRemaining, maxPopulation } from '../engine/planet';
import { fleetSpec, estimateRoute, canPassThrough } from '../engine/fleet';
import { canUseWormholes, WORMHOLE_NAV, specialReqText, specialLevelText } from '../engine/specials';
import { terrainAt, terrainName, terrainOnLeg, TERRAIN_INFO } from '../engine/terrain';
import { specOf, type DesignSpec } from '../engine/design';
import { itemLabel, isAuto, estimateQueue, maxBuildable , queueBottleneck } from '../engine/production';
import { minefieldsOnLeg, gateCheck, type GateCheck } from '../engine/movement';
import { MissionBlock } from './missionui';
import { DiscoveryBlock } from './discoveries';
import { needsFuel, refuelOptions } from '../engine/refuel';
import { canAutoExplore, AUTO_EXPLORE } from '../engine/automation';
import { FuelCargo, WarpTable, TaskDetails, TASK_LABELS, taskPossible, wpName } from './command';
import { SummaryPane } from './summary';
import { itemTip } from './dialogs/production';
import { tl } from '../data/labels';
import { RACE_ICONS } from './art';
import { CultureBlock, TerritoryNote, ClaimBlock, BeaconPanel } from './culture';
import * as A from './actions';
import { capitalOf, ADMIN_RADIUS, ADMIN_LOSS, ADMIN_STEP, ADMIN_FLOOR, CONQUEST_YEARS } from '../engine/empire';
import { canServe, jobText, networkFleets, logisticsOn, colonistSurplus, colonistNeed, DANGER_RADIUS, crowdedNoEmigration, migrationTargets, autoImmigration } from '../engine/logistics';
import { MEGA, megaProgress, type MegaId } from '../engine/megaprojects';
import { missionDesigns, queueMission } from '../engine/missions';
import { canBuildShip } from '../engine/production';
import { fleetHasObsolete, refitTargets, pendingRefits, refitYard, refitUnitCost, refitBlocker } from '../engine/refit';
import { veteransOn, rankOf, RANKS, rankBonusText } from '../engine/veterans';
import { cataclysmTip } from './catamap';
import { REFOUND_FACTORIES, REFOUND_MINES } from '../engine/diaspora';
import { SectorBlock, OperationBlock } from './govui';

export function Inspector() {
  const s = useStore();
  const g = s.game, me = s.me;
  if (!g || !me) return null;
  const r = s.selected;
  let body: ComponentChildren;
  if (!r) body = <div class="insp-empty">Cliquez sur une planète ou une flotte de la carte.</div>;
  else if (r.kind === 'planet') body = g.planets[r.id].owner === me.id ? <OwnPlanet g={g} me={me} p={g.planets[r.id]} /> : <OtherPlanet g={g} me={me} p={g.planets[r.id]} />;
  else if (r.kind === 'fleet') {
    const f = g.fleets.find(x => x.id === r.id && x.owner === me.id);
    body = f ? <OwnFleet g={g} me={me} f={f} /> : <div class="insp-pad"><SummaryPane /></div>;
  } else body = <div class="insp-pad"><SummaryPane /></div>;
  return <aside class="insp">{body}</aside>;
}

function Head({ eyebrow, title, sub, nav, children }: { eyebrow: ComponentChildren; title: ComponentChildren; sub?: ComponentChildren; nav?: ComponentChildren; children?: ComponentChildren }) {
  return <header class="insp-head">
    <div class="eyebrow">{eyebrow}</div>
    <div class="insp-title"><h2>{title}</h2>{nav && <div class="insp-nav">{nav}</div>}</div>
    {sub && <div class="insp-sub">{sub}</div>}
    {children}
  </header>;
}

function Blk({ title, right, children, cls, tut }: { title?: ComponentChildren; right?: ComponentChildren; children: ComponentChildren; cls?: string; /** 0.3.8: what the tutorial points at */ tut?: string }) {
  return <section class={'blk ' + (cls ?? '')} data-tut={tut}>{(title || right) && <div class="blk-head"><h3>{title}</h3>{right}</div>}{children}</section>;
}

function cycle<T extends { id: number }>(list: T[], cur: number, dir: number): T | undefined {
  if (!list.length) return undefined;
  const i = list.findIndex(x => x.id === cur);
  return list[(i + dir + list.length) % list.length];
}

const MIN_LABELS = { ironium: 'Ironium', boranium: 'Boranium', germanium: 'Germanium' } as const;

function HabBlock({ me, hab, baseHab, pl }: { me: Player; hab: [number, number, number]; baseHab?: [number, number, number]; pl: Planet }) {
  const val = habitability(me.race, hab);
  const rem = terraformRemaining(me, { ...pl, hab, baseHab: baseHab ?? hab });
  const best = hab.map((v, i) => v + rem[i]) as [number, number, number];
  const bestVal = habitability(me.race, best);
  return <Blk tut="hab">
    <div class="habbig"><span>Habitabilité pour votre race</span><strong class={val > 0 ? 'good' : 'bad'}>{val} %</strong>{bestVal !== val && <em>{bestVal} % après terraformation</em>}</div>
    {[0, 1, 2].map(i => <HabBar label={HAB_NAMES[i]} value={hab[i]} base={baseHab?.[i]} best={best[i]} lo={me.race.habLow[i]} hi={me.race.habHigh[i]} immune={me.race.immune[i]} text={habString(i, hab[i])} color={['#3b6fe0', '#c23b3b', '#2fa35a'][i]} />)}
  </Blk>;
}

/** "Inside the Opale nebula: ..." for the selected object. */
function TerrainNote({ g, at }: { g: GameState; at: { x: number; y: number } }) {
  const ts = terrainAt(g, at);
  // 0.3.9: under an announced cataclysm
  const cata = g.cataclysms?.length ? cataclysmTip(g, at) : null;
  if (!ts.length && !cata) return null;
  return <>{ts.map(t => <div class={'ter-note ' + t.kind}><b>{terrainName(t)}</b> · {TERRAIN_INFO[t.kind].effect}</div>)}
    {cata && <div class="ter-note cata"><b>{cata[0]}</b> · {cata.slice(1).join(' ')}</div>}</>;
}

// ------------------------------------------------------------------ own planet

function OwnPlanet({ g, me, p }: { g: GameState; me: Player; p: Planet }) {
  const s = store;
  const spec = planetSpec(g, p, me);
  const rs = raceSpec(me.race);
  const mine = g.planets.filter(x => x.owner === me.id);
  const go = (dir: number) => { const x = cycle(mine, p.id, dir); if (x) { s.select({ kind: 'planet', id: x.id }); s.center(x.x, x.y); } };
  const orbit = g.fleets.filter(f => f.orbiting === p.id && f.owner === me.id);
  const sb = p.starbase ? g.designs.find(d => d.id === p.starbase!.designId) : undefined;
  const sbSpec = p.starbase ? specOf(g, p.starbase.designId) : null;
  return <div class="insp-body">
    <Head eyebrow={<>{seatLabel(g, me, p)} · n° {p.id}</>} title={p.name}
      sub={<>{me.name} · {p.x}, {p.y} · fondée en {p.colonizedYear ?? 2400}</>}
      nav={<><button class="icon" onClick={() => go(-1)} title="Planète précédente (p)">‹</button><button class="icon" onClick={() => go(1)} title="Planète suivante (n)">›</button><button class="icon" onClick={() => s.center(p.x, p.y)} title="Centrer (v)">◎</button></>} />
    <TerrainNote g={g} at={p} />
    <DiscoveryBlock g={g} me={me} p={p} />
    <ProdBlock g={g} me={me} p={p} />
    <SectorBlock g={g} me={me} p={p} />
    <EmpireBlock g={g} me={me} p={p} />
    <CultureBlock g={g} me={me} p={p} />
    {rs.canRemoteMineOwn && <MissionBlock g={g} me={me} p={p} known val={null} />}
    <HabBlock me={me} hab={p.hab} baseHab={p.baseHab} pl={p} />
    <Blk title="Minerais en réserve" tut="minerals">
      {(['ironium', 'boranium', 'germanium'] as const).map(m => <div class="minrow"><span><i class="mdot" style={{ background: MINERAL_COLORS[m] }} />{MIN_LABELS[m]}</span><b>{fmt(p.surface[m])} kt</b><small>+{fmt(spec.mining[m])}/an · conc. {p.conc[m]}</small></div>)}
    </Blk>
    <Blk cls="rows" tut="planet-rows">
      <Row k="Population" v={<>{fmtPop(p.pop)} hab. <span class={'small ' + (spec.growth < 0 ? 'red' : 'green')}>{fmtGrowth(spec.growth)}/an</span></>} />
      <Row k="Capacité" v={<>{fmtPop(spec.maxPop)} hab. <span class="muted small">({pct(spec.maxPop ? p.pop / spec.maxPop : 0)})</span></>} />
      {crowdedNoEmigration(g, me, p) && <div class="small yellow">La croissance ralentit nettement à ce niveau de peuplement. Une émigration automatique pourrait être utile.</div>}
      <Row k="Ressources / an" v={<><b>{fmt(spec.resourcesAvailable)}</b> R <span class="muted small">sur {fmt(spec.resources)}{spec.efficiency.total < 1 ? ` (${fmt(spec.resourcesBase)} à plein rendement)` : ''}</span></>} title="Ressources disponibles pour la production ; le reste va à la recherche" />
      {!rs.livesOnStarbases && <Row k="Mines / usines" v={<><span class={p.mines > spec.maxMines ? 'red' : ''}>{fmt(p.mines)}</span> / <span class={p.factories > spec.maxFactories ? 'red' : ''}>{fmt(p.factories)}</span> <span class="muted small">(max {fmt(spec.maxMines)} / {fmt(spec.maxFactories)})</span></>} title="Exploitables par la population actuelle entre parenthèses" />}
      {rs.canBuildDefenses && <Row k="Défenses" v={<>{fmt(p.defenses)} <span class="muted small">· couverture {pct(spec.defenseCoverage)}</span></>} />}
      <Row k="Détection flottes" v={spec.scanRange > 0 ? `${spec.scanRange} al` : 'aucune'} />
      <Row k="Analyse planétaire" v={spec.scanRangePen > 0 ? `${spec.scanRangePen} al` : 'en orbite seulement'} />
      <label class="chk"><input type="checkbox" checked={p.leftoverOnly} onChange={e => { s.checkpoint(); p.leftoverOnly = (e.target as HTMLInputElement).checked; s.bump(); }} /> Ne donner à la recherche que les ressources inutilisées</label>
    </Blk>
    <Blk title={`En orbite (${orbit.length})`}>
      {orbit.length === 0 ? <div class="muted small">Aucune flotte.</div> : <ul class="orbit">{orbit.map(f => { const sp = fleetSpec(g, f); return <li><button class="lnk" onClick={() => s.select({ kind: 'fleet', id: f.id })}>{f.name}</button><span class="muted small">{sp.ships} v.{sp.cargoCapacity ? ` · ${fmt(f.cargo.ironium + f.cargo.boranium + f.cargo.germanium + f.cargo.colonists)}/${fmt(sp.cargoCapacity)} kt` : ''}</span><button class="small" onClick={() => s.open('cargo', { fleetId: f.id, planetId: p.id })} title="Échanger cargaison et carburant avec la planète">Cargaison</button></li>; })}</ul>}
    </Blk>
    <Blk title="Station orbitale" tut="station">
      {!sb || !sbSpec ? <div class="muted small">Aucune station : impossible de construire des vaisseaux ici. <button class="lnk" onClick={() => s.open('production', { planetId: p.id })}>En construire une</button></div> : <>
        <button class="sb-line clickable" title="Voir le modèle : plan, armes, équipement" onClick={() => s.open('designView', { designId: sb.id, planetId: p.id })}><HullImg hull={sb.hull} color={me.color} w={52} /><div><b>{sb.name}</b>{sb.deleted && <i class="obs"> obsolète</i>}<div class="muted small">{tl(sb.hull)} · voir le modèle</div></div></button>
        <Row k="Blindage / boucliers" v={`${fmt(sbSpec.armor)} / ${fmt(sbSpec.shields)} dp`} />
        <Row k="Armement" v={sbSpec.weapons.length ? weaponSummary(sbSpec) : <span class="muted">aucune arme</span>} title="Armes de la station : nombre × arme, dégâts par tir, portée (en cases)" />
        {p.starbase!.damage > 0 && <Row k="Dégâts" v={<span class="red">{fmt(p.starbase!.damage)} dp</span>} />}
        <Row k="Chantier" v={sbSpec.dock === -1 ? 'illimité' : sbSpec.dock > 0 ? `${sbSpec.dock} kt` : 'aucun'} />
        {sbSpec.gate && <Row k="Portail" v={`${sbSpec.gate.safeMass >= 1e9 ? '∞' : sbSpec.gate.safeMass} kt · ${sbSpec.gate.safeRange >= 1e9 ? '∞' : sbSpec.gate.safeRange} al`} />}
        {sbSpec.driver && <>
          <Row k="Catapulte" v={`Warp ${sbSpec.driver.safeSpeed}${sbSpec.driver.safeSpeed > sbSpec.driver.speed ? ` (${sbSpec.driver.safeSpeed - sbSpec.driver.speed + 1} × Warp ${sbSpec.driver.speed})` : ''}`} />
          <Row k="Cible des paquets" v={<>{p.packetTarget !== undefined ? g.planets[p.packetTarget].name : 'aucune'} <button class="lnk" onClick={() => { (window as any).__setPacketDest = true; s.notify('Ctrl+clic sur la planète cible des paquets'); }}>définir</button></>} />
          <Row k="Vitesse des paquets" v={<Num value={p.packetWarp} min={5} max={16} onChange={v => { s.checkpoint(); p.packetWarp = v; s.bump(); }} width={60} />} />
        </>}
      </>}
      <Row k="Route des vaisseaux neufs" v={<>{p.route !== undefined ? <b>{g.planets[p.route].name}</b> : 'aucune'} {p.route !== undefined ? <button class="lnk" onClick={() => { s.checkpoint(); p.route = undefined; s.bump(); }}>retirer</button> : <span class="muted small">(Ctrl+clic sur la carte)</span>}</>} />
    </Blk>
  </div>;
}

/** "16 × Laser (10 dp, portée 1) · 8 × Torpille Alpha (5 dp, portée 4)" */
function weaponSummary(spec: DesignSpec): string {
  const m = new Map<string, { qty: number; power: number; range: number }>();
  for (const w of spec.weapons) { const x = m.get(w.part); if (x) x.qty += w.qty; else m.set(w.part, { qty: w.qty, power: w.power, range: w.range }); }
  return [...m.entries()].map(([n, x]) => `${x.qty} × ${tl(n)} (${fmt(x.power)} dp, portée ${x.range})`).join(' · ');
}

function yearsLabel(n: number) { return n <= 1 ? 'cette année' : `${n} ans`; }

function missionTag(g: GameState, m: NonNullable<import('../engine/types').QueueItem['mission']>): string {
  const n = g.planets[m.planetId]?.name ?? '?';
  switch (m.kind) {
    case 'colonize': return `colonise ${n}`;
    case 'mine': return `fore ${n}`;
    case 'haul': return `navette ${n}`;
    case 'logistics': return 'réseau logistique';
    default: return `explore ${n}`;
  }
}

/** Refitting ships of this fleet to another design of the same hull, at a shipyard. */
function RefitBlock({ g, me, f }: { g: GameState; me: Player; f: Fleet }) {
  const s = useStore();
  const rows = f.tokens.map(t => ({ t, from: g.designs.find(d => d.id === t.designId)!, targets: refitTargets(g, me, t.designId) })).filter(r => r.from && r.targets.length);
  const pending = pendingRefits(g, f);
  const [pick, setPick] = useState<Record<number, number>>({});
  const [qty, setQty] = useState<Record<number, number>>({});
  if (!rows.length && !pending.length) return null;
  const yard = refitYard(g, f);
  const obsolete = rows.some(r => r.from.deleted);
  if (!yard.planet && !obsolete && !pending.length) return null;
  return <Blk title="Modernisation">
    {pending.map(p => <div class="hint net-job">En chantier à <button class="lnk" onClick={() => s.open('production', { planetId: p.planet.id })}>{p.planet.name}</button> : {p.qty} × {g.designs.find(d => d.id === p.from)?.name} → {g.designs.find(d => d.id === p.to)?.name}. La flotte doit rester en orbite.</div>)}
    {!yard.planet ? <div class="hint">{obsolete ? 'Des vaisseaux de modèles retirés peuvent être modernisés vers un modèle de même coque : ' : 'Modernisation possible : '}{yard.why}.</div>
      : rows.map(r => {
        const toId = pick[r.t.designId] ?? r.targets[r.targets.length - 1].id;
        const n = Math.max(1, Math.min(r.t.qty, qty[r.t.designId] ?? r.t.qty));
        const unit = refitUnitCost(g, me, r.t.designId, toId);
        const total = { ironium: unit.ironium * n, boranium: unit.boranium * n, germanium: unit.germanium * n, resources: unit.resources * n };
        const why = refitBlocker(g, f, r.t.designId, toId);
        return <div class="refit-row">
          <div class="refit-line"><b>{r.from.name}</b>{r.from.deleted && <i class="obs"> obsolète</i>} <span class="muted">→</span>
            <select value={toId} onChange={e => setPick({ ...pick, [r.t.designId]: +(e.target as HTMLSelectElement).value })}>{r.targets.map(d => <option value={d.id}>{d.name}</option>)}</select>
          </div>
          <div class="refit-line"><Num value={n} min={1} max={r.t.qty} width={56} onChange={v => setQty({ ...qty, [r.t.designId]: v })} /><span class="small muted">sur {r.t.qty} · </span><Cost c={total} /></div>
          {why ? <div class="hint red">{why}</div> : <button class="small primary" onClick={() => A.refit(f, r.t.designId, toId, n)}>Moderniser à {yard.planet!.name}</button>}
        </div>;
      })}
  </Blk>;
}

function seatLabel(g: GameState, me: Player, p: Planet): string {
  if (g.settings.distanceCost) {
    if (capitalOf(g, me) === p) return 'Capitale';
    if (p.regionalCapital) return 'Capitale régionale';
  }
  if (p.conqueredYear !== undefined) return 'Monde conquis';
  return p.homeworld ? 'Monde natal' : 'Colonie';
}

/** Constellations 3: administrative output, migration and mineral policies, megaprojects. */
function EmpireBlock({ g, me, p }: { g: GameState; me: Player; p: Planet }) {
  const s = useStore();
  const dc = !!g.settings.distanceCost, lg = logisticsOn(g);
  const mega = (p.megaprojects ?? []) as MegaId[];
  if (!dc && !lg && !mega.length && !p.agency) return null;
  const spec = planetSpec(g, p, me);
  const e = spec.efficiency;
  const cap = capitalOf(g, me);
  const why: string[] = [];
  if (dc) {
    if (p === cap) why.push('siège du gouvernement');
    else if (p.regionalCapital) why.push(`capitale régionale : plein rendement à ${ADMIN_RADIUS} al autour`);
    else if (e.nearest) why.push(`à ${fmt(e.distance)} al de ${e.nearest.name}${e.admin < 1 ? ` (−${pct(1 - e.admin)})` : ''}`);
    if (e.conquest < 1) why.push(`monde conquis : ${pct(e.conquest)}, plein rendement en ${(p.conqueredYear ?? g.year) + CONQUEST_YEARS}`);
    if (e.disorg < 1) why.push(`empire désorganisé jusqu'en ${me.disorgUntil} (×${e.disorg})`);
  }
  const net = lg ? networkFleets(g, me) : [];
  const mig = p.migration?.mode ?? 'none', min = p.mineralPolicy?.mode ?? 'none';
  const needsFreighter = lg && !net.length && (mig !== 'none' || min !== 'none');
  const fd = needsFreighter ? missionDesigns(g, me, 'haul')[0] : undefined;
  const yard = fd ? [...g.planets.filter(x => x.owner === me.id)].sort((a, b) => b.pop - a.pop).find(x => !canBuildShip(g, x, fd)) : undefined;
  return <Blk title="Empire" cls="rows empire-blk" tut="empire-blk">
    {dc && <Row k="Rendement" v={<><b class={e.total < 0.65 ? 'red' : e.total < 0.9 ? 'yellow' : 'green'}>{pct(e.total)}</b> <span class="muted small">{why.join(' · ')}</span></>} title={`Production et recherche de cette planète. Pleine efficacité à ${ADMIN_RADIUS} al de la capitale ou d'une capitale régionale, puis −${Math.round(ADMIN_LOSS * 100)} % tous les ${ADMIN_STEP} al (minimum ${Math.round(ADMIN_FLOOR * 100)} %).`} />}
    {lg && <>
      <div class="pol-row">
        <span class="k" title="Le réseau logistique déplace les colons entre vos planètes selon ces politiques, avec les cargos qui lui sont affectés.">Population</span>
        <select value={mig} onChange={e => A.setMigration(p, (e.target as HTMLSelectElement).value as 'none' | 'out' | 'in')}>
          <option value="none">Neutre</option><option value="out">Émigration</option><option value="in">Immigration</option>
        </select>
      </div>
      {mig !== 'none' && <div class="pol-sub" title="Pourcentage de la capacité de la planète">
        <span>{mig === 'out' ? 'au-delà de' : 'jusqu\'à'}</span><Num value={p.migration!.target} min={5} max={100} width={56} onChange={v => A.setMigration(p, mig, v)} /><span>%</span>
        <span class="muted">· {mig === 'out' ? `${fmtPop(colonistSurplus(g, p) * 100)} à envoyer` : `${fmtPop(colonistNeed(g, p) * 100)} attendus`}</span>
      </div>}
      {lg && <MigrationNote g={g} me={me} p={p} />}
      <div class="pol-row">
        <span class="k" title="Exporter : le réseau emporte les minerais au-delà de la réserve vers les planètes importatrices (ou la capitale s'il n'y en a pas).">Minerais</span>
        <select value={min} onChange={e => A.setMineralPolicy(p, (e.target as HTMLSelectElement).value as 'none' | 'export' | 'import')}>
          <option value="none">Neutre</option><option value="export">Exporter</option><option value="import">Importer</option>
        </select>
      </div>
      {min === 'export' && <div class="pol-sub"><span>garder</span><Num value={p.mineralPolicy!.reserve} min={0} max={100000} step={50} width={72} onChange={v => A.setMineralPolicy(p, 'export', v)} /><span>kt de chacun</span></div>}
      {min === 'import' && <div class="pol-sub muted">reçoit les minerais exportés par vos autres planètes</div>}
      {needsFreighter && <div class="alert small">Aucun cargo dans le réseau logistique : ces politiques restent lettre morte.
        {fd && yard ? <div class="btns"><button class="small primary" onClick={() => { s.checkpoint(); queueMission(g, yard, fd, { kind: 'logistics', planetId: yard.id }); s.notify(`${fd.name} ajouté à la file de ${yard.name} pour le réseau.`); s.bump(); }}>Construire un {fd.name} à {yard.name}</button></div> : <div class="small">Cochez « Réseau logistique » sur une flotte de cargos.</div>}
      </div>}
    </>}
    {mega.map(id => <Row k={MEGA[id]?.name ?? id} v={<span class="small">{MEGA[id]?.effect}</span>} />)}
    {p.agency && <Row k="Agence de renseignement" v={<span class="small">vos réseaux d'espions moitié plus forts, ceux des autres démasqués deux fois plus souvent</span>} />}
  </Blk>;
}

/** Production queue: folded by default, at the top of the planet panel. */
function ProdBlock({ g, me, p }: { g: GameState; me: Player; p: Planet }) {
  const s = useStore();
  const open = !(s.collapsed['insp-prod'] ?? true);
  const est = p.queue.length ? estimateQueue(g, p, 50) : [];
  const firstManual = p.queue.findIndex(q => !isAuto(q.kind));
  const summary = p.queue.length === 0 ? <span class="warn">vide</span>
    : firstManual >= 0 ? <>{itemLabel(g, p.queue[firstManual])}{p.queue[firstManual].qty > 1 ? ` ×${p.queue[firstManual].qty}` : ''} · {est[firstManual]?.blocked ? 'bloqué' : est[firstManual]?.lastYear ? yearsLabel(est[firstManual].lastYear!) : '…'}</> : 'automatique';
  const eta = (i: number) => {
    const it = p.queue[i], e = est[i];
    if (isAuto(it.kind)) return maxBuildable(g, p, it.kind) === 0 ? 'terminé' : 'chaque année';
    if (e?.blocked) return <span class="red slow-why" title={`Bloqué : ${queueBottleneck(g, p, i, est).text}`}>bloqué</span>;
    if (e?.lastYear && e.lastYear >= 5) return <span class="yellow slow-why" title={`Ce qui le retarde : ${queueBottleneck(g, p, i, est).text}`}>{yearsLabel(e.lastYear)}</span>;
    return e?.lastYear ? yearsLabel(e.lastYear) : '…';
  };
  return <section class={'blk prodblk' + (open ? ' open' : '')} data-tut="prod">
    <button class="prod-toggle" onClick={() => { s.collapsed['insp-prod'] = open; s.savePrefs(); s.bump(); }} aria-expanded={open}>
      <span class="tw">{open ? '▾' : '▸'}</span><b>File de production</b><span class="prod-sum">{summary}</span><span class="cnt">{p.queue.length}</span>
    </button>
    {open && <div class="prod-body">
      {p.queue.length === 0 ? <div class="alert small">La file est vide : cette planète ne produit rien cette année.</div> :
        <ul class="pq">{p.queue.map((it, i) => <li class={isAuto(it.kind) ? 'auto' : est[i]?.doneThisYear ? 'done' : ''}>
          <span class="pq-name" title={itemTip(g, me, it)}>{itemLabel(g, it)}{it.mission && <span class="tag" title="Partira seul en mission une fois construit">{missionTag(g, it.mission)}</span>}{it.kind === 'mega' && <span class="tag mega" title="Avancement du mégaprojet">{pct(megaProgress(it))}</span>}</span>
          <span class="pq-qty">{isAuto(it.kind) ? `≤ ${fmt(it.qty)}` : `×${fmt(it.qty)}`}</span>
          <span class="pq-eta">{eta(i)}</span>
          <span class="pq-arrows">
            <button class="ar" title="Tout en haut" disabled={i === 0} onClick={() => A.queueMove(p.id, i, 0)}>⤒</button>
            <button class="ar" title="Monter" disabled={i === 0} onClick={() => A.queueMove(p.id, i, i - 1)}>↑</button>
            <button class="ar" title="Descendre" disabled={i === p.queue.length - 1} onClick={() => A.queueMove(p.id, i, i + 1)}>↓</button>
            <button class="ar" title="Tout en bas" disabled={i === p.queue.length - 1} onClick={() => A.queueMove(p.id, i, p.queue.length - 1)}>⤓</button>
            <button class="ar del" title="Retirer" onClick={() => A.queueRemove(p.id, i)}>✕</button>
          </span>
        </li>)}</ul>}
      <div class="btns"><button class="primary small" data-tut="prod-edit" onClick={() => s.open('production', { planetId: p.id })}>Ajouter / modifier…</button><button class="small" disabled={!p.queue.length} onClick={() => A.queueClear(p.id)}>Vider</button></div>
    </div>}
  </section>;
}

// ------------------------------------------------------------------ other planets

function OtherPlanet({ g, me, p }: { g: GameState; me: Player; p: Planet }) {
  const intel = me.intel.planets[p.id];
  const known = intel.year !== undefined;
  const owner = intel.owner;
  const owned = owner !== undefined && owner >= 0;
  const age = known ? g.year - intel.year! : 0;
  const val = intel.hab ? habitability(me.race, intel.hab) : null;
  return <div class="insp-body">
    <Head eyebrow={<>Système n° {p.id}</>} title={p.name}
      sub={<>{owned ? <span style={{ color: g.players[owner].color }}>{RACE_ICONS[g.players[owner].race.icon % RACE_ICONS.length]} {g.players[owner].name}{intel.homeworld ? ' · monde natal' : ''}</span> : known ? 'Monde libre' : 'Données inconnues'} · {p.x}, {p.y}</>}>
      {known && <div class={'report-age' + (age > 0 ? ' old' : '')}>{age === 0 ? `Relevé de cette année (${intel.year})` : `Relevé de ${intel.year}, il y a ${age} an${age > 1 ? 's' : ''}`}</div>}
    </Head>
    <TerrainNote g={g} at={p} />
    <TerritoryNote g={g} me={me} p={p} />
    <DiscoveryBlock g={g} me={me} p={p} />
    {!owned && <MissionBlock g={g} me={me} p={p} known={known} val={val} />}
    {!owned && known && <ClaimBlock g={g} me={me} p={p} />}
    {!known ? <Blk><p class="muted small">Au début de la partie, il faut envoyer un vaisseau dans ce système pour mesurer son environnement et ses minerais. Un scanner pénétrant permettra plus tard de l'analyser à distance.</p></Blk> : <>
      {intel.hab && <HabBlock me={me} hab={intel.hab} baseHab={intel.baseHab} pl={p} />}
      {intel.conc && <Blk title={owned ? 'Minerais' : 'Minerais en sous-sol'}>
        {(['ironium', 'boranium', 'germanium'] as const).map(m => <div class="minrow"><span><i class="mdot" style={{ background: MINERAL_COLORS[m] }} />{MIN_LABELS[m]}</span><b>conc. {intel.conc![m]}</b><small>{intel.surface ? `${fmt(intel.surface[m])} kt en surface` : ''}</small></div>)}
      </Blk>}
      <Blk cls="rows">
        {owned && <Row k="Population" v={`≈ ${fmtPop(intel.pop ?? 0)} hab.`} />}
        {!owned && val !== null && val > 0 && intel.hab && <Row k="Population maximale" v={`${fmtPop(maxPopulation(g, me, { ...p, hab: intel.hab }, val))} hab.`} />}
        {owned && intel.defenses !== undefined && <Row k="Défenses" v={fmt(intel.defenses)} />}
        {intel.starbaseName && <Row k="Station" v={intel.starbaseDesign !== undefined ? <button class="lnk" title="Voir ce qu'on sait de ce modèle" onClick={() => store.open('designView', { designId: intel.starbaseDesign, planetId: p.id })}>{intel.starbaseName}</button> : intel.starbaseName} />}
      </Blk>
    </>}
  </div>;
}

// ------------------------------------------------------------------ own fleet

function EmptyArkAlert({ g, me, f }: { g: GameState; me: Player; f: Fleet }) {
  const here = f.orbiting >= 0 ? g.planets[f.orbiting] : undefined;
  const canHere = !!here && here.owner === me.id && here.pop > 1000;
  const src = canHere ? undefined : A.nearestColonySource(f);
  return <section class="blk"><div class="alert strong">⚠ Cette arche n'a aucun colon à bord : elle ne pourra pas fonder de colonie.
    <div class="btns">{canHere ? <button class="small primary" onClick={() => A.loadColonistsHere(f)}>Embarquer les colons à {here!.name}</button> : src ? <button class="small primary" onClick={() => A.addColonistStop(f, src.id)}>Escale à {src.name} pour les embarquer</button> : <span class="small">Aucune de vos planètes ne peut fournir de colons.</span>}</div>
  </div></section>;
}

/** A fleet short of fuel: another of your fleets can bring some (Constellations 3.2). */
function RefuelBlock({ g, f }: { g: GameState; f: Fleet }) {
  const s = useStore();
  const [more, setMore] = useState(false);
  const coming = g.fleets.filter(t => t.refuelFor === f.id);
  if (coming.length) return <div class="refuel small">{coming.map(t => <div>⛽ <button class="lnk" onClick={() => s.select({ kind: 'fleet', id: t.id })}>{t.name}</button> vient la ravitailler{t.refuelYear !== undefined ? `, rencontre prévue en ${Math.max(g.year + 1, t.refuelYear)}` : ''}. <button class="lnk" onClick={() => A.stopPursuit(t)}>Annuler</button></div>)}</div>;
  if (f.refuelFor !== undefined) { const d = g.fleets.find(x => x.id === f.refuelFor); const post = f.tankerPost; return <div class="refuel small">⛽ En route pour ravitailler {d ? <button class="lnk" onClick={() => s.select({ kind: 'fleet', id: d.id })}>{d.name}</button> : 'une flotte'}{post ? `, puis retour à son poste (${wpName(g, f.owner, post)})` : ''}. <button class="lnk" onClick={() => A.stopPursuit(f)}>Annuler</button></div>; }
  if (!needsFuel(g, f)) return null;
  const opts = refuelOptions(g, f);
  if (!opts.length) return <div class="refuel small muted">Aucune de vos flottes sans ordre n'a assez de carburant à céder pour la rejoindre.</div>;
  const o = opts[0];
  const when = (x: typeof o) => x.plan.ourYears === 0 && x.tanker.x === f.x && x.tanker.y === f.y ? 'sur place' : `rencontre en ${x.meetYear}`;
  return <div class="refuel">
    <button class="primary mbtn" onClick={() => A.refuel(o.tanker, f)} title="La flotte ravitailleuse la rejoint, lui cède ce qu'elle peut (en gardant de quoi rentrer) puis retourne au chantier le plus proche">Ravitailler la flotte<small>{o.tanker.name} · +{o.give} mg · {when(o)}</small></button>
    {opts.length > 1 && <button class="lnk small" onClick={() => setMore(!more)} aria-expanded={more}>{more ? 'Masquer' : `${opts.length - 1} autre${opts.length > 2 ? 's' : ''} ravitailleur${opts.length > 2 ? 's' : ''}`}</button>}
    {more && <ul class="refuel-list">{opts.slice(1, 6).map(x => <li><span>{x.tanker.name}</span><span class="muted small">+{x.give} mg · {when(x)}</span><button class="small" onClick={() => A.refuel(x.tanker, f)}>Choisir</button></li>)}</ul>}
  </div>;
}

function OwnFleet({ g, me, f }: { g: GameState; me: Player; f: Fleet }) {
  if (f.beaconOf !== undefined) return <BeaconPanel g={g} me={me} f={f} />;
  return <OwnShips g={g} me={me} f={f} />;
}

function OwnShips({ g, me, f }: { g: GameState; me: Player; f: Fleet }) {
  const s = useStore();
  const spec = fleetSpec(g, f);
  const mineF = g.fleets.filter(x => x.owner === me.id);
  const go = (dir: number) => { const x = cycle(mineF, f.id, dir); if (x) { s.select({ kind: 'fleet', id: x.id }); s.center(x.x, x.y); } };
  const planet = f.orbiting >= 0 ? g.planets[f.orbiting] : undefined;
  const others = g.fleets.filter(x => x !== f && x.x === f.x && x.y === f.y && x.owner === me.id);
  const wi = Math.min(Math.max(0, s.waypointIndex), f.waypoints.length - 1);
  const wp = f.waypoints[wi];
  const est = estimateRoute(g, f);
  const leg = wi > 0 ? est[wi - 1] : undefined;
  const gc = wi > 0 ? gateCheck(g, f, wi) : undefined;
  const mainDesign = g.designs.find(d => d.id === f.tokens[0]?.designId);
  const [renaming, setRenaming] = useState(false);
  const totalYears = est.length ? est[est.length - 1].arrival : 0;
  const routeOk = est.every(l => l.ok);
  return <div class="insp-body">
    <Head eyebrow={<>Flotte{mainDesign ? ` · ${tl(mainDesign.hull)}` : ''}</>}
      title={renaming ? <input autofocus class="rename" value={f.name} onKeyDown={e => { if (e.key === 'Enter') { A.renameFleet(f, (e.target as HTMLInputElement).value); setRenaming(false); } if (e.key === 'Escape') setRenaming(false); }} onBlur={e => { A.renameFleet(f, (e.target as HTMLInputElement).value); setRenaming(false); }} /> : <span onDblClick={() => setRenaming(true)} title="Double-clic pour renommer">{f.name}{fleetHasObsolete(g, f) && <i class="obs" title="Un modèle de cette flotte a été retiré : il ne se construit plus, mais ses vaisseaux restent en service."> obsolète</i>}</span>}
      sub={<>{planet ? <>En orbite de <button class="lnk" onClick={() => s.select({ kind: 'planet', id: planet.id })}>{planet.name}</button></> : `Espace profond (${Math.round(f.x)}, ${Math.round(f.y)})`}{f.outOfFuel ? <span class="red"> · à sec</span> : ''}</>}
      nav={<><button class="icon" onClick={() => go(-1)} title="Flotte précédente">‹</button><button class="icon" onClick={() => go(1)} title="Flotte suivante">›</button><button class="icon" onClick={() => s.center(f.x, f.y)} title="Centrer (v)">◎</button><button class="icon" onClick={() => setRenaming(true)} title="Renommer">✎</button></>}>
    </Head>
    <TerrainNote g={g} at={f} />
    <Blk title="Carburant et soute" tut="cargo" right={<button class="small" onClick={() => s.open('cargo', { fleetId: f.id, planetId: planet?.id, otherId: !planet ? others[0]?.id : undefined })}>{planet ? 'Échanger' : 'Transférer'}</button>}>
      <FuelCargo g={g} f={f} onCargo={planet || others.length ? () => s.open('cargo', { fleetId: f.id, planetId: planet?.id, otherId: !planet ? others[0]?.id : undefined }) : undefined} />
      <RefuelBlock g={g} f={f} />
    </Blk>
    <Blk tut="route" title={<>Itinéraire{f.waypoints.length > 1 ? <span class="muted"> · {totalYears} an{totalYears > 1 ? 's' : ''}</span> : ''}</>} right={f.waypoints.length > 1 ? <button class="small" onClick={A.clearRoute} title="Supprimer toutes les étapes">Effacer</button> : undefined}>
      <ol class="waypoints">
        {f.waypoints.map((w, i) => (
          <li class={(i === wi ? 'sel ' : '') + (i > 0 && est[i - 1] && !est[i - 1].ok ? 'bad' : '')} onClick={() => { s.waypointIndex = i; s.bump(); }}>
            <span class="wn">{i === 0 ? '●' : i}</span>
            <span class="wname">{wpName(g, me.id, w)}</span>
            {i > 0 && <span class="wmeta" title={est[i - 1]?.pass ? 'Franchie sans s\'arrêter : la flotte garde sa vitesse' : undefined}>W{w.warp >= 11 ? 'portail' : w.warp} · {est[i - 1]?.pass ? '↷ ' : ''}{est[i - 1]?.arrival ?? '?'} a{w.task !== 'none' ? ` · ${TASK_LABELS[w.task]}` : ''}</span>}
            {i > 0 && <button class="lnk del" title="Supprimer l'étape (Suppr)" onClick={e => { e.stopPropagation(); A.deleteWaypoint(i); }}>✕</button>}
          </li>
        ))}
      </ol>
      <div class="hint hide-touch">{f.waypoints.length === 1 ? 'Maj+clic sur la carte : destination (planète, flotte à intercepter ou point de l\'espace). Gardez Maj enfoncée pour ajouter des étapes.' : 'Maj+clic : nouvel itinéraire · Ctrl+Maj+clic : ajouter une étape à la fin.'}</div>
      <div class="hint touch-only">Bouton « ✚ Étapes » au-dessus de la carte, puis touchez la destination ; appui long sur la carte : « Aller ici ».</div>
      {(() => {
        const slow = est.findIndex((l, k) => f.waypoints[k + 1].warp < 11 && (!l.ok || (f.waypoints[k + 1].warp <= 1 && spec.idealSpeed > 1 && spec.freeSpeed < 2)));
        if (slow < 0) return null;
        const l = est[slow];
        return <div class="alert strong">⚠ {l.ok ? `Étape ${slow + 1} à Warp 1 : ${l.years} ans pour ${fmt(l.dist, 0)} al, faute de carburant.` : `Carburant insuffisant pour l'étape ${slow + 1} : la flotte tombera en panne sèche et finira le trajet à Warp 1.`} Faites escale à un chantier ami ou raccourcissez le trajet.</div>;
      })()}
      {wi > 0 && leg && <div class="leg">
        <div class="warp-row">
          <span class="k">Vitesse</span>
          <WarpBar value={Math.min(wp.warp, gc!.srcGate ? 11 : 10)} max={gc!.srcGate ? 11 : 10} ideal={spec.idealSpeed || undefined} maxSafe={spec.maxSafeSpeed || undefined} onChange={v => A.setWarp(wi, v)} />
        </div>
        <GateNote gc={gc!} warp={wp.warp} leg={leg} />
        {wp.warp < 11 && wp.warp > spec.maxSafeSpeed && spec.maxSafeSpeed > 0 ? <div class="hint red">Au-delà de Warp {spec.maxSafeSpeed} : chaque année, un vaisseau sur dix risque d'exploser.</div>
          : wp.warp < 11 && spec.idealSpeed > 0 && wp.warp > spec.idealSpeed ? <div class="hint yellow">Plus vite que la vitesse idéale (Warp {spec.idealSpeed}) : la consommation grimpe.</div> : null}
        <div class="legstats">
          <div><small>Distance</small><b>{fmt(leg.dist, 1)} al</b></div>
          <div><small>Durée</small><b>{leg.years === 0 ? 'même année' : `${leg.years} an${leg.years > 1 ? 's' : ''}`}</b></div>
          <div><small>Consommation</small><b class={leg.ok ? '' : 'red'}>{fmt(leg.fuel)} mg</b></div>
          <div><small>Réserve à l'arrivée</small><b class={leg.fuelAfter < spec.fuelCapacity * 0.15 ? 'yellow' : ''}>{fmt(leg.fuelAfter)} mg</b></div>
        </div>
        {leg.refuelled && <div class="hint">Plein automatique au chantier ami à l'arrivée.</div>}
        {canPassThrough(f.waypoints, wi) && <label class="chk" title="Sans arrêt, la flotte franchit ce point de l'espace en gardant le reste de son année de voyage : un virage ne coûte aucun temps. Avec un arrêt, elle s'immobilise ici jusqu'à la fin de l'année. Une planète est toujours un arrêt (mise en orbite)."><input type="checkbox" checked={!leg.pass} onChange={e => A.setStop(wi, (e.target as HTMLInputElement).checked)} /> S'arrêter à cette étape</label>}
        {canPassThrough(f.waypoints, wi) && leg.pass && <div class="hint">Étape franchie sans ralentir : le virage ne coûte aucun temps.</div>}
        {wp.warp < 11 && terrainOnLeg(g, f.waypoints[wi - 1], wp).filter(t => (TERRAIN_INFO[t.kind].warpCap ?? 99) < wp.warp).map(t => <div class="hint yellow">Traverse {terrainName(t)} : Warp limité à {TERRAIN_INFO[t.kind].warpCap} sur ce passage.</div>)}
        {wp.target === 'wormhole' && !canUseWormholes(me) && <div class="alert">Traverser un trou de ver demande la technologie « {WORMHOLE_NAV.name} » ({specialReqText(WORMHOLE_NAV)}). La flotte s'arrêtera devant.</div>}
        <div class="btns">
          <button class="small" onClick={A.autoWarps} title="Vitesse la plus rapide qui conserve du carburant, pour chaque étape ; le portail quand il est plus rapide et sans risque">Vitesse auto</button>
          <button class="small" onClick={() => A.applyWarpToAll(wp.warp)}>Cette vitesse partout</button>
        </div>
        {!routeOk && <div class="alert">Le carburant ne suffit pas pour tout l'itinéraire : la flotte finira à Warp 1 et risque de dériver. Réduisez la vitesse ou faites escale à un chantier ami.</div>}
        {(() => {
          const mf = minefieldsOnLeg(g, me, f.waypoints[wi - 1], wp);
          if (!mf.length || wp.warp >= 11) return null;
          const safe = Math.min(...mf.map(m => m.safeWarp));
          const risky = wp.warp > safe;
          return <div class={risky ? 'alert' : 'hint'}>Le trajet traverse {mf.length > 1 ? `${mf.length} champs de mines connus` : 'un champ de mines connu'}. {risky ? `Au-delà de Warp ${safe}, chaque année-lumière parcourue dans le champ risque une explosion.` : `Warp ${wp.warp} reste sous la vitesse sûre (${safe}).`}{risky && <button class="small" style={{ marginLeft: '6px' }} title="Deux étapes sont ajoutées à l'entrée et à la sortie du champ, franchies sans s'arrêter : la flotte ne ralentit que dans le champ" onClick={() => A.slowInMinefields(wi)}>{mf.length > 1 ? `Passer en Warp ${safe} dans les champs de mines` : `Passer en Warp ${safe} dans le champ de mines`}</button>}</div>;
        })()}
        <WarpTable g={g} f={f} i={wi} />
      </div>}
      {f.waypoints.length > 1 && <label class="chk"><input type="checkbox" checked={f.repeat} onChange={e => A.setRepeat((e.target as HTMLInputElement).checked)} /> Répéter l'itinéraire</label>}
      {spec.hasEngines && (canAutoExplore(me)
        ? <label class="chk" title="À chaque tour, la flotte part d'elle-même vers la planète inexplorée la plus proche qu'elle peut atteindre sans tomber en panne, et rentre faire le plein quand il le faut."><input type="checkbox" checked={f.auto === 'explore'} onChange={e => A.setAutoExplore(f, (e.target as HTMLInputElement).checked)} /> Exploration automatique</label>
        : <label class="chk locked" title={`Technologie « ${AUTO_EXPLORE.name} » : ${specialLevelText(g, AUTO_EXPLORE)} (vous êtes au niveau ${me.tech.electronics} en Électronique).`}><input type="checkbox" disabled /> Exploration automatique <span class="muted small">· Électronique {g.settings.fuzzyTechTree ? `≈ ${AUTO_EXPLORE.level}` : AUTO_EXPLORE.level}</span></label>)}
      {logisticsOn(g) && canServe(g, f) && <label class="chk" title={`Le réseau donne lui-même ses ordres à la flotte : il emporte colons et minerais selon les politiques de vos planètes, et évite les routes où des navires ennemis ont été vus à moins de ${DANGER_RADIUS} al.`}><input type="checkbox" checked={f.auto === 'logistics'} onChange={e => A.setNetwork(f, (e.target as HTMLInputElement).checked)} /> Réseau logistique</label>}
      {f.auto === 'logistics' && <div class="hint net-job">{jobText(g, f)}</div>}
    </Blk>
    {spec.colonizer && f.cargo.colonists === 0 && f.waypoints.length > 1 && !A.arkLoadPlanned(f) && A.arkHeadsToColonize(f) && <EmptyArkAlert g={g} me={me} f={f} />}
    <Blk tut="task" title={`Tâche ${wi === 0 ? 'sur place' : `à l'étape ${wi}`}`}>
      <select value={wp.task} onChange={e => A.setTask(wi, (e.target as HTMLSelectElement).value as WaypointTask)}>
        {(Object.keys(TASK_LABELS) as WaypointTask[]).map(t => <option value={t} disabled={!taskPossible(g, f, t)}>{TASK_LABELS[t]}</option>)}
      </select>
      <TaskDetails g={g} f={f} i={wi} />
    </Blk>
    <Blk tut="ships" title={`Composition · ${spec.ships} vaisseau${spec.ships > 1 ? 'x' : ''}`}>
      <ul class="comp">
        {f.tokens.map(t => {
          const d = g.designs.find(x => x.id === t.designId)!;
          const ds = specOf(g, t.designId);
          return <li onClick={() => { if (!d.deleted) s.goTab('design', { designId: d.id }); }} title={d.deleted ? 'Modèle retiré : il ne se construit plus' : 'Voir le modèle'}>
            <HullImg hull={d.hull} color={me.color} w={40} />
            <span class="cn">{d.name}{d.deleted && <i class="obs"> obsolète</i>}</span><span class="cq">× {t.qty}</span>
            {t.qtyDamaged > 0 && <span class="dmg" title={`${t.qtyDamaged} endommagé(s), ${fmt(t.damage)} dp de dégâts chacun`}><Bar value={ds.armor - t.damage} max={ds.armor} color="#ff5d5d" height={5} /></span>}
          </li>;
        })}
      </ul>
      {f.meetTrader !== undefined && <Row k="Rendez-vous" v={<span class="pursuit">Marchand nomade <button class="small ghost" onClick={() => A.stopTraderMeet(f)}>Annuler</button></span>} />}
      {f.pursue !== undefined && f.refuelFor === undefined && <Row k="Poursuite" v={<span class="pursuit">{me.intel.fleets.find(x => x.id === f.pursue)?.name ?? 'contact perdu de vue'} <button class="small ghost" onClick={() => A.stopPursuit(f)}>Arrêter</button></span>} />}
      <Row k="Plan de bataille" v={<select value={f.battlePlan} onChange={e => { const v = +(e.target as HTMLSelectElement).value; if (v === -1) s.open('battlePlans'); else A.setBattlePlan(f, v); }}>{me.battlePlans.map(b => <option value={b.id}>{b.name}</option>)}<option value={-1}>Modifier les plans…</option></select>} />
      <Row k="Autonomie" v={Number.isFinite(spec.estimatedRange) ? `${fmt(spec.estimatedRange)} al à Warp ${spec.idealSpeed}` : 'illimitée'} />
      <Row k="Masse" v={`${fmt(spec.mass)} kt`} />
      {spec.cloakPercent > 0 && <Row k="Camouflage" v={`${spec.cloakPercent} %`} />}
      <Row k="Scanner" v={spec.scanRange >= 0 ? `${spec.scanRange} al${spec.scanRangePen > 0 ? ` · pénétrant ${spec.scanRangePen} al` : ''}` : 'aucun'} />
      {spec.hasWeapons && <Row k="Puissance" v={fmt(spec.powerRating)} />}
      <div class="btns">
        <button class="small" onClick={() => s.open('split', { fleetId: f.id })} disabled={spec.ships < 2}>Séparer…</button>
        <button class="small" onClick={() => A.splitAll(f)} disabled={f.tokens.length < 2}>Un modèle par flotte</button>
        <button class="small" onClick={() => s.open('merge', { fleetId: f.id })} disabled={!others.length}>Fusionner…</button>
        <button class="small" onClick={() => A.splitSingles(f)} disabled={spec.ships < 2} title="Une flotte par vaisseau, chacune avec les ordres actuels">Un vaisseau par flotte</button>
      </div>
    </Blk>
    {me.exile && !me.exile.refounded && spec.colonizer && f.cargo.colonists > 0 && <div class="alert info insp-pad">Votre peuple vit à bord depuis {me.exile.since}. Tant qu'une arche chargée vole, l'empire vit ; la première colonie fondée deviendra votre nouvelle capitale, avec {REFOUND_FACTORIES} usines et {REFOUND_MINES} mines. Les arches glanent chaque année un dixième de leur réservoir.</div>}
    <OperationBlock g={g} me={me} f={f} />
    <CrewBlock g={g} f={f} />
    <RefitBlock g={g} me={me} f={f} />
    {others.length > 0 && <Blk title={`Autres flottes ici (${others.length})`}>
      <ul class="orbit">{others.map(o => <li><button class="lnk" onClick={() => s.select({ kind: 'fleet', id: o.id })}>{o.name}</button><button class="small" onClick={() => A.merge(f, o)}>Absorber</button><button class="small" onClick={() => s.open('cargo', { fleetId: f.id, otherId: o.id })}>Transférer</button></li>)}</ul>
    </Blk>}
  </div>;
}

/** 0.3.9: the crews (rank, experience, what it gives in battle, record) and the fleet's log. */
function CrewBlock({ g, f }: { g: GameState; f: Fleet }) {
  const [all, setAll] = useState(false);
  if (!veteransOn(g)) return null;
  const armed = fleetSpec(g, f).hasWeapons;
  const r = rankOf(f), xp = f.xp ?? 0, next = RANKS[r + 1];
  const j = [...(f.journal ?? [])].reverse();
  const shown = all ? j : j.slice(0, 4);
  return <Blk cls="crew" title={armed ? <>Équipage · <span class={'rank r' + r} title={rankBonusText(r)}>{r > 0 && <i>{'★'.repeat(r)}</i>} {RANKS[r].name}</span></> : 'Journal de bord'}>
    {armed && <>
      <Bar value={next ? xp - RANKS[r].min : 1} max={next ? next.min - RANKS[r].min : 1} color="#e8c55a" height={6} />
      <div class="small muted">{next ? `${fmt(xp)} points d'expérience ; rang « ${next.name} » à ${next.min}.` : `${fmt(xp)} points d'expérience : le plus haut rang.`} {'On en gagne 3 par bataille survécue, 4 de plus par vaisseau ennemi détruit.'}</div>
      <Row k="En bataille" v={rankBonusText(r)} />
      <Row k="États de service" v={(f.battles ?? 0) === 0 ? 'aucune bataille' : `${f.battles} bataille${(f.battles ?? 0) > 1 ? 's' : ''}, ${f.kills ?? 0} vaisseau${(f.kills ?? 0) > 1 ? 'x' : ''} ennemi${(f.kills ?? 0) > 1 ? 's' : ''} détruit${(f.kills ?? 0) > 1 ? 's' : ''}`} />
    </>}
    {f.born !== undefined && <Row k="En service depuis" v={String(f.born)} />}
    {j.length > 0 && <ul class="journal">{shown.map(e => <li><b>{e.year}</b> {e.text}</li>)}</ul>}
    {j.length > 4 && <button class="lnk small" onClick={() => setAll(!all)}>{all ? 'Réduire le journal' : `Tout le journal (${j.length} entrées)`}</button>}
  </Blk>;
}

/**
 * 0.3.8.7: why a leg can or cannot be a stargate jump, and what the jump would cost. The jump is never chosen for
 * you (as in Stars!): the speed bar's last box, « Portail », when the departure has a gate.
 */
function GateNote({ gc, warp, leg }: { gc: GateCheck; warp: number; leg?: { years: number; fuel: number } }) {
  const inf = (v: number) => v >= 1e9;
  const risk = gc.risks.length > 0 && <div class="hint yellow">Saut risqué : {gc.risks.join(', ')}. Chaque vaisseau peut y perdre jusqu'à {Math.round(gc.damage * 100)} % de son blindage.{gc.lossRisk ? ' Certains peuvent aussi se perdre dans le vide.' : ''}</div>;
  const cargo = gc.dropsCargo && <div class="hint yellow">Votre race ne peut pas faire passer de cargaison par une porte : elle serait déposée à {gc.src!.name} avant le saut.</div>;
  if (warp >= 11) {
    if (gc.problem) return <div class="alert">Le saut sera refusé : {gc.problem}. La flotte partira à sa vitesse idéale.</div>;
    return <>
      {!gc.risks.length && <div class="hint">Saut sans risque, sans carburant : masse sûre {inf(gc.safeMass) ? 'illimitée' : `${fmt(gc.safeMass)} kt`} par vaisseau (le plus lourd : {fmt(gc.heaviest)} kt), portée sûre {inf(gc.safeRange) ? 'illimitée' : `${fmt(gc.safeRange)} al`} (distance : {fmt(gc.dist, 0)} al).</div>}
      {risk}{cargo}
    </>;
  }
  if (!gc.srcGate) {
    // only worth a word when the destination has a gate: the player may expect the jump
    const dg = gc.dst?.starbase && specOf(store.game!, gc.dst.starbase.designId).gate;
    return dg && gc.problem ? <div class="hint muted">Pas de portail pour cette étape : {gc.problem}.</div> : null;
  }
  if (gc.problem) return <div class="hint muted">Pas de portail pour cette étape : {gc.problem}.</div>;
  return <>
    <div class="hint">Portes stellaires à {gc.src!.name} et à {gc.dst!.name} : la dernière case de la barre de vitesse, « Portail », fait le saut en un an, sans carburant. {leg && leg.years <= 1 ? `Ici, Warp ${warp} met aussi un an : le portail n'économiserait que le carburant (${fmt(leg.fuel)} mg).` : leg ? `Le portail ferait gagner ${leg.years - 1} an${leg.years - 1 > 1 ? 's' : ''}.` : ''}</div>
    {risk}{cargo}
  </>;
}

/** 0.3.8.7: where this world's emigrants go, or why it receives some (the settings are on the Empire page). */
function MigrationNote({ g, me, p }: { g: GameState; me: Player; p: Planet }) {
  const ai = autoImmigration(me);
  if (p.migration?.mode === 'out') {
    const t = migrationTargets(g, me);
    if (!t.length) return <div class="pol-note small yellow">{ai.on ? `Aucune destination : aucune planète en Immigration ni colonie habitable sous ${ai.upTo} % de sa capacité. Réglages : Empire, Réseau logistique.` : 'Aucune destination : aucune planète en Immigration. Réglages : Empire, Réseau logistique.'}</div>;
    const names = t.slice(0, 3).map(x => x.planet.name).join(', ');
    return <div class="pol-note small muted" title={t.map(x => x.auto ? `${x.planet.name} : ${fmtPop(x.need * 100)} (automatique)` : `${x.planet.name} : ${fmtPop(x.need * 100)}`).join('\n')}>{t.length > 3 ? `Vers ${t.length} planètes qui manquent de colons (${names}…), les plus proches et les plus vides d'abord. Réglages : Empire, Réseau logistique.` : `Vers ${names}, les plus proches et les plus vides d'abord. Réglages : Empire, Réseau logistique.`}</div>;
  }
  if (!p.migration && ai.on && g.planets.some(x => x.owner === me.id && x.migration?.mode === 'out') && migrationTargets(g, me).some(x => x.planet.id === p.id))
    return <div class="pol-note small muted">Reçoit les émigrants de vos planètes en Émigration jusqu'à {ai.upTo} % de sa capacité (envoi automatique, réglable dans Empire, Réseau logistique).</div>;
  return null;
}
