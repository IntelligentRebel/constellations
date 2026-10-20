// Fleet order widgets shared by the selection panel: fuel and cargo, warp table, waypoint tasks.
import { viewFleet } from './memo';
import { useState } from 'preact/hooks';
import { store, useStore, fmt, fmtPop, pct, MINERAL_COLORS } from './store';
import { Tile, Bar, PlanetImg, HullImg, Row, MineralLine, Num, CompIcon } from './components';
import type { Fleet, GameState, Planet, TransportKey, WaypointTask } from '../engine/types';
import { TRANSPORT_KEYS } from '../engine/types';
import { planetSpec } from '../engine/planet';
import { fleetSpec, estimateRoute, distance, cargoMass, travelYears, routeFuelPreview } from '../engine/fleet';
import { specOf, designSpec } from '../engine/design';
import { itemLabel, isAuto, estimateQueue } from '../engine/production';
import { raceSpec } from '../engine/race';
import * as A from './actions';
import { STABILITY_LABELS } from '../engine/universe';
import { minefieldsOnLeg } from '../engine/movement';
import { defaultTankerRange, tankerTargets } from '../engine/refuel';
import { beaconBlocker, miningBlocker, BEACON_RADIUS } from '../engine/culture';
import { newestRefit, refitTargets } from '../engine/refit';

export function FuelCargo({ g, f, compact, onCargo }: { g: GameState; f: Fleet; compact?: boolean; /** 3.6: a click on the hold opens the exchange window */ onCargo?: () => void }) {
  const spec = viewFleet(g, f);
  const cm = cargoMass(f.cargo);
  // fuel the route will burn, shown greyed in the gauge
  const fp = spec.fuelCapacity > 0 ? routeFuelPreview(g, f) : null;
  const refuel = fp?.refuelAt !== undefined ? wpName(g, f.owner, f.waypoints[fp.refuelAt]) : '';
  const fuelLine = !fp ? '' : fp.dry ? `Trajet : panne sèche avant ${refuel ? refuel : 'l\'arrivée'} (la fin se fera à Warp 1)` : `Trajet : ${fmt(fp.start - fp.after)} mg${refuel ? ` jusqu'au plein à ${refuel}` : ''}, il restera ${fmt(fp.after)} mg${refuel ? ' en y arrivant' : ' à destination'}`;
  return (
    <div class="fuelcargo">
      <div class="fc-row"><span class="k">Carburant</span><Bar value={fp ? fp.start : f.fuel} max={spec.fuelCapacity} color={f.fuel < spec.fuelCapacity * 0.2 ? '#ff5d5d' : '#2f9e7e'} label={`${fmt(f.fuel)} / ${fmt(spec.fuelCapacity)} mg`} warn={f.fuel <= 0}
        ghost={fp ? { from: fp.after, to: fp.start, bad: fp.dry, title: fuelLine } : undefined} /></div>
      {fp && !compact && <div class={'small ' + (fp.dry ? 'red' : 'muted')}>{fuelLine}</div>}
      {spec.cargoCapacity > 0 && <div class={'fc-row' + (onCargo ? ' clickable' : '')} onClick={onCargo} title={onCargo ? 'Cliquer pour échanger la cargaison' : undefined} role={onCargo ? 'button' : undefined}><span class="k">Soute</span><Bar value={cm} max={spec.cargoCapacity} color="#888" segments={[{ value: f.cargo.ironium, color: MINERAL_COLORS.ironium }, { value: f.cargo.boranium, color: MINERAL_COLORS.boranium }, { value: f.cargo.germanium, color: MINERAL_COLORS.germanium }, { value: f.cargo.colonists, color: '#d8dee9' }]} label={`${fmt(cm)} / ${fmt(spec.cargoCapacity)} kt`} /></div>}
      {!compact && spec.cargoCapacity > 0 && <div class={'small muted' + (onCargo ? ' clickable' : '')} onClick={onCargo}>Fe <span style={{ color: MINERAL_COLORS.ironium }}>{fmt(f.cargo.ironium)}</span> · Bo <span style={{ color: MINERAL_COLORS.boranium }}>{fmt(f.cargo.boranium)}</span> · Ge <span style={{ color: MINERAL_COLORS.germanium }}>{fmt(f.cargo.germanium)}</span> · colons {fmtPop(f.cargo.colonists * 100)}</div>}
    </div>
  );
}

export const TASK_LABELS: Record<WaypointTask, string> = {
  none: '(aucune tâche)', transport: 'Transport', colonize: 'Coloniser', remoteMine: 'Minage à distance', merge: 'Fusionner avec une flotte',
  scrap: 'Démanteler la flotte', layMines: 'Poser des mines', patrol: 'Patrouiller', route: 'Suivre la route', transfer: 'Céder la flotte',
  refuel: 'Ravitailler les flottes', beacon: 'Poser une balise de souveraineté',
  stay: 'Rester en poste', refit: 'Moderniser la flotte',
};
const ACTIONS: Record<string, string> = {
  none: '—', loadAll: 'Tout charger', unloadAll: 'Tout décharger', loadAmount: 'Charger exactement', unloadAmount: 'Décharger exactement',
  fillPercent: 'Remplir jusqu\'à %', waitPercent: 'Attendre % de remplissage', loadOptimal: 'Charger l\'optimal', loadDunnage: 'Compléter (lest)',
  setAmount: 'Fixer la quantité à bord', setWaypoint: 'Fixer la quantité sur place',
};

export function WarpTable({ g, f, i }: { g: GameState; f: Fleet; i: number }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button class="link small" onClick={() => setOpen(true)}>Comparer les vitesses…</button>;
  const spec = viewFleet(g, f);
  const rows = [];
  for (let w = 1; w <= 10; w++) {
    const wps = f.waypoints.map((x, j) => j === i ? { ...x, warp: w } : x);
    const est = estimateRoute(g, f, wps);
    const leg = est[i - 1];
    rows.push(<tr class={leg.ok ? '' : 'bad'} onClick={() => A.setWarp(i, w)}><td>{w}{w === spec.idealSpeed ? ' ★' : ''}</td><td>{leg.years}</td><td>{fmt(leg.fuel)}</td><td>{fmt(leg.fuelAfter)}</td></tr>);
  }
  return <table class="warp-table"><thead><tr><th>Warp</th><th>Ans</th><th>Conso</th><th>Reste</th></tr></thead><tbody>{rows}</tbody></table>;
}

export function wpName(g: GameState, me: number, w: { target: string; targetId?: number; x: number; y: number; detour?: boolean }): string {
  if (w.target === 'planet' && w.targetId !== undefined) return g.planets[w.targetId].name;
  if (w.detour) return `Contournement (${Math.round(w.x)}, ${Math.round(w.y)})`;
  if (w.target === 'fleet' && w.targetId !== undefined) {
    const f = g.fleets.find(x => x.id === w.targetId);
    if (f && (f.owner === me || g.players[me].intel.fleets.some(x => x.id === f.id && x.detail === 'full'))) return f.name;
    return 'Flotte inconnue';
  }
  if (w.target === 'wormhole') return 'Trou de ver';
  if (w.target === 'trader') return 'Marchand nomade';
  return `Espace (${Math.round(w.x)}, ${Math.round(w.y)})`;
}

export function taskPossible(g: GameState, f: Fleet, t: WaypointTask): boolean {
  const spec = viewFleet(g, f);
  switch (t) {
    case 'colonize': return spec.colonizer || spec.orbitalConstruction;
    case 'remoteMine': return spec.miningRate > 0;
    case 'layMines': return spec.mineLaying.standard + spec.mineLaying.heavy + spec.mineLaying.speedBump > 0;
    case 'transport': return spec.cargoCapacity > 0 || spec.fuelCapacity > 0;
    case 'refuel': return spec.hasEngines && spec.fuelCapacity > 0;
    case 'beacon': return spec.beaconKits > 0 && !!g.settings.culture;
    case 'refit': return f.tokens.some(t => !!newestRefit(g, g.players[f.owner], t.designId) || refitTargets(g, g.players[f.owner], t.designId).length > 0);
    default: return true;
  }
}

export function TaskDetails({ g, f, i }: { g: GameState; f: Fleet; i: number }) {
  const s = store;
  const me = s.me!;
  const wp = f.waypoints[i];
  const spec = viewFleet(g, f);
  switch (wp.task) {
    case 'transport':
      return <table class="transport">
        <tbody>{TRANSPORT_KEYS.map(k => {
          const o = wp.transport?.[k] ?? { action: 'none', amount: 0 };
          const needsAmount = ['loadAmount', 'unloadAmount', 'fillPercent', 'waitPercent', 'setAmount', 'setWaypoint'].includes(o.action);
          return <tr class={o.action !== 'none' ? 'on' : ''}>
            <td style={{ color: k === 'fuel' ? '#ff8080' : k === 'colonists' ? '#e8ecf4' : MINERAL_COLORS[k] }}>{({ fuel: 'Carburant', ironium: 'Ironium', boranium: 'Boranium', germanium: 'Germanium', colonists: 'Colons' } as Record<TransportKey, string>)[k]}</td>
            <td><select value={o.action} onChange={e => A.setTransport(i, k, (e.target as HTMLSelectElement).value, o.amount)}>
              {Object.entries(ACTIONS).filter(([a]) => (a !== 'loadOptimal' || k === 'fuel') && (a !== 'loadDunnage' || k !== 'fuel')).map(([a, l]) => <option value={a}>{l}</option>)}
            </select></td>
            <td>{needsAmount && <Num value={o.amount} min={0} onChange={v => A.setTransport(i, k, o.action, v)} width={64} />}</td>
          </tr>;
        })}</tbody>
      </table>;
    case 'colonize': {
      const pl = wp.target === 'planet' && wp.targetId !== undefined ? g.planets[wp.targetId] : undefined;
      return <div class="small">{pl ? `La flotte fondera une colonie sur ${pl.name} à son arrivée avec ${fmtPop(f.cargo.colonists * 100)} colons. Les vaisseaux seront démantelés (75 % des minerais récupérés).` : 'Choisissez une planète comme étape.'}{f.cargo.colonists === 0 && <div class="alert">Aucun colon à bord.</div>}</div>;
    }
    case 'remoteMine': { const pl = wp.target === 'planet' && wp.targetId !== undefined ? g.planets[wp.targetId] : undefined; const fb = pl ? miningBlocker(g, me, pl, true) : null; return <div class="small">Extraction : {spec.miningRate} mines robotisées. Les minerais sont déposés à la surface de la planète (inhabitée).{fb !== null && <div class="alert">{pl!.name} est dans le territoire de vos amis les {g.players[fb].name} : on n'y fore pas (seulement en étant neutre ou en guerre avec eux).</div>}</div>; }
    case 'layMines': return <div class="small">Mines posées par an : {spec.mineLaying.standard ? `${spec.mineLaying.standard} standard ` : ''}{spec.mineLaying.heavy ? `${spec.mineLaying.heavy} lourdes ` : ''}{spec.mineLaying.speedBump ? `${spec.mineLaying.speedBump} ralentisseuses` : ''}
      <div>Durée : <Num value={wp.layYears ?? 0} min={0} onChange={v => { s.checkpoint(); wp.layYears = v; s.bump(); }} width={60} /> ans (0 = indéfiniment)</div></div>;
    case 'patrol': return <div class="small">Intercepte, à la vitesse choisie, les ennemis détectés dans un rayon de <Num value={wp.patrolRange ?? 50} min={10} max={500} step={10} onChange={v => { s.checkpoint(); wp.patrolRange = v; s.bump(); }} width={70} /> al · vitesse de la patrouille : Warp <Num value={wp.patrolWarp ?? (spec.idealSpeed || 6)} min={1} max={10} onChange={v => { s.checkpoint(); wp.patrolWarp = v; s.bump(); }} width={50} /></div>;
    case 'refuel': {
      const auto = defaultTankerRange(g, f);
      const range = wp.patrolRange ?? auto;
      const onDuty = i === 0 && f.waypoints.length === 1 && f.refuelFor === undefined;
      const next = onDuty ? tankerTargets(g, f)[0] : undefined;
      return <div class="small">Ravitaille vos flottes à court de carburant dans un rayon de <Num value={range} min={10} max={1000} step={10} onChange={v => { s.checkpoint(); wp.patrolRange = v; s.bump(); }} width={70} /> al autour de ce point, puis revient s'y poster (en passant faire le plein si son réservoir est trop bas). Elle ne part que si elle garde de quoi rejoindre un port après la livraison, et renonce dès que ce n'est plus le cas.
        {spec.fuelCapacity < 150 && <div class="alert">Réservoir de {fmt(spec.fuelCapacity)} mg seulement : elle n'aura presque rien à céder. Un modèle avec des réservoirs supplémentaires fait un bien meilleur ravitailleur.</div>}
        <div class="muted">Rayon conseillé : {auto} al (≈ 40 % de son autonomie{Number.isFinite(spec.estimatedRange) ? ` de ${fmt(spec.estimatedRange)} al` : ''}). Réservoir : {fmt(spec.fuelCapacity)} mg.</div>
        {onDuty && <div>{next ? `Prochaine mission : ${next.dry.name} (≈ ${fmt(next.give)} mg, rencontre en ${g.year + next.plan.years}).` : 'Aucune flotte à ravitailler dans ce rayon pour l\'instant.'}</div>}
      </div>;
    }
    case 'beacon': {
      const pl = wp.target === 'planet' && wp.targetId !== undefined ? g.planets[wp.targetId] : undefined;
      const why = pl ? beaconBlocker(g, f, pl) : 'choisissez une planète libre comme étape';
      return <div class="small">À l'arrivée, un vaisseau qui porte le kit devient une balise de souveraineté : un fort armé, immobile, qui revendique le monde et {BEACON_RADIUS} al autour. Aucun autre empire ne pourra y fonder de colonie tant qu'elle tient ; quand vous le colonisez vous-même, elle devient sa station.{why && <div class="alert">{why[0].toUpperCase() + why.slice(1)}.</div>}</div>;
    }
    case 'merge': {
      const cands = g.fleets.filter(x => x.owner === me.id && x !== f && Math.abs(x.x - wp.x) < 1 && Math.abs(x.y - wp.y) < 1);
      return <div class="small">Fusionner avec : <select value={wp.mergeWith} onChange={e => { s.checkpoint(); wp.mergeWith = +(e.target as HTMLSelectElement).value; s.bump(); }}><option value="">—</option>{cands.map(c => <option value={c.id}>{c.name}</option>)}</select></div>;
    }
    case 'transfer':
      return <div class="small">Céder à : <select value={wp.transferTo} onChange={e => { s.checkpoint(); wp.transferTo = +(e.target as HTMLSelectElement).value; s.bump(); }}><option value="">—</option>{me.intel.met.map(o => <option value={o}>{g.players[o].name}</option>)}</select></div>;
    case 'scrap': {
      const w = f.waypoints[i];
      const pl = w.target === 'planet' && w.targetId !== undefined ? g.planets[w.targetId] : undefined;
      const intel = pl ? store.me!.intel.planets[pl.id] : undefined;
      const ok = !!pl && !!intel && (((intel.owner ?? -1) >= 0 && (intel.pop ?? 0) > 0) || !!intel.starbaseName);
      return <div class="small">La flotte sera démantelée. Sur une colonie ou au-dessus d'une station, environ un tiers des minerais sont déposés sur la planète, au profit de son propriétaire (davantage avec une station).{!ok && <div class="alert">{pl ? `${pl.name} n'a ni colonie ni station connue` : 'Pas de planète à cette étape'} : rien ne sera récupéré, l'épave dérivera sur place et se dispersera.</div>}</div>;
    }
    case 'route': return <div class="small">À l'arrivée, la flotte continue vers la destination de route de la planète.</div>;
    case 'stay': return <div class="small">La flotte reste en poste à cette étape, sans compter comme « en attente d'ordres » : pas de rapport d'arrivée « attend des ordres », pas de rappel « sans ordre ». Idéal pour un éclaireur en sentinelle.</div>;
    case 'refit': {
      const pl = wp.target === 'planet' && wp.targetId !== undefined ? g.planets[wp.targetId] : undefined;
      const ids = [...new Set(f.tokens.map(t => t.designId))];
      const set = (from: number, to: number) => { s.checkpoint(); wp.refitTo = { ...(wp.refitTo ?? {}), [from]: to }; s.bump(); };
      return <div class="small">À l'arrivée, chaque modèle de la flotte est modernisé vers le modèle choisi (même coque), en tête de la file du chantier ; la flotte reste en orbite pendant les travaux.
        {(!pl || pl.owner !== me.id || !pl.starbase) && <div class="alert">Il faut une de vos planètes avec une station comme étape.</div>}
        <table class="transport"><tbody>{ids.map(id => {
          const from = g.designs.find(d => d.id === id)!;
          const targets = refitTargets(g, me, id).sort((a, b) => b.id - a.id);
          const cur = wp.refitTo?.[id] ?? newestRefit(g, me, id)?.id ?? -1;
          return <tr><td>{from.name}</td><td>→</td><td><select value={cur} onChange={e => set(id, +(e.target as HTMLSelectElement).value)}><option value={-1}>ne pas moderniser</option>{targets.map(d => <option value={d.id}>{d.name}</option>)}</select></td></tr>;
        })}</tbody></table>
      </div>;
    }
    default: return null;
  }
}

export { travelYears, distance, designSpec, CompIcon, MineralLine, STABILITY_LABELS };
