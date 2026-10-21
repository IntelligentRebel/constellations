// Culture and territory in the interface (Constellations 3.3): planet blocks, the Empire page section.
import { viewFleet, viewMemo } from './memo';
import { useStore, fmt } from './store';
import { Row } from './components';
import type { GameState, Planet, Player } from '../engine/types';
import {
  cultureOn, radius, cultureGain, assimilation, territoryOwner, knownTerritoryOwner, CULTURE_BUILDINGS, PATRONAGE, hasReq, reqText,
  ASSIM_NEEDED, RADIUS_MAX, territoryGrid, cultureFronts, influenceAt, beaconAt, beaconBlocker, miningBlocker, BEACON_RADIUS, type CultureBuildingId,
} from '../engine/culture';
import type { Fleet } from '../engine/types';
import { fleetSpec, distance, estimateRoute } from '../engine/fleet';
import { specOf } from '../engine/design';
import * as A from './actions';

const ofEmpire = (g: GameState, o: number) => `des ${g.players[o].name}`;

/** Own planet: culture gathered, radiance, buildings, foreign pressure. */
export function CultureBlock({ g, me, p }: { g: GameState; me: Player; p: Planet }) {
  const s = useStore();
  if (!cultureOn(g)) return null;
  const gain = cultureGain(g, p);
  const r = radius(p);
  const a = assimilation(g, p);
  const parts = [`population ${fmt(gain.pop, 1)}`, gain.capital ? `capitale ${gain.capital}` : '', gain.station ? `station ${gain.station}` : '', gain.buildings ? `bâtiments ${gain.buildings}` : ''].filter(Boolean).join(' · ');
  const built = new Set(p.cultureBld ?? []);
  const next = CULTURE_BUILDINGS.find(b => !built.has(b.id) && hasReq(me, b.req) && !p.queue.some(q => q.kind === 'culture' && q.cultureId === b.id));
  const progress = p.assim?.progress ?? 0;
  return <section class="blk culture">
    <div class="blk-head"><h3>Culture</h3><span class="small muted">{fmt(Math.round(p.culture ?? 0))} points</span></div>
    <Row k="Rayonnement" v={<>{r.toFixed(0)} al{r >= RADIUS_MAX ? <span class="muted small"> (maximum)</span> : ''}</>} title="Rayon du territoire que la planète projette autour d'elle" />
    <Row k="Gain annuel" v={<>+{fmt(gain.total, 1)}</>} title="Moins 0,5 % de la culture accumulée chaque année" />
    <div class="small muted cparts">{parts} · érosion 0,5 %/an</div>
    <Row k="Bâtiments" v={CULTURE_BUILDINGS.map(b => <span class={'cbld' + (built.has(b.id) ? ' on' : '')} title={`${b.name} : ${b.text}${built.has(b.id) ? '' : ` Il faut ${reqText(b.req)}.`}`}>{b.name}{built.has(b.id) ? ' ✓' : ''}</span>)} />
    <div class="btns">
      {next && <button class="small" onClick={() => A.queueAdd(p.id, 'culture', undefined, 1, 0, undefined, next.id)} title={`${next.text} En tête de file.`}>Construire : {next.name}</button>}
      {hasReq(me, PATRONAGE.req) && <button class="small" onClick={() => A.queueAdd(p.id, 'patronage', undefined, 5, 0)} title={`5 × ${PATRONAGE.cost.resources} ressources → ${5 * PATRONAGE.points} points de culture, en tête de file`}>Mécénat ×5</button>}
    </div>
    {a.by >= 0 && (a.rate > 0 || progress > 0) ? <div class={'alert' + (progress > ASSIM_NEEDED * 0.5 ? ' strong' : '')}>
      La culture {ofEmpire(g, a.by)} domine ici ({fmt(a.ratio, 1)} fois la vôtre) : assimilation {Math.round(progress / ASSIM_NEEDED * 100)} %{a.rate > 0 ? `, bascule dans ≈ ${a.years} an${a.years > 1 ? 's' : ''}` : ', en recul'}{a.immune ? ` (${a.immune})` : ''}.
      <div class="small">Pour garder ce monde : bâtiments culturels et mécénat ici, une station en orbite (divise par deux la vitesse d'assimilation), ou affaiblir les mondes voisins des {g.players[a.by].name}.</div>
    </div> : a.by >= 0 ? <div class="small muted">Influence étrangère : {ofEmpire(g, a.by)}, {fmt(a.ratio, 2)} fois la vôtre{a.immune ? ` · ${a.immune}` : ' (sans effet sous 1,25)'}.</div> : null}
  </section>;
}

/** Any other planet: whose territory it lies in. */
export function TerritoryNote({ g, me, p }: { g: GameState; me: Player; p: Planet }) {
  if (!cultureOn(g)) return null;
  const intel = me.intel.planets[p.id];
  const owned = (intel?.owner ?? -1) >= 0;
  const o = knownTerritoryOwner(g, me, p);
  if (owned && intel.owner !== me.id) {
    // a foreign world: is our culture winning it over?
    const pl = g.planets[p.id];
    const ours = pl.owner === intel.owner && pl.assim?.by === me.id ? pl.assim.progress : 0;
    const inf = influenceAt(g, p).get(me.id) ?? 0;
    return <div class="terr-note small">{ours > 0 ? <span class="green">Votre culture gagne ce monde : {Math.round(ours / ASSIM_NEEDED * 100)} % de l'assimilation.</span> : inf > 0 ? <span>Votre influence l'atteint ({inf.toFixed(0)}) mais ne domine pas.</span> : <span class="muted">Hors de votre influence culturelle.</span>}</div>;
  }
  if (owned) return null;
  const b = beaconAt(g, p.id);
  const known = b && (b.owner === me.id || me.intel.fleets.some(x => x.id === b.id && x.owner === b.owner));
  const mineBan = miningBlocker(g, me, p, true);
  return <div class={'terr-note small' + (o >= 0 && o !== me.id ? ' foreign' : '')}>
    {known && b && (b.owner === me.id
      ? <div class="green">⚑ Votre balise de souveraineté est en orbite.</div>
      : <div>⚑ Balise de souveraineté des {g.players[b.owner].name} en orbite : il faut la détruire avant de pouvoir coloniser ce monde.</div>)}
    {mineBan !== null && <div>Forage interdit : territoire de vos amis les {g.players[mineBan].name}.</div>}
    {o < 0 ? <span class="muted">Espace neutre : n'importe quel empire peut s'y installer.</span>
      : o === me.id ? <span class="green">Votre territoire : aucun autre empire ne peut coloniser ce monde.</span>
      : <span>Territoire {ofEmpire(g, o)} : <b>colonisation impossible</b>. Il faudra affaiblir leur influence ou conquérir ce monde une fois qu'ils l'auront colonisé.</span>}
  </div>;
}

/** Empire page: culture gathered, territory, worlds pressed or winning. */
export function CultureSection({ g, me }: { g: GameState; me: Player }) {
  const s = useStore();
  const own = g.planets.filter(p => p.owner === me.id);
  const perYear = own.reduce((a, p) => a + cultureGain(g, p).total, 0);
  const t = territoryGrid(g, me);
  let mine = 0, foreign = 0;
  for (const o of t.grid) { if (o === me.id) mine++; else if (o >= 0) foreign++; }
  const fronts = cultureFronts(g, me);
  const blds = own.reduce((a, p) => a + (p.cultureBld ?? []).length, 0);
  const best = [...own].sort((a, b) => radius(b) - radius(a)).slice(0, 3);
  const go = (p: Planet) => s.focus({ kind: 'planet', id: p.id }, p);
  return <>
    <div class="emp-kpis">
      <div><small>Culture par an</small><b>+{perYear.toFixed(0)}</b><small>{own.length} colonies</small></div>
      <div><small>Votre territoire</small><b>{fmt(mine / t.grid.length * 100, 1)} %</b><small>de la galaxie (autres empires connus : {fmt(foreign / t.grid.length * 100, 1)} %)</small></div>
      <div><small>Bâtiments culturels</small><b>{blds}</b><small>sur {own.length * CULTURE_BUILDINGS.length} possibles</small></div>
      <div><small>Plus grand rayonnement</small><b>{best[0] ? `${radius(best[0]).toFixed(0)} al` : '—'}</b><small>{best.map(p => p.name).join(', ')}</small></div>
    </div>
    {fronts.ours.length > 0 && <div class="alert"><b>Vos mondes sous influence étrangère</b>
      <ul class="cult-list">{fronts.ours.map(x => <li><button class="lnk" onClick={() => go(x.pl)}>{x.pl.name}</button> : culture {ofEmpire(g, x.by)}, assimilation {Math.round(x.progress / ASSIM_NEEDED * 100)} %{Number.isFinite(x.years) ? `, bascule dans ≈ ${x.years} ans` : ''}</li>)}</ul></div>}
    {fronts.theirs.length > 0 && <div class="alert info"><b>Mondes étrangers que votre culture gagne</b>
      <ul class="cult-list">{fronts.theirs.map(x => <li><button class="lnk" onClick={() => go(x.pl)}>{x.pl.name}</button> ({g.players[x.pl.owner].name}) : {Math.round(x.progress / ASSIM_NEEDED * 100)} %{Number.isFinite(x.years) ? `, dans ≈ ${x.years} ans` : ''}</li>)}</ul></div>}
    <p class="small muted">Chaque colonie rayonne autour d'elle : sa culture vient de sa population, de son rôle de capitale, d'une station en orbite et de ses bâtiments culturels, et s'érode de 0,5 % par an. Le rayon croît comme la racine carrée de la culture, jusqu'à {RADIUS_MAX} al. En chaque point, l'empire à la plus forte influence possède le territoire ; chaque monde colonisé garde toujours son noyau. Personne ne peut fonder de colonie dans le territoire d'un autre. Un monde où la culture étrangère pèse plus de 1,25 fois la sienne glisse peu à peu vers l'empire étranger et passe sous son contrôle au bout de quelques décennies (jamais une capitale ; répit après une fondation, une conquête ou une bascule).</p>
    <p class="small muted">Bâtiments : {CULTURE_BUILDINGS.map(b => `${b.name} (+${b.perYear}/an, ${reqText(b.req)})`).join(' · ')}. Mécénat : {PATRONAGE.cost.resources} ressources → {PATRONAGE.points} points, répétable, aussi en automatique en fin de file.</p>
  </>;
}

/** Free planet: claim it with a sovereignty beacon (fleets of yours carrying a kit). */
export function ClaimBlock({ g, me, p }: { g: GameState; me: Player; p: Planet }) {
  if (!cultureOn(g) || p.owner >= 0 || (me.intel.planets[p.id]?.owner ?? -1) >= 0) return null;
  const b = beaconAt(g, p.id);
  if (b && b.owner === me.id) return null;
  const kits = g.fleets.filter(f => f.owner === me.id && f.beaconOf === undefined && viewFleet(g, f).beaconKits > 0);
  const o = knownTerritoryOwner(g, me, p);
  if (o >= 0 && o !== me.id) return null;
  const ready = kits.filter(f => !beaconBlocker(g, f, p)).sort((a, b2) => distance(a, p) - distance(b2, p)).slice(0, 3);
  return <section class="blk claim">
    <div class="blk-head"><h3>Revendiquer</h3><span class="small muted">balise de souveraineté</span></div>
    <p class="small muted">Une balise posée en orbite revendique ce monde et {BEACON_RADIUS} al autour : un fort armé qu'un autre empire devra détruire avant de pouvoir coloniser ici. Il faut un vaisseau qui porte un kit de balise.</p>
    {ready.length ? <div class="btns">{ready.map(f => { const yrs = viewMemo(`beaconTrip:${f.id}:${p.id}`, g, () => A.beaconTrip(f, p.id)); return <button class="small primary" disabled={yrs === null} title={yrs === null ? `${f.name} ne peut pas s'y rendre (carburant, ou territoire fermé)` : undefined} onClick={() => A.sendBeacon(f, p.id)}>Envoyer {f.name}{yrs === null ? <small> · hors de portée</small> : yrs > 0 ? <small> · {yrs} a</small> : <small> · sur place</small>}</button>; })}</div>
      : <p class="small">{kits.length ? 'Aucun de vos porte-balises ne peut s\'y rendre pour l\'instant.' : 'Aucun vaisseau avec un kit de balise : construisez un Porte-balise (ou ajoutez le kit à un modèle dans Conception).'}</p>}
  </section>;
}

/** A beacon of yours: a fort that never moves. */
export function BeaconPanel({ g, me, f }: { g: GameState; me: Player; f: Fleet }) {
  const s = useStore();
  const pl = g.planets[f.beaconOf!];
  const sp = specOf(g, f.tokens[0].designId);
  const dmg = f.tokens[0].damage * f.tokens[0].qtyDamaged;
  return <div class="insp-body">
    <header class="insp-head"><div class="eyebrow">Balise de souveraineté</div><div class="insp-title"><h2>{f.name}</h2></div>
      <div class="insp-sub">En orbite de <button class="lnk" onClick={() => s.select({ kind: 'planet', id: pl.id })}>{pl.name}</button></div></header>
    <section class="blk">
      <p class="small">Ce fort immobile revendique {pl.name} et {BEACON_RADIUS} al autour. Tant qu'il tient, aucun autre empire ne peut y fonder de colonie ; il se défend contre les flottes ennemies qui s'arrêtent ici. Quand vous colonisez {pl.name}, il devient sa station orbitale.</p>
      <Row k="Blindage / boucliers" v={`${fmt(sp.armor)} / ${fmt(sp.shields)} dp`} />
      {dmg > 0 && <Row k="Dégâts" v={<span class="red">{fmt(dmg)} dp</span>} />}
      <Row k="Puissance" v={sp.hasWeapons ? fmt(sp.powerRating) : 'désarmé'} />
      <Row k="Plan de bataille" v={<select value={f.battlePlan} onChange={e => { s.checkpoint(); f.battlePlan = +(e.target as HTMLSelectElement).value; s.bump(); }}>{me.battlePlans.map(b => <option value={b.id}>{b.name}</option>)}</select>} />
      <div class="btns"><button class="small danger" onClick={() => s.ask(`Démanteler ${f.name} ? La revendication de ${pl.name} prend fin.`, () => A.dismantleBeacon(f), 'Démanteler')}>Démanteler</button></div>
    </section>
  </div>;
}

export { territoryOwner, type CultureBuildingId };
