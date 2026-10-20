// "Send a scout / an ark / a miner" and "build and send" controls, shared by the selection panel and the planners.
import { viewFleet } from './memo';
import { reachable } from '../engine/secrets';
import { useState } from 'preact/hooks';
import { colonyBlocker, miningBlocker } from '../engine/culture';
import type { ComponentChildren } from 'preact';
import { store, useStore } from './store';
import type { Fleet, GameState, Planet, Player } from '../engine/types';
import { sendOptions, sendFleet, buildOptions, queueMission, missionStatus, missionDesigns, canMineHere, capitalOf, planHaul, haulCycleYears, miningYield, type MissionKind, type MissionStatus, type SendOption, type BuildOption, type MissionOpts } from '../engine/missions';
import { fleetSpec, distance } from '../engine/fleet';
import { fmt, fmtPop } from './store';
import { warnSlowLegs } from './actions';
import { theGuardian } from '../engine/guardians';

export interface MissionModel {
  kind: MissionKind;
  st: MissionStatus;
  send: SendOption[];
  build: BuildOption[];
  designs: ReturnType<typeof missionDesigns>;
  busy: boolean;
  opts: MissionOpts;
}

const WORDS: Record<MissionKind, { a: string; one: string; verb: string; none: string; noneHint: string }> = {
  colonize: { a: 'une arche', one: 'Arche', verb: 'coloniser', none: 'Aucune arche disponible', noneHint: 'colonisateur' },
  explore: { a: 'un éclaireur', one: 'Éclaireur', verb: 'explorer', none: 'Aucun éclaireur disponible', noneHint: 'éclaireur' },
  mine: { a: 'un vaisseau de minage', one: 'Vaisseau de minage', verb: 'forer', none: 'Aucun vaisseau de minage', noneHint: 'vaisseau de minage (robots foreurs)' },
  haul: { a: 'une navette', one: 'Navette', verb: 'faire la navette depuis', none: 'Aucun cargo disponible', noneHint: 'cargo (une soute, sans module de colonisation)' },
  logistics: { a: 'un cargo du réseau', one: 'Cargo', verb: 'servir le réseau logistique', none: 'Aucun cargo disponible', noneHint: 'cargo (une soute, sans module de colonisation)' },
};

export function missionModel(g: GameState, me: Player, p: Planet, kind: MissionKind, designId?: number | null, withBuild = true, buildAlways = false, opts: MissionOpts = {}): MissionModel {
  const st = missionStatus(g, me, p.id);
  const send = sendOptions(g, me, p.id, kind, opts);
  const designs = missionDesigns(g, me, kind);
  const design = designs.find(d => d.id === designId) ?? designs[0];
  // shipyards only matter when no ready fleet can go in good time (or in the Options panel)
  const build = withBuild && design && (buildAlways || !send.length || send[0].slow) ? buildOptions(g, me, p.id, kind, design) : [];
  const queued = st.queued.some(q => q.kind === kind);
  const busy = kind === 'colonize' ? st.arks.length > 0 || queued : kind === 'mine' ? st.miners.length > 0 || st.mining.length > 0 || queued : kind === 'haul' ? st.haulers.length > 0 || queued : st.scouts.length > 0 || queued;
  return { kind, st, send, build, designs, busy, opts };
}

const homeName = (g: GameState, me: Player, opts: MissionOpts) => (opts.homeId !== undefined ? g.planets[opts.homeId] : capitalOf(g, me))?.name ?? '?';

/** The refuelling stop of a mission planned through a station. */
const wpStop = (g: GameState, f: Fleet) => { const w = f.waypoints[1]; return w?.targetId !== undefined ? g.planets[w.targetId]?.name ?? '?' : '?'; };

/** A crawling trip: say so before committing (the button is already striped red). */
export function slowWarning(what: string, years: number, warp: number, go: () => void) {
  store.open('warn', {
    title: 'Trajet très lent',
    message: `${what} mettrait ${years} an${years > 1 ? 's' : ''} à arriver${warp ? `, à Warp ${warp}` : ''} : son carburant ne permet pas d'aller plus vite. Pour gagner du temps : un chantier plus proche (Options), un modèle avec plus de réservoirs ou un meilleur moteur, ou une escale de ravitaillement.`,
    actions: [{ label: 'Annuler', run: () => {} }, { label: 'Y aller quand même', primary: true, run: go }],
  });
}

export function doSend(g: GameState, f: Fleet, p: Planet, kind: MissionKind, opts: MissionOpts = {}): boolean {
  const s = store;
  s.checkpoint();
  // 3.6: the colonists an ark will take on board, when it leaves from one of our worlds
  const here = f.orbiting >= 0 ? g.planets[f.orbiting] : undefined;
  const drain = kind === 'colonize' && here && here.owner === f.owner && f.cargo.colonists === 0 && here.pop > 0
    ? Math.max(0, Math.min(viewFleet(g, f).cargoCapacity - f.cargo.ironium - f.cargo.boranium - f.cargo.germanium, Math.floor(here.pop / 100) - 1)) * 100 : 0;
  const ok = sendFleet(g, f, p.id, kind, opts);
  if (ok && here && drain > here.pop * 0.05) s.notify(`${f.name} part coloniser ${p.name} en emportant ${fmtPop(drain)} colons de ${here.name}, soit ${Math.round(drain / here.pop * 100)} % de sa population.`);
  else if (ok && kind !== 'haul' && f.waypoints.length > 2) s.notify(`${f.name} part ${WORDS[kind].verb} ${p.name}, avec une escale pour faire le plein à ${wpStop(g, f)}`);
  else if (ok) s.notify(kind === 'haul' ? `${f.name} fera la navette entre ${p.name} et ${homeName(g, s.me!, opts)}` : `${f.name} part ${WORDS[kind].verb} ${p.name}`);
  else { s.undo.pop(); s.notify(kind === 'haul' ? 'Carburant insuffisant pour ces allers-retours' : 'Carburant insuffisant pour ce trajet'); }
  s.bump();
  if (ok) warnSlowLegs(f, [1]);
  return ok;
}

export function doBuild(g: GameState, o: BuildOption, p: Planet, kind: MissionKind, opts: MissionOpts = {}) {
  const s = store;
  s.checkpoint();
  queueMission(g, o.planet, o.design, { kind, planetId: p.id, homeId: opts.homeId });
  s.notify(`Construction ajoutée en tête de la file de ${o.planet.name} (${o.design.name}) : départ dans ≈ ${o.buildYears} an${o.buildYears > 1 ? 's' : ''}`);
  s.bump();
  if (!o.reachable) s.open('warn', { title: 'Destination hors de portée', message: `Avec son carburant, ${o.design.name} ne pourra pas atteindre ${p.name} depuis ${o.planet.name} sans tomber en panne sèche : il restera à quai une fois construit, en attente d'ordres.`, actions: [{ label: 'Annuler la construction', run: () => s.undoLast() }, { label: 'Construire quand même', primary: true, run: () => {} }] });
}

/** Status lines: what is already on its way, at work, or being built for this planet. */
export function MissionStatusLines({ g, m, compact }: { g: GameState; m: MissionModel; compact?: boolean }) {
  const s = store;
  const fleetLink = (f: Fleet) => compact ? <b>{f.name}</b> : <button class="lnk" onClick={() => s.select({ kind: 'fleet', id: f.id })}>{f.name}</button>;
  return <>
    {m.kind === 'colonize' && m.st.arks.map(a => <div class="status">Arche en route : {fleetLink(a.fleet)} · arrivée en {g.year + a.arrival}</div>)}
    {m.kind === 'explore' && m.st.scouts.map(a => <div class="status">Déjà en route : {fleetLink(a.fleet)} · arrivée en {g.year + a.arrival}</div>)}
    {m.kind === 'mine' && m.st.mining.map(f => <div class="status">En train de forer : {fleetLink(f)}</div>)}
    {m.kind === 'mine' && m.st.miners.map(a => <div class="status">Foreuse en route : {fleetLink(a.fleet)} · arrivée en {g.year + a.arrival}</div>)}
    {m.st.queued.filter(q => q.kind === m.kind).map(q => <div class="status">{WORDS[m.kind].one} en construction à {compact ? <b>{q.planet.name}</b> : <button class="lnk" onClick={() => { s.select({ kind: 'planet', id: q.planet.id }); s.center(q.planet.x, q.planet.y); }}>{q.planet.name}</button>}</div>)}
  </>;
}

/** A guarded world (Constellations 3.2): the ship will be attacked on arrival. */
function guardedWarning(g: GameState, p: Planet, go: () => void) {
  const k = store.me?.intel.planets[p.id]?.guardian;
  store.open('warn', {
    title: 'Monde gardé',
    message: `${p.name} est gardée par ${theGuardian(k)}. Tout vaisseau qui s'y arrête est attaqué ; un vaisseau isolé ne survivra probablement pas. Il faut d'abord détruire le gardien.`,
    actions: [{ label: 'Annuler', run: () => {} }, { label: 'Y aller quand même', primary: true, run: go }],
  });
}

/** Main button: send the best ready fleet, otherwise build one at the best shipyard. */
export function MissionButton({ g, p, m, short, label }: { g: GameState; p: Planet; m: MissionModel; short?: boolean; /** replaces the main text (build: a ship must be built first) */ label?: (build: boolean) => ComponentChildren }) {
  const w = WORDS[m.kind];
  const word = short ? '' : ' ' + w.a;
  const haul = m.kind === 'haul';
  const guarded = !!store.me?.intel.planets[p.id]?.guardian && m.kind !== 'haul';
  // Constellations 3.3: no colony in another empire's territory
  const terr = m.kind === 'colonize' && store.me ? colonyBlocker(g, store.me, p, true) : null;
  const fb = m.kind === 'mine' && store.me ? miningBlocker(g, store.me, p, true) : null;
  if (fb !== null) return <button class="primary mbtn" disabled title={`${p.name} est dans le territoire de vos amis les ${g.players[fb].name} : le forage n'y est permis qu'aux empires neutres ou en guerre avec eux.`}>Territoire ami<small>des {g.players[fb].name}</small></button>;
  if (terr !== null) return <button class="primary mbtn" disabled title={`${p.name} est dans le territoire des ${g.players[terr].name} : on ne peut pas y fonder de colonie.`}>Territoire étranger<small>des {g.players[terr].name}</small></button>;
  if (guarded && (m.send[0] || m.build[0])) {
    const o = m.send[0], b = m.build[0];
    return <button class="primary mbtn slow" disabled={!o && m.busy} onClick={() => guardedWarning(g, p, () => o ? doSend(g, o.fleet, p, m.kind, m.opts) : doBuild(g, b!, p, m.kind, m.opts))} title="Un gardien veille sur ce monde">{label ? label(!o) : o ? <>Envoyer{word}</> : <>Construire et envoyer{word}</>}<small>monde gardé !</small></button>;
  }
  // 0.3.8: the only ready ship would crawl there for decades: building one at a shipyard nearby is sooner
  const quick = m.build.find(o => o.reachable && !o.slow);
  const sd = m.send[0] && !(m.send[0].slow && quick && !m.busy && quick.total < m.send[0].years) ? m.send[0] : undefined;
  if (sd) return <button class={'primary mbtn' + (sd.slow ? ' slow' : '')} onClick={() => sd.slow ? slowWarning(sd.fleet.name, sd.years, sd.warp, () => doSend(g, sd.fleet, p, m.kind, m.opts)) : doSend(g, sd.fleet, p, m.kind, m.opts)} title={sd.slow ? `Trajet très lent : ${sd.fleet.name} est à ${fmt(distance(sd.fleet, p), 0)} al de ${p.name} et n'a pas assez de carburant pour y aller plus vite : ${sd.years} ans à Warp ${sd.warp}. « Options » pour un autre vaisseau, ou pour en construire un plus près.` : `${sd.fleet.name}, à ${fmt(distance(sd.fleet, p), 0)} al · Warp ${sd.warp}`}>{label ? label(false) : haul ? 'Créer la navette' : <>Envoyer{word}</>}<small>{sd.fleet.name} · {haul ? `1er chargement dans ${sd.years} a` : `${sd.years} a`}{sd.warp <= 1 ? ' · Warp 1 !' : sd.slow ? ` · Warp ${sd.warp} !` : ''}</small></button>;
  const b = m.build[0] && m.build[0].reachable && !m.build[0].slow ? m.build[0] : quick ?? m.build[0];
  if (b) return <button class={'primary mbtn' + (b.slow || !b.reachable ? ' slow' : '')} disabled={m.busy} onClick={() => b.slow && !m.busy ? slowWarning(`${b.design.name}, construit à ${b.planet.name},`, b.travelYears, b.warp, () => doBuild(g, b, p, m.kind, m.opts)) : doBuild(g, b, p, m.kind, m.opts)} title={m.busy ? 'Déjà prévu. « Options » permet d\'en ajouter un autre.' : b.slow ? `Trajet très lent : ${b.travelYears} ans à Warp ${b.warp}, faute de carburant. « Options » pour un autre chantier ou modèle.` : !b.reachable ? 'Hors de portée avec son carburant' : `${b.design.name} construit à ${b.planet.name}`}>{label ? label(true) : haul ? 'Construire un cargo pour la navette' : <>Construire et envoyer{word}</>}<small>{label ? 'à construire · ' : ''}{b.planet.name} · ≈ {b.buildYears} + {b.travelYears} a{b.slow ? ` · Warp ${b.warp} !` : !b.reachable ? ' · hors de portée' : ''}</small></button>;
  return <button class="primary mbtn" disabled title={m.designs.length ? 'Aucune planète ne peut le construire : il faut une station avec chantier.' : `Aucun modèle de ${w.noneHint} : créez-en un dans Conception.`}>{w.none}</button>;
}

/** The "Options" panel: choose another fleet, design or shipyard. */
export function MissionOptions({ g, me, p, kind, onDone, opts = {} }: { g: GameState; me: Player; p: Planet; kind: MissionKind; onDone?: () => void; opts?: MissionOpts }) {
  const [designId, setDesignId] = useState<number | null>(null);
  const m = missionModel(g, me, p, kind, designId, true, true, opts);
  const design = m.designs.find(d => d.id === designId) ?? m.designs[0];
  return <div class="mission-opts">
    {m.send.length > 0 && <><div class="opt-title">Envoyer une flotte prête</div>
      <ul>{m.send.slice(0, 8).map(o => <li><span>{o.fleet.name}</span><span class={o.slow || o.warp <= 1 ? 'red small' : 'muted small'}>{o.years} a · W{o.warp}{o.slow ? ' · très lent' : ''}</span><button class={'small' + (o.slow ? ' slow' : '')} onClick={() => { const go = () => { if (doSend(g, o.fleet, p, kind, opts)) onDone?.(); }; if (o.slow) slowWarning(o.fleet.name, o.years, o.warp, go); else go(); }}>{kind === 'haul' ? 'Affecter' : 'Envoyer'}</button></li>)}</ul></>}
    <div class="opt-title">Construire puis envoyer</div>
    {m.designs.length > 1 && <select value={design?.id} onChange={e => setDesignId(+(e.target as HTMLSelectElement).value)} aria-label="Modèle">{m.designs.map(d => <option value={d.id}>{d.name}</option>)}</select>}
    {m.build.length === 0 ? <div class="muted small">Aucun chantier disponible.</div> : <ul>{m.build.slice(0, 8).map(o => <li><span>{o.planet.name}</span><span class={o.reachable && !o.slow ? 'muted small' : 'red small'}>≈ {o.buildYears} + {o.travelYears} a{!o.reachable ? ' · hors de portée' : o.slow ? ` · W${o.warp}, très lent` : ''}</span><button class={'small' + (o.slow || !o.reachable ? ' slow' : '')} onClick={() => { const go = () => { doBuild(g, o, p, kind, opts); onDone?.(); }; if (o.slow) slowWarning(`${o.design.name}, construit à ${o.planet.name},`, o.travelYears, o.warp, go); else go(); }}>Construire</button></li>)}</ul>}
    <p class="small muted">{kind === 'colonize' ? 'Une arche vide en orbite de l\'un de vos mondes embarque ses colons au départ. ' : kind === 'mine' ? 'Le vaisseau fore chaque année et dépose les minerais à la surface de la planète ; une navette (un cargo en allers-retours) vient les chercher. ' : kind === 'haul' ? 'Le cargo charge tous les minerais de la planète, les livre au port choisi, et recommence (itinéraire répété). ' : ''}La construction passe avant les éléments automatiques de la file ; le vaisseau part seul dès qu'il est terminé.</p>
  </div>;
}

function MissionRow({ g, me, p, kind, title }: { g: GameState; me: Player; p: Planet; kind: MissionKind; title?: string }) {
  const [opts, setOpts] = useState(false);
  const m = missionModel(g, me, p, kind);
  return <div class="mission-row">
    {title && <div class="opt-title">{title}</div>}
    <MissionStatusLines g={g} m={m} />
    <div class="mission-btns">
      <MissionButton g={g} p={p} m={m} />
      <button class="ghost" onClick={() => setOpts(!opts)} aria-expanded={opts}>Options {opts ? '▴' : '▾'}</button>
    </div>
    {opts && <MissionOptions g={g} me={me} p={p} kind={kind} onDone={() => setOpts(false)} />}
  </div>;
}

/** Change the home port of an existing shuttle. */
export function changeHaulHome(g: GameState, f: Fleet, p: Planet, homeId: number) {
  const s = store;
  s.checkpoint();
  if (planHaul(g, f, p.id, homeId)) s.notify(`${f.name} livrera désormais ${g.planets[homeId].name}`);
  else { s.undo.pop(); s.notify(`${f.name} n'a pas assez de carburant pour faire la navette avec ${g.planets[homeId].name}`); }
  s.bump();
}

/**
 * Mineral shuttle for a remote-mined planet: a freighter that loads everything on the surface and delivers it
 * to a home port (the capital by default), over and over. Lists the shuttles in service, lets the player change
 * their port, assign a ready freighter, or have one built.
 */
export function HaulBlock({ g, me, p, compact, onDone }: { g: GameState; me: Player; p: Planet; compact?: boolean; onDone?: () => void }) {
  const s = store;
  const [homeSel, setHomeSel] = useState<number | null>(null);
  const [opts, setOpts] = useState(false);
  const cap = capitalOf(g, me);
  const ports = g.planets.filter(x => x.owner === me.id && x.id !== p.id).sort((a, b) => distance(a, p) - distance(b, p));
  const homeId = homeSel ?? cap?.id;
  const mo: MissionOpts = { homeId };
  const m = missionModel(g, me, p, 'haul', null, true, false, mo);
  const intel = me.intel.planets[p.id];
  const yearly = intel.conc ? m.st.mining.reduce((t, f) => { const y = miningYield(intel.conc!, viewFleet(g, f).miningRate); return t + y.ironium + y.boranium + y.germanium; }, 0) : 0;
  const flow = m.st.haulers.reduce((t, h) => { const cy = haulCycleYears(g, h.fleet, p.id, h.home.id); return t + (Number.isFinite(cy) && cy > 0 ? viewFleet(g, h.fleet).cargoCapacity / cy : 0); }, 0);
  const portSelect = (value: number | undefined, onChange: (id: number) => void, label: string) => <select value={value} aria-label={label} onChange={e => onChange(+(e.target as HTMLSelectElement).value)} onClick={e => e.stopPropagation()}>
    {ports.map(pt => <option value={pt.id}>{pt.name}{pt.id === cap?.id ? ' (capitale)' : ''} · {fmt(distance(pt, p), 0)} al</option>)}
  </select>;
  return <div class={'mission-row haul' + (compact ? ' compact' : '')}>
    <div class="opt-title">Navette de minerais</div>
    {m.st.haulers.map(h => <div class="status">{compact ? <b>{h.fleet.name}</b> : <button class="lnk" onClick={() => s.select({ kind: 'fleet', id: h.fleet.id })}>{h.fleet.name}</button>} ⇄ {portSelect(h.home.id, id => changeHaulHome(g, h.fleet, p, id), `Port de ${h.fleet.name}`)} <span class="muted small">soute {fmt(viewFleet(g, h.fleet).cargoCapacity)} kt · aller-retour ≈ {haulCycleYears(g, h.fleet, p.id, h.home.id)} a</span></div>)}
    {m.st.queued.filter(q => q.kind === 'haul').map(q => <div class="status">Cargo en construction à <b>{q.planet.name}</b>, pour {g.planets[q.homeId ?? cap?.id ?? q.planet.id]?.name}</div>)}
    {(yearly > 0 || flow > 0) && <div class={'small ' + (flow > 0 && flow < yearly ? 'yellow' : 'muted')}>Extraction ≈ {fmt(yearly)} kt/an{flow > 0 ? ` · navettes ≈ ${fmt(flow)} kt/an${flow < yearly ? ' : insuffisant, les minerais s\'accumulent' : ''}` : ''}{intel.surface ? ` · en surface ${fmt(intel.surface.ironium + intel.surface.boranium + intel.surface.germanium)} kt` : ''}</div>}
    {ports.length > 0 && <label class="haul-port">{m.st.haulers.length ? 'Nouvelle navette, livrée à' : 'Livrer à'} {portSelect(homeId, setHomeSel, 'Port de livraison')}</label>}
    <div class="mission-btns">
      <MissionButton g={g} p={p} m={m} />
      <button class="ghost" onClick={() => setOpts(!opts)} aria-expanded={opts}>Options {opts ? '▴' : '▾'}</button>
    </div>
    {opts && <MissionOptions g={g} me={me} p={p} kind="haul" opts={mo} onDone={() => { setOpts(false); onDone?.(); }} />}
  </div>;
}

/** Block of the selection panel for a planet that is not ours (or ours, for remote mining by orbital races). */
export function MissionBlock({ g, me, p, known, val }: { g: GameState; me: Player; p: Planet; known: boolean; val: number | null }) {
  useStore();
  // 0.3.7: a hidden star out of the ordinary routes (the veiled star without its way in, the hidden cluster)
  if (p.hidden && !reachable(g, me, p)) return <section class="blk mission"><p class="small muted">{p.hidden === 'pocket'
    ? 'On n\'y va que par le trou de ver de l\'amas : sélectionnez une flotte, puis Maj+clic sur ce monde ; l\'étape du trou de ver s\'ajoute d\'elle-même.'
    : 'Aucune route connue n\'y mène encore : il faut d\'abord trouver le passage.'}</p></section>;
  if (!known) return <section class="blk mission" data-tut="mission"><MissionRow g={g} me={me} p={p} kind="explore" /></section>;
  const free = (me.intel.planets[p.id].owner ?? -1) < 0;
  const mine = canMineHere(g, me, p.id);
  const arkStatus = missionStatus(g, me, p.id);
  const colonizable = free && (val === null || val > 0 || arkStatus.arks.length > 0);
  if (!colonizable && !mine) return null;
  return <section class="blk mission" data-tut="mission">
    {free && !colonizable && <p class="small muted">Monde hostile pour votre race : colonisation déconseillée{val !== null && val < 0 ? ', la population y mourrait' : ''}.</p>}
    {colonizable && <MissionRow g={g} me={me} p={p} kind="colonize" title={mine ? 'Colonisation' : undefined} />}
    {mine && <MissionRow g={g} me={me} p={p} kind="mine" title="Minage à distance" />}
    {mine && (arkStatus.mining.length > 0 || arkStatus.miners.length > 0 || arkStatus.haulers.length > 0) && <HaulBlock g={g} me={me} p={p} />}
  </section>;
}
