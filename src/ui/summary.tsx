// Selection summary pane and message pane.
import { pendingRefit } from '../engine/refit';
import { raidNote } from './factions';
import { useState } from 'preact/hooks';
import { store, useStore, fmt, fmtPop, fmtGrowth, MINERAL_COLORS } from './store';
import { pendingForks } from '../engine/doctrines';
import { portalThreat } from '../engine/megaprojects';
import { Bar, HabBar, PlanetImg, HullImg, Row } from './components';
import type { GameState, Player } from '../engine/types';
import { habitability, habString, HAB_NAMES, raceSpec } from '../engine/race';
import { minefieldDecay, minefieldLifetime, minefieldLayers, minefieldOutlook } from '../engine/movement';
import { terraformRemaining, planetSpec, maxPopulation } from '../engine/planet';
import { fleetSpec } from '../engine/fleet';
import { specOf } from '../engine/design';
import { STABILITY_LABELS } from '../engine/universe';
import { estimateTrajectory, estimateSpeed, estimateCourse } from '../engine/scan';
import { planIntercept, traderOffers, traderPositions, TRADER_MIN, TRADER_BEST } from '../engine/intercept';
import { seenStrength, HOPELESS } from '../engine/tasks';
import { fleetStrength } from '../engine/factions';
import { isStudying } from '../engine/anomalies';
import { SealBlock } from './discoveries';
import { GuardianReport, LairReport } from './discoveries';
import { isPureScout } from '../engine/missions';
import { todoItems, nextTodo, TODO_LABELS } from './todo';
import * as A from './actions';
import { refPos } from './map';
import { canUseWormholes, WORMHOLE_NAV, specialReqText } from '../engine/specials';
import { RACE_ICONS } from './art';
import { tl } from '../data/labels';

export function SummaryPane() {
  const s = useStore();
  const g = s.game, me = s.me;
  if (!g || !me || !s.selected) return <div class="summary empty muted">Cliquez sur un objet de la carte.</div>;
  const r = s.selected;
  switch (r.kind) {
    case 'planet': return <PlanetSummary g={g} me={me} id={r.id} />;
    case 'fleet': return <FleetSummary g={g} me={me} id={r.id} />;
    case 'wormhole': {
      const w = me.intel.wormholes[r.id];
      if (!w) return null;
      return <div class="summary"><h3>{g.wormholes.find(x => x.id === w.id)?.sealed ? 'Trou de ver scellé' : 'Trou de ver'}</h3><Row k="Position" v={`(${Math.round(w.x)}, ${Math.round(w.y)})`} /><Row k="Stabilité" v={STABILITY_LABELS[w.stability ?? ''] ?? 'inconnue'} />
        <Row k="Sortie" v={w.destId !== undefined && me.intel.wormholes[w.destId] ? `(${Math.round(me.intel.wormholes[w.destId].x)}, ${Math.round(me.intel.wormholes[w.destId].y)})` : 'inconnue : franchissez-le pour la découvrir'} />
        <Row k="Traversée" v={canUseWormholes(me) ? 'possible' : <span class="red">verrouillée</span>} />
        {!canUseWormholes(me) && <p class="small">Il faut la technologie « {WORMHOLE_NAV.name} » ({specialReqText(WORMHOLE_NAV)}) pour y entrer. D'ici là, une flotte peut s'en approcher mais pas le franchir.</p>}
        <SealBlock g={g} me={me} wormholeId={w.id} />
        <p class="small muted">Traverser un trou de ver ne coûte aucun carburant.{g.wormholes.find(x => x.id === w.id)?.fixed ? '' : ' Ses extrémités dérivent chaque année ; les plus instables peuvent se déplacer brusquement.'}</p></div>;
    }
    case 'minefield': {
      const m = me.intel.minefields[r.id];
      if (!m) return null;
      const title = m.type === 'heavy' ? 'Champ de mines lourd' : m.type === 'speedBump' ? 'Champ de mines ralentisseur' : 'Champ de mines standard';
      const real = g.minefields.find(x => x.id === m.id);
      const dec = minefieldDecay(g, { ...m, detonate: m.owner === me.id ? real?.detonate : undefined });
      const life = minefieldLifetime(g, { ...m, detonate: m.owner === me.id ? real?.detonate : undefined });
      // 0.3.8.1: your own fields: what your fleets lay each year against the decay, and where that leads
      const own = m.owner === me.id && !!real;
      const layers = own ? minefieldLayers(g, real!.id) : [];
      const laid = layers.reduce((a, l) => a + l.rate, 0);
      const net = laid - dec.lost;
      const out = laid > 0 ? minefieldOutlook(g, real!, layers) : null;
      const yrs = (n: number) => `${n} an${n > 1 ? 's' : ''}`;
      const stops = layers.filter(l => l.years !== undefined);
      const trend = !out || out.gone !== undefined || Math.abs(out.final - m.mines) <= Math.max(10, out.final * 0.03) ? null : out.final > m.mines ? 'up' : 'down';
      return <div class="summary"><h3>{title}</h3><Row k="Propriétaire" v={g.players[m.owner].name} /><Row k="Mines posées" v={fmt(m.mines)} /><Row k="Rayon" v={`${fmt(Math.sqrt(m.mines), 1)} al`} /><Row k="Relevé" v={m.year} />
        <Row k="Érosion" v={`−${fmt(dec.lost)} mines/an (${Math.round(dec.rate * 1000) / 10} %)`} />
        {own && <Row k="Pose" v={laid ? `+${fmt(laid)} mines/an` : 'aucune'} title={layers.length ? layers.map(l => l.years !== undefined ? `${l.fleet.name} : +${fmt(l.rate)} mines/an pendant ${yrs(l.years)}` : `${l.fleet.name} : +${fmt(l.rate)} mines/an`).join('\n') : 'Aucune flotte ne pose de mines dans ce champ (tâche « Poser des mines »).'} />}
        {own && laid > 0 && <Row k="Bilan" v={<span class={net > 0 ? 'green' : net < 0 ? 'red' : ''}>{net === 0 ? 'stable' : net > 0 ? `+${fmt(net)} mines/an` : `−${fmt(-net)} mines/an`}</span>} />}
        {/* 0.3.8.2: at the current laying rate, the size where the field levels off, its diameter, and when */}
        {trend && <Row k={trend === 'up' ? 'Taille maximale' : 'Taille d\'équilibre'} v={`≈ ${fmt(Math.round(out!.final))} mines`} />}
        {trend && <Row k={trend === 'up' ? 'Diamètre maximal' : 'Diamètre d\'équilibre'} v={`≈ ${fmt(2 * Math.sqrt(out!.final), 1)} al`} title={`Rayon ≈ ${fmt(Math.sqrt(out!.final), 1)} al (aujourd'hui ${fmt(Math.sqrt(m.mines), 1)} al)`} />}
        {trend && <Row k="Atteinte dans" v={`≈ ${yrs(out!.years)}`} />}
        <Row k="Sans renfort" v={Number.isFinite(life) ? `disparaît dans ≈ ${life} an${life > 1 ? 's' : ''}` : 'stable'} />
        {out && <p class="small">{layers.length > 1 ? <>Posées par {layers.length} flottes ({layers.map(l => l.fleet.name).join(', ')}).</> : stops.length ? <>Posées par {layers[0].fleet.name}, pendant encore {yrs(stops[0].years!)}.</> : <>Posées par {layers[0].fleet.name}.</>}{' '}
          {out.gone !== undefined
            ? (stops.length && net >= 0 ? <>Quand la pose s'arrête, le champ s'use : il disparaît dans ≈ {yrs(out.gone)}.</> : <>La pose ne compense pas l'érosion : le champ disparaît dans ≈ {yrs(out.gone)}.</>)
            : !trend
              ? <>Le champ est à l'équilibre : l'érosion compense la pose.</>
              : trend === 'up'
                ? <>Au rythme actuel, le champ grandit tant que la pose dépasse l'érosion ; mais plus il s'étend, plus il couvre de planètes et plus il s'use vite : il plafonne quand l'érosion égale la pose.</>
                : <>Au rythme actuel, la pose ne suffit pas à entretenir un champ de cette taille : il rétrécit jusqu'à ce que la pose compense l'érosion.</>}</p>}
        <p class="small muted">Vitesse sûre : Warp {m.type === 'standard' ? 4 : m.type === 'heavy' ? 6 : 5} (davantage pour certaines races). Au-delà, chaque année-lumière parcourue dans le champ comporte un risque d'impact.</p>
        <p class="small muted">Un champ perd 2 % de ses mines par an, plus {raceSpec(g.players[m.owner].race).minefieldDecayFactor < 1 ? '1 %' : '4 %'} par planète dans son rayon ({dec.planets} ici) : plus il s'étend, plus il couvre de planètes et plus il s'use vite. Plafond 50 %, minimum {m.type === 'speedBump' ? 2 : 10} mines par an. Chaque impact retire en plus 10 mines si le champ en compte moins de 200, 5 % jusqu'à 1 000 mines, 50 jusqu'à 5 000, 1 % au-delà.</p></div>;
    }
    case 'packet': {
      const k = me.intel.packets.find(x => x.id === r.id);
      if (!k) return null;
      return <div class="summary"><h3>Paquet de minerais</h3><Row k="Propriétaire" v={g.players[k.owner].name} /><Row k="Masse" v={`${fmt(k.mass)} kt`} /><Row k="Vitesse" v={`Warp ${k.warp}`} /><Row k="Destination" v={g.planets[k.targetId].name} /></div>;
    }
    case 'salvage': { const k = me.intel.salvage.find(x => x.id === r.id); return k ? <div class="summary"><h3>Épave</h3><Row k="Minerais" v={`${fmt(k.mass)} kt`} /><p class="small muted">Une flotte avec une soute peut récupérer ces minerais (Transférer).</p></div> : null; }
    case 'trader': return <TraderSummary g={g} me={me} id={r.id} />;
    default: return null;
  }
}

function PlanetSummary({ g, me, id }: { g: GameState; me: Player; id: number }) {
  const pl = g.planets[id];
  const intel = me.intel.planets[id];
  const known = intel.year !== undefined;
  const owner = intel.owner;
  const val = intel.hab ? habitability(me.race, intel.hab) : null;
  const rem = intel.hab ? terraformRemaining(me, { ...pl, hab: intel.hab, baseHab: intel.baseHab ?? intel.hab }) : [0, 0, 0];
  const best = intel.hab ? intel.hab.map((v, i) => v + rem[i]) as [number, number, number] : undefined;
  const bestVal = best ? habitability(me.race, best) : null;
  const age = known ? g.year - intel.year! : null;
  const spec = owner === me.id ? planetSpec(g, pl, me) : null;
  return (
    <div class="summary">
      <div class="sum-head">
        <PlanetImg id={pl.id} hab={intel.hab} size={56} owned={owner === me.id} />
        <div>
          <h3>{pl.name}</h3>
          <div class="small muted">#{pl.id} · ({pl.x}, {pl.y})</div>
          {owner !== undefined && owner >= 0 ? <div class="small" style={{ color: g.players[owner].color }}>{RACE_ICONS[g.players[owner].race.icon % RACE_ICONS.length]} {g.players[owner].name}{intel.homeworld ? ' · monde natal' : ''}</div> : known ? <div class="small muted">Inhabitée</div> : null}
        </div>
      </div>
      {!known ? <p class="muted small">Planète inexplorée. Envoyez un vaisseau en orbite ou approchez un scanner pénétrant pour l'analyser.</p> : <>
        <div class={'report-age ' + (age! > 0 ? 'old' : '')}>{age === 0 ? 'Relevé de cette année' : `Relevé de ${intel.year} (il y a ${age} an${age! > 1 ? 's' : ''})`}</div>
        {val !== null && <Row k="Valeur pour vous" v={<span class={val > 0 ? 'green b' : 'red b'}>{val} %{bestVal !== null && bestVal !== val ? <span class="muted"> ({bestVal} % terraformée)</span> : ''}</span>} />}
        {intel.hab && [0, 1, 2].map(i => <HabBar label={HAB_NAMES[i]} value={intel.hab![i]} base={intel.baseHab?.[i]} best={best?.[i]} lo={me.race.habLow[i]} hi={me.race.habHigh[i]} immune={me.race.immune[i]} text={habString(i, intel.hab![i])} color={['#3b6fe0', '#c23b3b', '#2fa35a'][i]} />)}
        {owner !== undefined && owner >= 0 && <Row k="Population" v={owner === me.id ? fmtPop(pl.pop) : `≈ ${fmtPop(intel.pop ?? 0)}`} />}
        {spec && <Row k="Croissance" v={`${fmtGrowth(spec.growth)} / an (population max. ${fmtPop(spec.maxPop)})`} />}
        {owner === undefined || owner < 0 ? val !== null && val > 0 && <Row k="Population max." v={fmtPop(maxPopulation(g, me, { ...pl, hab: intel.hab! }, val))} /> : null}
        {intel.defenses !== undefined && owner !== undefined && owner >= 0 && owner !== me.id && <Row k="Défenses" v={fmt(intel.defenses)} />}
        {intel.starbaseName && <Row k="Station" v={intel.starbaseName} />}
        <MineralGraph intel={intel} pl={owner === me.id ? pl : undefined} />
      </>}
    </div>
  );
}

function MineralGraph({ intel, pl }: { intel: Player['intel']['planets'][number]; pl?: GameState['planets'][number] }) {
  if (!intel.conc) return null;
  const surf = intel.surface ?? { ironium: 0, boranium: 0, germanium: 0 };
  const maxS = Math.max(1000, surf.ironium, surf.boranium, surf.germanium) * 1.1;
  return (
    <div class="mingraph">
      {(['ironium', 'boranium', 'germanium'] as const).map(m => (
        <div class="mg-row">
          <span class="mg-l" style={{ color: MINERAL_COLORS[m] }}>{m === 'ironium' ? 'Ironium' : m === 'boranium' ? 'Boranium' : 'Germanium'}</span>
          <div class="mg-track">
            <div class="mg-surf" style={{ width: Math.min(100, surf[m] / maxS * 100) + '%', background: MINERAL_COLORS[m] }} />
            <div class="mg-conc" style={{ left: Math.min(100, intel.conc![m]) + '%', borderColor: MINERAL_COLORS[m] }} title={`Concentration ${intel.conc![m]}`} />
          </div>
          <span class="mg-v">{fmt(surf[m])} kt · {intel.conc![m]}{intel.conc![m] > 100 ? '+' : ''}</span>
        </div>
      ))}
      <div class="small muted">Barre : minerais en surface. Losange : concentration (0–100, sur l'échelle). {pl ? '' : ''}</div>
    </div>
  );
}

function FleetSummary({ g, me, id }: { g: GameState; me: Player; id: number }) {
  const own = g.fleets.find(f => f.id === id && f.owner === me.id);
  if (own) {
    const spec = fleetSpec(g, own);
    const d = g.designs.find(x => x.id === own.tokens[0]?.designId);
    return <div class="summary">
      <div class="sum-head">{d && <HullImg hull={d.hull} color={me.color} w={70} />}<div><h3>{own.name}</h3><div class="small muted">{spec.ships} vaisseau(x) · {fmt(spec.mass)} kt</div></div></div>
      <Row k="Carburant" v={`${fmt(own.fuel)} / ${fmt(spec.fuelCapacity)} mg`} />
      {spec.cargoCapacity > 0 && <Row k="Cargaison" v={`${fmt(own.cargo.ironium + own.cargo.boranium + own.cargo.germanium + own.cargo.colonists)} / ${fmt(spec.cargoCapacity)} kt`} />}
      <Row k="Destination" v={own.waypoints.length > 1 ? (own.waypoints[own.waypoints.length - 1].target === 'planet' ? g.planets[own.waypoints[own.waypoints.length - 1].targetId!].name : 'espace') : 'aucune'} />
      <Row k="Vitesse" v={own.waypoints.length > 1 ? (own.waypoints[1].warp >= 11 ? 'porte stellaire' : `Warp ${own.waypoints[1].warp}`) : 'immobile'} />
    </div>;
  }
  const fi = me.intel.fleets.find(f => f.id === id);
  if (!fi) return <div class="summary muted">Cette flotte n'est plus visible.</div>;
  const tr = estimateTrajectory(me, id);
  const age = fi.identYear !== undefined ? g.year - fi.identYear : 0;
  if (fi.detail === 'contact') {
    const who = fi.owner >= 0 ? g.players[fi.owner] : undefined;
    return <div class="summary">
      <h3>{who ? `Flotte des ${who.name}` : 'Contact non identifié'}</h3>
      <Row k="Position" v={`(${Math.round(fi.x)}, ${Math.round(fi.y)})`} />
      {fi.uncertain && <Row k="Masse estimée" v={<>≈ {fmt(fi.mass ?? 0)} kt <span class="muted small">(±30 %)</span></>} />}
      {fi.uncertain && <Row k="Vaisseaux" v={`≈ ${fi.count ?? '?'}`} />}
      <SpeedRow me={me} id={id} />
      <CourseRows g={g} me={me} id={id} />
      <Row k="Trajectoire" v={tr ? 'estimée (orange sur la carte)' : 'inconnue : une seconde observation est nécessaire'} />
      <p class="small muted">{fi.uncertain ? 'Un scanner ordinaire ne donne qu\'une estimation de la masse et du nombre de vaisseaux, que des leurres holographiques peuvent gonfler. Un scanner pénétrant à portée, ou une rencontre au même endroit, révèle la composition exacte.' : 'Un scanner ordinaire ne révèle qu\'une présence. Il faut un scanner pénétrant à portée, ou une rencontre au même endroit, pour connaître le propriétaire et la composition.'}</p>
      <InterceptBlock g={g} me={me} id={id} />
    </div>;
  }
  const owner = g.players[fi.owner];
  // 0.3.9.7: a guardian: what your crews measured of it
  const guard = (g.guardians ?? []).find(x => x.fleetId === id && x.alive);
  const lair = (g.pirates?.lairs ?? []).find(x => x.fleetId === id && x.alive);
  const d = fi.tokens?.[0] ? me.intel.designs[fi.tokens[0].designId] ?? g.designs.find(x => x.id === fi.tokens![0].designId) : undefined;
  return <div class="summary">
    <div class="sum-head">{d && <HullImg hull={d.hull} color={owner.color} w={70} />}<div><h3>{fi.name}</h3><div class="small" style={{ color: owner.color }}>{RACE_ICONS[owner.race.icon % RACE_ICONS.length]} {owner.name}</div></div></div>
    {fi.tokens?.map(t => { const di = me.intel.designs[t.designId]; return <Row k={di?.name ?? 'Modèle inconnu'} v={`× ${t.qty}${di ? ` (${tl(di.hull)})` : ''}`} />; })}
    {fi.mass !== undefined && <Row k="Masse" v={`${fmt(fi.mass)} kt`} />}
    {fi.warp && fi.identYear === undefined ? <Row k="Vitesse" v={`Warp ${fi.warp}`} /> : <SpeedRow me={me} id={id} />}
    <CourseRows g={g} me={me} id={id} />
    <Row k="Trajectoire" v={tr ? 'estimée d\'après les observations' : 'inconnue'} />
    {fi.identYear !== undefined && age > 0 && <div class="stale small">Identifiée en {fi.identYear} (il y a {age} an{age > 1 ? 's' : ''}) puis suivie sans interruption par vos scanners ordinaires : la position est à jour, la composition et la masse datent de l'identification. Si le contact est perdu un an, il redevient inconnu.</div>}
    {raidNote(g, me, id) && <div class="small raid-note">{raidNote(g, me, id)}</div>}
    {guard && <div class="sum-guard"><h4>Force du gardien</h4><GuardianReport g={g} me={me} guardian={guard} /></div>}
    {lair && <div class="sum-guard"><h4>Force du repaire</h4><LairReport g={g} me={me} planetId={lair.planetId} /></div>}
    <InterceptBlock g={g} me={me} id={id} />
  </div>;
}

/** 0.3.8.3: a foreign fleet's speed, from how far it moved between its last two observations. */
function SpeedRow({ me, id }: { me: Player; id: number }) {
  const sp = estimateSpeed(me, id);
  if (!sp) return <Row k="Vitesse estimée" v="inconnue" title="Il faut au moins deux observations, à des années différentes." />;
  const title = `D'après son déplacement entre ${sp.from} et ${sp.to}. Une flotte parcourt chaque année le carré de sa vitesse (Warp 6 : 36 al) ; si elle s'est arrêtée en route, a changé de cap ou a traversé un terrain qui ralentit, elle paraît plus lente.`;
  if (sp.jump) return <Row k="Vitesse estimée" v="saut : porte stellaire ou trou de ver" title={`D'après son déplacement entre ${sp.from} et ${sp.to} : ${fmt(sp.ly, 0)} al par an, plus qu'aucun moteur.`} />;
  if (sp.warp === 0) return <Row k="Vitesse estimée" v="immobile" title={title} />;
  return <Row k="Vitesse estimée" v={sp.exact ? `≈ Warp ${sp.warp} (${fmt(sp.ly, 0)} al/an)` : `Warp ${sp.warp} au moins (${fmt(sp.ly, 0)} al/an)`} title={title} />;
}

/** 0.3.8.4: where a foreign fleet is heading: the first world on its course, and the first of yours if that is another. */
function CourseRows({ g, me, id }: { g: GameState; me: Player; id: number }) {
  const sp = estimateSpeed(me, id);
  if (!sp || sp.warp === 0 || sp.jump) return null;
  const course = estimateCourse(g, me, id);
  const tip = (list: typeof course) => `Prolongement de sa trajectoire, s'il garde son cap et sa vitesse : une flotte peut changer de cap à tout moment.${list.length ? '\n' + list.slice(0, 6).map(c => `${c.planet.name} : ${c.exact ? `≈ ${g.year + c.years}` : `en ${g.year + c.years} au plus tard`}`).join('\n') : ''}${list.length > 6 ? '\n' + `Et ${list.length - 6} autres mondes possibles dans cette direction.` : ''}`;
  if (!course.length) return <Row k="Cap" v="aucune planète dans l'axe" title={tip(course)} />;
  const isMine = (c: typeof course[number]) => me.intel.planets[c.planet.id]?.owner === me.id;
  const label = (c: typeof course[number]) => {
    const o = me.intel.planets[c.planet.id]?.owner;
    const when = c.exact ? `≈ ${g.year + c.years}` : `en ${g.year + c.years} au plus tard`;
    return o === me.id ? <span class="red">{c.planet.name} · {when}</span>
      : o !== undefined && o >= 0 ? <>{c.planet.name} ({g.players[o].name}) · {when}</>
      : <>{c.planet.name} · {when}</>;
  };
  const first = course[0];
  const mine = course.find(isMine);
  return <>
    <Row k={isMine(first) ? 'Cap (chez vous)' : 'Cap'} v={<>{label(first)}{course.length > 1 && <span class="muted small"> (+{course.length - 1})</span>}</>} title={tip(course)} />
    {mine && mine !== first && <Row k="Puis chez vous" v={label(mine)} title={tip(course)} />}
  </>;
}

/** 3.6: the Mystery Trader: where it goes, and one click to send a fleet with enough minerals to meet it. */
function TraderSummary({ g, me, id }: { g: GameState; me: Player; id: number }) {
  const t = me.intel.traders.find(x => x.id === id);
  const real = g.traders.find(x => x.id === id);
  if (!t) return null;
  const done = !!real?.rewarded.includes(me.id);
  const path = traderPositions(g, me, id) ?? [];
  const offers = done ? [] : traderOffers(g, me, id);
  const going = g.fleets.filter(f => f.owner === me.id && f.meetTrader === id);
  const shown = offers.filter(o => !going.includes(o.fleet)).slice(0, 4);
  return <div class="summary"><h3>Marchand nomade</h3>
    <Row k="Vitesse" v={`Warp ${t.warp} (${t.warp * t.warp} al par an)`} />
    <Row k="Trajectoire" v={path.length ? `quitte la galaxie dans ≈ ${path.length} an${path.length > 1 ? 's' : ''} s'il garde son cap` : t.heading ? 'sur le point de quitter la galaxie' : 'cap inconnu'} />
    <p class="small">Il ne s'arrête jamais : il faut l'attendre sur sa route, à l'endroit où il finit une année, avec au moins {fmt(TRADER_MIN)} kt de minerais en soute (jusqu'à {fmt(TRADER_BEST)} kt pour la meilleure récompense). Ses positions des prochaines années sont les chevrons dorés de la carte ; il lui arrive de changer de cap ou d'accélérer.</p>
    {done && <p class="small green">Vous avez déjà commercé avec lui.</p>}
    {going.map(f => <div class="intercept small">{f.name} va à sa rencontre{f.waypoints.length > 1 ? ` (point de rendez-vous en ${Math.round(f.waypoints[1].x)}, ${Math.round(f.waypoints[1].y)})` : ', et l\'attend sur place'}. <button class="small ghost" onClick={() => A.stopTraderMeet(f)}>Annuler</button></div>)}
    {!done && shown.map(o => <div class="intercept">
      <button class="small primary" onClick={() => A.meetTrader(o, id)} title="Ordre permanent : le point de rendez-vous est recalculé chaque année tant que le Marchand reste en vue">Intercepter ce marchand avec {o.fleet.name}</button>
      <div class="small muted">{o.load ? `charge ${fmt(o.total - o.carried)} kt de minerais à ${o.from!.name}, ` : `${fmt(o.carried)} kt en soute, `}rencontre en {g.year + o.plan.years}{o.plan.ourYears < o.plan.years ? ` (sur place en ${g.year + o.plan.ourYears}, puis attente)` : ''}, Warp {o.plan.warp}{o.total >= TRADER_BEST ? ' · meilleure récompense' : ''}</div>
    </div>)}
    {!done && !shown.length && !going.length && <p class="small muted">Aucune de vos flottes ne peut le rejoindre avec {fmt(TRADER_MIN)} kt de minerais : il faut un cargo d'au moins {fmt(TRADER_MIN)} kt de soute, sur une de vos planètes qui a assez de minerais, et à portée de sa route.</p>}
  </div>;
}

/** One click: the commanded fleet intercepts this foreign fleet (Constellations 3.2). */
function InterceptBlock({ g, me, id }: { g: GameState; me: Player; id: number }) {
  const s = useStore();
  const f = s.commanded?.kind === 'fleet' ? g.fleets.find(x => x.id === s.commanded!.id && x.owner === me.id) : undefined;
  const chasers = g.fleets.filter(x => x.owner === me.id && x.pursue === id);
  if (!f) return <div class="intercept small muted">{chasers.length ? <>Poursuivie par {chasers.map(c => c.name).join(', ')}. </> : ''}Pour l'intercepter, sélectionnez d'abord une de vos flottes, puis cliquez sur ce contact.</div>;
  const plan = planIntercept(g, f, id);
  const already = f.pursue === id;
  const plan2 = plan.ok ? plan : null;
  // 3.6: a manual interception is allowed even when hopeless, but said so
  const theirs = seenStrength(g, me, id), mine = fleetStrength(g, f);
  const hopeless = theirs !== null && fleetSpec(g, f).hasWeapons && theirs > HOPELESS * mine;
  return <div class="intercept">
    {hopeless && <div class="small red">Déconseillé : la flotte visée est bien plus forte que votre flotte {f.name} (environ ×{fmt(theirs! / Math.max(1, mine), 1)}). Une patrouille refuserait de l'attaquer.</div>}
    {chasers.length > 0 && <div class="small">Poursuivie par {chasers.map(c => c.name).join(', ')}.</div>}
    {plan2 ? <div class="small">{plan2.ourYears === 0 ? `${f.name} est déjà au point de rencontre.` : plan2.direct ? `${f.name} peut la rejoindre cette année (Warp ${plan2.warp}).` : <>Rencontre prévue en <b>{g.year + plan2.years}</b> en ({plan2.x}, {plan2.y}) : {f.name} y sera en {g.year + plan2.ourYears} à Warp {plan2.warp}{plan2.ourYears < plan2.years ? ' et attendra' : ''}.</>}
      {plan2.estimated && <span class="muted"> Estimation : si elle garde cap et vitesse.</span>}</div>
      : <div class="small yellow">Interception impossible avec {f.name} : {(plan as { reason: string }).reason}.</div>}
    <button class={already ? 'small' : 'small primary'} disabled={!plan2 || already} onClick={() => A.intercept(id)} title="Ordre permanent : le point de rencontre est recalculé chaque année tant que la cible reste visible">{already ? `${f.name} la poursuit déjà` : `Intercepter avec ${f.name}`}</button>
    {already && <button class="small ghost" onClick={() => A.stopPursuit(f)}>Arrêter la poursuite</button>}
    {plan2 && <div class="small muted">Le combat n'a lieu que si l'un des deux camps attaque l'autre (plan de bataille, relations).</div>}
  </div>;
}

/**
 * Things that usually need an order this year (QoL, not in Stars!). 0.3.9: one queue (todo.ts): the first chip, or T,
 * walks through all of it; each other chip walks through its own group.
 */
export function TodoBar() {
  const s = useStore();
  const g = s.game!, me = s.me!;
  const [cursor, setCursor] = useState<Record<string, number>>({});
  const all = todoItems(g, me);
  // decisions, doctrines and proposals have their own alerts in the header: the chips are for fleets and colonies
  const groups = (['scouts', 'colo', 'cargo', 'fuel', 'queue'] as const).map(id => ({ id, list: all.filter(x => x.group === id) })).filter(x => x.list.length);
  const portal = g.settings.megaprojects ? portalThreat(g) : null;
  const rival = portal && portal.owner !== me.id && portal.announced > 0 ? portal : null;
  if (!all.length && !rival) return null;
  return <div class="todo" data-tut="todo">
    {all.length > 0 && <button class="small primary todo-next" onClick={() => nextTodo(1)} title="Passer à la chose suivante à traiter (T ; Maj+T : précédente)">À traiter : <b>{all.length}</b> <kbd>T</kbd></button>}
    {rival && <button class="small" onClick={() => s.focus({ kind: 'planet', id: rival.planet.id }, rival.planet)}>Portail des {g.players[rival.owner].name} : <b>{rival.announced} %</b></button>}
    {groups.map(it => <button class="small" title="Cliquer pour passer au suivant" onClick={() => {
      const k = (cursor[it.id] ?? -1) + 1, o = it.list[k % it.list.length];
      setCursor({ ...cursor, [it.id]: k });
      s.todoKey = o.key; o.go();
    }}><b>{it.list.length}</b> {TODO_LABELS[it.id]}</button>)}</div>;
}

export { Bar, specOf };
