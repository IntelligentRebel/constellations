// Constellations 3.4: what the player sees of the pirates (Empire page, planet panel, foreign fleets).
import { LairReport } from './discoveries';
import { useStore, fmt } from './store';
import type { GameState, Planet, Player } from '../engine/types';
import { distance, fleetSpec } from '../engine/fleet';
import { capitalOf } from '../engine/empire';
import { BOUNTY_UNIT, bountyBlocker, deBand, etaYears, lairAt, lairFleet, liveLairs, piratesActive, raidsAgainst, raidRange } from '../engine/pirates';
import { fleetStrength } from '../engine/factions';
import { nexusFleet, nexusStrength, navyStrength, waves, STRIKE } from '../engine/crisis';
import * as A from './actions';

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** Where the bounties are paid: the capital, else the most productive world. */
function payer(g: GameState, me: Player): Planet | null {
  return capitalOf(g, me) ?? g.planets.filter(p => p.owner === me.id).sort((a, b) => b.pop - a.pop)[0] ?? null;
}

export function PiratesSection({ g, me }: { g: GameState; me: Player }) {
  const s = useStore();
  const P = g.pirates;
  if (!P || !P.emerged) return <p class="small muted">Aucun pirate n'est signalé pour l'instant. Des bandes s'installent en général une quinzaine d'années après le début de la partie, dans des repaires loin des capitales.</p>;
  const mine = g.planets.filter(p => p.owner === me.id);
  const near = (pl: Planet) => mine.length ? Math.min(...mine.map(m => distance(m, pl))) : Infinity;
  if (P.ended || !piratesActive(g)) {
    return <div class="small">
      <p>Les pirates ont été éliminés{P.lairs.length ? ` (dernier repaire tombé en ${Math.max(...P.lairs.map(l => l.killedYear ?? 0))})` : ''}.</p>
      <ul class="emp-obj">{P.lairs.map(l => <li class="done">{cap(l.name)} à <button class="lnk" onClick={() => s.focus({ kind: 'planet', id: l.planetId }, g.planets[l.planetId])}>{g.planets[l.planetId].name}</button> : détruit en {l.killedYear}{l.killedBy !== undefined ? ` par les ${g.players[l.killedBy].name}` : ''}</li>)}</ul>
    </div>;
  }
  const raids = raidsAgainst(g, me.id);
  const log = (P.log ?? []).filter(e => e.empire === me.id).slice(-5).reverse();
  const others = g.players.filter(p => p.id !== me.id && !p.monster && !p.dead && me.intel.met.includes(p.id));
  const pay = payer(g, me);
  const placed = P.placed?.[me.id] ?? {};
  const add = (target: number, units: number) => {
    if (!pay) return;
    A.queueAdd(pay.id, 'bounty', undefined, units, 0, undefined, undefined, target);
    s.notify(`Prime de ${units * BOUNTY_UNIT} R contre les ${g.players[target].name} mise en tête de la file de ${pay.name}.`);
  };
  const soon = P.nextRaid - g.year;
  return <div>
    <p class="small muted">Tous les quelques années, un repaire lance un raid sur une colonie riche et mal défendue à moins de {Math.round(raidRange(g))} al. Une flotte armée en orbite ou une station armée l'arrête ; les défenses planétaires réduisent le pillage. Détruire un repaire rapporte de la recherche et son butin ; les pirates disparaissent avec leur dernier repaire.</p>
    {raids.map(f => {
      const t = g.planets[f.raid!.target];
      return <div class="alert strong">Raid en route vers <button class="lnk" onClick={() => s.focus({ kind: 'planet', id: t.id }, t)}>{t.name}</button> : {f.tokens.reduce((a, x) => a + x.qty, 0)} vaisseau(x), arrivée vers {g.year + (f.raid!.phase === 'siege' ? 0 : etaYears(g, f, t))}{f.raid!.phase === 'siege' ? ' (déjà sur place)' : ''}.</div>;
    })}
    <table class="report compact"><thead><tr><th>Repaire</th><th>Planète</th><th class="num">Garnison</th><th class="num">De vos colonies</th></tr></thead>
      <tbody>{liveLairs(g).map(l => {
        const pl = g.planets[l.planetId];
        const fi = me.intel.fleets.find(x => x.id === l.fleetId);
        const n = fi?.count ?? fi?.tokens?.reduce((a, t) => a + t.qty, 0);
        return <tr class="go" title="Voir sur la carte" onClick={() => s.focus({ kind: 'planet', id: pl.id }, pl)}><td>{cap(l.name)}</td><td>{pl.name}</td><td class="num">{n !== undefined ? `${n} vaisseau${n > 1 ? 'x' : ''}` : 'hors de vue'}</td><td class="num">{Number.isFinite(near(pl)) ? `${fmt(near(pl))} al` : '–'}</td></tr>;
      })}</tbody></table>
    <p class="small">{soon <= 1 ? 'Les pirates préparent un raid (cible encore inconnue) : il partira cette année ou la suivante.' : `Prochain raid pirate attendu d'ici ${soon} ans environ (cible encore inconnue).`} {P.raids} raid{P.raids > 1 ? 's' : ''} lancé{P.raids > 1 ? 's' : ''} contre l'ensemble des empires depuis leur arrivée.</p>
    {log.length > 0 && <><div class="small muted">Vos colonies pillées :</div>
      <ul class="emp-obj">{log.map(e => <li class="failed"><button class="lnk" onClick={() => s.focus({ kind: 'planet', id: e.planet }, g.planets[e.planet])}>{g.planets[e.planet].name}</button> en {e.year} : {fmt(e.loot)} kt de minerais emportés</li>)}</ul></>}
    <h4 class="emp-sub">Primes</h4>
    <p class="small muted">Une prime ({BOUNTY_UNIT} R l'unité, payée par la production de {pay?.name ?? 'votre capitale'}) pousse les pirates à viser un empire : chaque raid lancé contre lui en consomme jusqu'à 400 R et frappe plus fort, et le raid suivant part plus tôt. Les montants sur chaque tête sont publics, les payeurs ne le sont pas.</p>
    {(P.bounty[me.id] ?? 0) > 0 && <div class="alert">Quelqu'un a payé les pirates pour vous viser : {fmt(P.bounty[me.id])} R sur votre tête.</div>}
    {others.length > 0 ? <table class="report compact"><thead><tr><th>Empire</th><th class="num">Sur sa tête</th><th class="num">Vos versements</th><th></th></tr></thead>
      <tbody>{others.map(p => {
        const why = bountyBlocker(g, me, p.id);
        return <tr><td style={{ color: p.color }}>{p.name}</td><td class="num">{fmt(P.bounty[p.id] ?? 0)} R</td><td class="num">{fmt(placed[p.id] ?? 0)} R</td>
          <td>{why || !pay ? <span class="small muted">{why ?? 'aucune planète'}</span> : <span class="row-btns"><button class="small" onClick={() => add(p.id, 1)}>+{BOUNTY_UNIT} R</button> <button class="small" onClick={() => add(p.id, 5)}>+{5 * BOUNTY_UNIT} R</button></span>}</td></tr>;
      })}</tbody></table> : <p class="small muted">Aucun autre empire rencontré : personne à désigner.</p>}
  </div>;
}

/** The lair of a planet, in the right panel. */
export function LairBlock({ g, me, p }: { g: GameState; me: Player; p: Planet }) {
  const s = useStore();
  if (me.intel.planets[p.id]?.lair !== 'pirates') return null;
  const l = lairAt(g, p.id);
  if (!l) return null;
  const f = lairFleet(g, l);
  const fi = f ? me.intel.fleets.find(x => x.id === f.id) : undefined;
  const c = s.commanded?.kind === 'fleet' ? g.fleets.find(x => x.id === s.commanded!.id && x.owner === me.id) : undefined;
  const ratio = c && f && fi ? fleetStrength(g, c) / Math.max(1, fleetStrength(g, f)) : 0;
  return <section class="blk guardian lair">
    <div class="blk-head"><h3>☠ Repaire {deBand(l.name)}</h3>{fi?.tokens && <span class="tag">{fi.tokens.reduce((a, t) => a + t.qty, 0)} vaisseaux</span>}</div>
    <p class="small">Le repaire de pirates ne se déplace jamais. Sa garnison attaque toute flotte qui s'arrête ici et grossit avec le butin. Le détruire rapporte de la recherche, le trésor de la bande (laissé à la surface) et parfois une relique.</p>
    {c && fi && <div class={'small ' + (ratio >= 2.5 ? 'green' : ratio >= 1 ? 'yellow' : 'red')}>Rapport de force estimé avec {c.name} : {ratio >= 10 ? '×10 et plus' : `×${ratio.toFixed(ratio < 1 ? 2 : 1)}`} {ratio < 1 ? '(perdu d\'avance)' : ratio < 2.5 ? '(risqué)' : '(favorable)'}</div>}
    {!fi && <p class="small muted">La garnison est hors de portée de vos scanners.</p>}
    <LairReport g={g} me={me} planetId={p.id} brief />
  </section>;
}

/** What a foreign fleet of the pirates is doing, as far as the player knows. */
export function raidNote(g: GameState, me: Player, fleetId: number): string | null {
  const f = g.fleets.find(x => x.id === fleetId);
  if (f && g.players[f.owner]?.faction === 'crisis') {
    if (f.immobile) return 'Le Nexus : ne se déplace jamais, répare 30 % de ses dégâts par an. L\'abattre referme la Brèche.';
    return f.raid ? `Vague de Moissonneurs : elle ravage les mondes des ${g.players[f.raid.empire]?.name ?? '?'}${f.raid.empire === me.id ? ` (cible : ${g.planets[f.raid.target].name})` : ''}.` : null;
  }
  if (!f || g.players[f.owner]?.faction !== 'pirates') return null;
  if (f.immobile) return 'Repaire de pirates : ne se déplace jamais.';
  const r = f.raid;
  if (!r) return null;
  if (r.phase === 'home') return `Raid pirate qui rentre au repaire${r.loot + f.cargo.ironium + f.cargo.boranium + f.cargo.germanium > 0 ? ' avec son butin (le détruire en route en laisse une partie)' : ''}.`;
  if (r.empire === me.id) return `Raid pirate : selon vos informateurs, il vise ${g.planets[r.target].name}.`;
  return 'Raid pirate en route vers un autre empire.';
}

/** The Breach of the crisis, in the right panel (Constellations 3.4). */
export function BreachBlock({ g, me, p }: { g: GameState; me: Player; p: Planet }) {
  const s = useStore();
  const C = g.crisis;
  if (!C || C.planetId !== p.id || C.phase === 'ended') return null;
  const nx = nexusFleet(g);
  const fi = nx ? me.intel.fleets.find(x => x.id === nx.id) : undefined;
  const c = s.commanded?.kind === 'fleet' ? g.fleets.find(x => x.id === s.commanded!.id && x.owner === me.id) : undefined;
  const ratio = c && nx && fi ? fleetStrength(g, c) / Math.max(1, nexusStrength(g) * STRIKE) : 0;
  return <section class="blk guardian breach">
    <div class="blk-head"><h3>✹ {C.phase === 'omen' ? 'Le signal' : 'La Brèche et le Nexus'}</h3>{C.phase === 'omen' ? <span class="tag">ouverture vers {C.openYear}</span> : fi?.tokens && <span class="tag">{fi.tokens.reduce((a, t) => a + t.qty, 0)} vaisseaux</span>}</div>
    {C.phase === 'omen'
      ? <p class="small">Un signal qui ne vient d'aucune étoile. Une Brèche s'ouvrira ici vers {C.openYear}, gardée par une flotte plus forte que n'importe quelle marine de la galaxie. Préparez vos flottes et vos défenses.</p>
      : <p class="small">Le Nexus (vaisseaux de guerre et Remparts blindés) ne se déplace jamais et répare 30 % de ses dégâts chaque année : il faut le frapper fort et d'un coup. À moins de 80 al d'ici, les empires ne se combattent pas entre eux : rassemblez-vous à distance, puis frappez ensemble. L'empire qui l'abat (celui qui a le plus de vaisseaux sur place) remporte la partie ; tous ceux qui ont combattu gagnent de la recherche.</p>}
    {c && fi && <div class={'small ' + (ratio >= 1.5 ? 'green' : ratio >= 0.8 ? 'yellow' : 'red')}>Rapport de force estimé avec {c.name} : {ratio >= 10 ? '×10 et plus' : `×${ratio.toFixed(ratio < 1 ? 2 : 1)}`} {ratio < 0.8 ? '(perdu d\'avance seul)' : ratio < 1.5 ? '(risqué)' : '(favorable)'}</div>}
  </section>;
}

export function CrisisSection({ g, me }: { g: GameState; me: Player }) {
  const s = useStore();
  const C = g.crisis;
  if (!C || C.phase === 'dormant') return <p class="small muted">Rien à signaler. Vers la fin du siècle, une Brèche pourrait s'ouvrir loin des empires : ses gardiens, les Moissonneurs, ravagent les mondes des plus puissants. Les observatoires préviendront dix ans avant.</p>;
  const bp = C.planetId !== undefined ? g.planets[C.planetId] : undefined;
  const go = () => bp && s.focus({ kind: 'planet', id: bp.id }, bp);
  if (C.phase === 'ended') return <p class="small">{C.endedBy !== undefined ? `Le Nexus a été abattu en ${C.endedYear} par les ${g.players[C.endedBy].name}` : `La Brèche s'est refermée en ${C.endedYear}`} après {C.wave} vague{C.wave > 1 ? 's' : ''}. La galaxie respire.</p>;
  if (C.phase === 'omen') return <div class="small">
    <div class="alert">Un signal inconnu grandit près de <button class="lnk" onClick={go}>{bp?.name}</button> : la Brèche s'ouvrira vers <b>{C.openYear}</b>.</div>
    <p class="muted">Ce qui en sortira sera plus fort que n'importe quelle marine : rassemblez vos flottes près de la Brèche, armez les stations et les défenses des mondes qui en sont proches. L'empire qui abattra son gardien remportera la partie.</p>
  </div>;
  const mine = me.intel.fleets.filter(fi => g.players[fi.owner]?.faction === 'crisis' && fi.id !== C.nexusFleetId);
  const atMe = waves(g).filter(w => w.raid!.empire === me.id);
  const navy = navyStrength(g, me.id), nx = nexusStrength(g);
  // 0.3.9.21: the empires seen there (your scanners), not all those present
  const helperOwners = bp ? [...new Set([...g.fleets.filter(f => f.owner === me.id && f.x === bp.x && f.y === bp.y && f.tokens.length).map(f => f.owner), ...me.intel.fleets.filter(fi => fi.owner >= 0 && !g.players[fi.owner]?.monster && fi.x === bp.x && fi.y === bp.y).map(fi => fi.owner)])] : [];
  return <div class="small">
    <div class="alert strong">La Brèche est ouverte à <button class="lnk" onClick={go}>{bp?.name}</button> : {C.wave} vague{C.wave > 1 ? 's' : ''} déjà sortie{C.wave > 1 ? 's' : ''}, la prochaine vers {C.nextWave}</div>
    {atMe.map(w => { const t = g.planets[w.raid!.target]; const seen = me.intel.fleets.find(fi => fi.id === w.id); const n = seen ? seen.count ?? seen.tokens?.reduce((a, x) => a + x.qty, 0) : undefined; return <div class="alert">{w.name}{n !== undefined ? ` (${seen!.uncertain ? '≈ ' : ''}${n} vaisseaux)` : ''} fond sur <button class="lnk" onClick={() => s.focus({ kind: 'planet', id: t.id }, t)}>{t.name}</button>{!seen && w.raid!.eta !== undefined ? ` (arrivée annoncée vers ${w.raid!.eta})` : ''}</div>; })}
    <div class="emp-kpis">
      <div><small>Le Nexus</small><b>{nexusFleet(g)?.tokens.reduce((a, t) => a + t.qty, 0) ?? 0} vaisseaux</b><small>répare 30 % par an</small></div>
      <div><small>Votre marine entière</small><b class={navy >= nx * STRIKE ? 'green' : navy >= nx * STRIKE * 0.5 ? 'yellow' : 'red'}>{nx > 0 ? `${Math.round(Math.sqrt(navy / (nx * STRIKE)) * 100)} %` : '–'}</b><small>de ce qu'il faut pour l'abattre</small></div>
      <div><small>Vagues repérées</small><b>{mine.length}</b></div>
    </div>
    {helperOwners.length > 0 && <p>En ce moment à la Brèche, à votre connaissance : {helperOwners.map(o => g.players[o].name).join(', ')}.</p>}
    <p class="muted">Les vagues visent surtout l'empire en tête, sinon le plus proche de la Brèche, et passent de monde en monde en bombardant. À la Brèche, les empires ne se combattent pas entre eux : plusieurs flottes peuvent frapper ensemble. Celui qui a le plus de vaisseaux sur place quand le Nexus tombe remporte la partie.</p>
  </div>;
}

export { fleetSpec };
