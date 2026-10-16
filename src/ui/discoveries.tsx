// Discoveries (Constellations 3.2) in the interface: anomaly and guardian of a planet, the Empire page section
// (relics, map of the Ancients, choices waiting), and the notes of the map tooltip.
import type { GameState, Planet, Player } from '../engine/types';
import { store, useStore, fmt } from './store';
import { useSorted } from './components';
import { ANOMALIES, anomalyAt, currentRate, defOf, finished, fragmentsNeeded, knownAnomalies, pointsNeeded, studyBlocker, studyingFleets, vaultOf, anomaliesOn, decide } from '../engine/anomalies';
import { GUARDIAN_KINDS, guardianStrength, guardianAt, isMonster } from '../engine/guardians';
import { navyOf } from '../engine/guardians';
import { shareOf } from '../engine/words';
import type { Guardian, GuardianReport as Report } from '../engine/types';
import { lairAt } from '../engine/pirates';
import { LairBlock, BreachBlock } from './factions';
import { RELICS, type RelicId } from '../engine/relics';
import { ORIGIN } from '../engine/origins';
import { fleetSpec, distance } from '../engine/fleet';
import { sendOptions, sendFleet, buildOptions, queueMission } from '../engine/missions';
import { slowWarning } from './missionui';
import { SECRET_INFO, secretOfPlanet, probeFleets, sealFleets, PROBE_NEED, OPEN_NEED, SLING_RANGE } from '../engine/secrets';
import { PULSAR_SHIELD_RANGE } from '../engine/terrain';
import { studyRate } from '../engine/anomalies';
import type { Secret } from '../engine/types';

/** Lines of the map tooltip about a planet's anomaly and guardian. */
export function planetNotes(g: GameState, me: Player, planetId: number): string[] {
  const out: string[] = [];
  const gk = me.intel.planets[planetId]?.guardian;
  if (gk) { const k = GUARDIAN_KINDS[gk]; out.push(`⚠ Gardé : ${k?.name ?? 'gardien'} (palier ${k?.tier ?? '?'})`); }
  const lair = me.intel.planets[planetId]?.lair;
  if (lair === 'pirates') { const l = lairAt(g, planetId); out.push(`☠ Repaire pirate${l ? ` (${l.name})` : ''}`); }
  if (lair === 'crisis') out.push('✹ La Brèche des Moissonneurs');
  // 0.3.7: a hidden star
  const pl = g.planets[planetId];
  if (pl?.hidden && !me.intel.planets[planetId]?.unknown) out.push(`★ ${SECRET_INFO[pl.hidden].name}${pl.hidden === 'veiled' ? (secretOfPlanet(g, planetId)?.tunnel?.includes(me.id) ? ' · couloir connu, Warp 3 au plus' : ' · aucun passage connu') : pl.hidden === 'dwarf' ? ' · carburant en orbite' : ''}`);
  const a = anomalyAt(g, me, planetId);
  if (a) { const d = defOf(a); out.push(`${d.site ? 'Site archéologique' : 'Anomalie'} : ${d.name}${d.site ? ` (chapitre ${(a.chapter ?? 0) + 1}/${d.site.chapters})` : ` (difficulté ${a.level})`}`); }
  return out;
}

/** Strength of what you could send: the selected fleet, or all your warships. */
function yourStrength(g: GameState, me: Player): { label: string; v: number } | null {
  const c = store.commanded?.kind === 'fleet' ? g.fleets.find(f => f.id === store.commanded!.id && f.owner === me.id) : undefined;
  if (c) { const sp = fleetSpec(g, c); return { label: c.name, v: Math.max(1, sp.armor + sp.shields) * Math.max(1, sp.powerRating) }; }
  return null;
}

/** 0.3.9.7: the last measure of a guardian's strength by one of your crews, its date, and what it means today. */
export function GuardianReport({ g, me, guardian, brief }: { g: GameState; me: Player; guardian: Guardian; /** without the reminder of how a guardian fights */ brief?: boolean }) {
  const r = me.intel.guardianReports?.[guardian.id];
  if (!r) return <p class="small muted guard-report">Aucun relevé de sa force. Envoyez un vaisseau sur place : son équipage la mesurera face à votre flotte de guerre.</p>;
  return <StrengthReport g={g} me={me} r={r} note={brief ? undefined : 'Un gardien ne grandit pas, mais il répare 40 % de ses dégâts chaque année : il faut l\'abattre en une seule bataille.'} />;
}

/** 0.3.9.7: the same for the garrison of a pirate lair (which grows with the loot: an old measure falls short). */
export function LairReport({ g, me, planetId, brief }: { g: GameState; me: Player; planetId: number; brief?: boolean }) {
  const r = me.intel.lairReports?.[planetId];
  if (!r) return <p class="small muted guard-report">Aucun relevé de la garnison. Envoyez un vaisseau sur place : son équipage la mesurera face à votre flotte de guerre.</p>;
  return <StrengthReport g={g} me={me} r={r} ships={r.ships} note={brief ? 'La garnison grossit avec le butin : un relevé ancien la sous-estime.' : 'La garnison répare un quart de ses dégâts chaque année et grossit avec le butin : un relevé ancien la sous-estime.'} />;
}

function StrengthReport({ g, me, r, note, ships }: { g: GameState; me: Player; r: Report; note?: string; ships?: number }) {
  const age = g.year - r.year;
  const s = Math.max(1, r.strength);
  const now = navyOf(g, me.id);
  return <div class="guard-report">
    <div class={'small' + (age >= 5 ? ' stale' : '')}>{age === 0 ? `Relevé de cette année (${r.year}), par l'équipage de ${r.witness}.` : age === 1 ? `Relevé de ${r.year}, l'an dernier, par l'équipage de ${r.witness}.` : `Relevé de ${r.year}, il y a ${age} ans, par l'équipage de ${r.witness}.`}</div>
    {ships !== undefined && <div class="small">{ships > 1 ? `Garnison relevée : ${ships} vaisseaux.` : 'Garnison relevée : un vaisseau.'}</div>}
    {age > 0 && <div class="small">{r.navy > 0 ? `En ${r.year} : l'ensemble de vos vaisseaux de guerre réunis, ${shareOf(r.navy / s)} ; votre plus forte flotte, ${r.bestName}, ${shareOf(r.best / s)}.` : `En ${r.year}, vous n'aviez aucun vaisseau de guerre.`}</div>}
    <div class="small"><b>{now.navy <= 0 ? 'Vous n\'avez aucun vaisseau de guerre.' : age > 0 ? `Aujourd'hui, face à la force relevée : l'ensemble de vos vaisseaux de guerre réunis, ${shareOf(now.navy / s)} ; votre plus forte flotte, ${now.bestName}, ${shareOf(now.best / s)}.` : `Face à sa force : l'ensemble de vos vaisseaux de guerre réunis, ${shareOf(now.navy / s)} ; votre plus forte flotte, ${now.bestName}, ${shareOf(now.best / s)}.`}</b></div>
    {note && <div class="small muted">{note}</div>}
  </div>;
}

function GuardianBlock({ g, me, p }: { g: GameState; me: Player; p: Planet }) {
  const gk = me.intel.planets[p.id]?.guardian;
  if (!gk) return null;
  const kind = GUARDIAN_KINDS[gk];
  const live = guardianAt(g, p.id);
  const seenYear = me.intel.planets[p.id].guardianYear;
  const str = live ? guardianStrength(g, live) : 0;
  const mine = yourStrength(g, me);
  const ratio = mine && str ? mine.v / str : 0;
  return <section class="blk guardian">
    <div class="blk-head"><h3>⚠ {kind?.name ?? 'Gardien'}</h3><span class="tag">palier {kind?.tier}</span></div>
    <p class="small">{kind?.text}</p>
    <p class="small muted">Il attaque toute flotte qui s'arrête ici et répare 40 % de ses dégâts chaque année : il faut l'abattre en une fois. Le vaincre rapporte de la recherche, les minerais accumulés sur la planète{(kind?.tier ?? 0) >= 2 ? ' et souvent une relique' : ' et parfois une relique'}.{seenYear !== undefined && seenYear < g.year ? ` Vu pour la dernière fois en ${seenYear}.` : ''}</p>
    {mine && str > 0 && <div class={'small ' + (ratio >= 2.5 ? 'green' : ratio >= 1 ? 'yellow' : 'red')}>Rapport de force estimé avec {mine.label} : {ratio >= 10 ? '×10 et plus' : `×${ratio.toFixed(ratio < 1 ? 2 : 1)}`} {ratio < 1 ? '(perdu d\'avance)' : ratio < 2.5 ? '(risqué)' : '(favorable)'}</div>}
    {live && <GuardianReport g={g} me={me} guardian={live} brief />}
  </section>;
}

function AnomalyBlock({ g, me, p }: { g: GameState; me: Player; p: Planet }) {
  useStore();
  const a = anomalyAt(g, me, p.id);
  if (!a) return null;
  const d = defOf(a);
  const need = pointsNeeded(a);
  const have = a.progress[me.id] ?? 0;
  const rate = currentRate(g, me, a);
  const block = studyBlocker(g, me, a);
  const here = studyingFleets(g, me, a);
  const years = rate > 0 ? Math.ceil((need - have) / rate) : 0;
  const rivals = g.players.filter(o => o.id !== me.id && (a.progress[o.id] ?? 0) > 0).length;
  const send = !block && !here.length ? sendOptions(g, me, p.id, 'explore') : [];
  const build = !block && !here.length && !send.length ? buildOptions(g, me, p.id, 'explore') : [];
  const goSend = () => { const s = store; s.checkpoint(); if (sendFleet(g, send[0].fleet, p.id, 'explore')) s.notify(`${send[0].fleet.name} part étudier ${d.name} : il restera en orbite`); else s.undo.pop(); s.bump(); };
  const goBuild = () => { const s = store; s.checkpoint(); queueMission(g, build[0].planet, build[0].design, { kind: 'explore', planetId: p.id }); s.notify(`${build[0].design.name} mis en chantier à ${build[0].planet.name} : il ira étudier ${p.name}`); s.bump(); };
  return <section class="blk anomaly">
    <div class="blk-head"><h3>{d.site ? 'Site archéologique' : 'Anomalie'} : {d.name}</h3><span class="tag">{d.site ? `chapitre ${(a.chapter ?? 0) + 1} / ${d.site.chapters}` : `difficulté ${a.level}`}</span></div>
    <p class="small">{d.text}</p>
    <div class="anom-prog"><div class="bar"><div style={{ width: Math.min(100, have / need * 100) + '%' }} /></div><span class="small">{fmt(have)} / {need} points</span></div>
    {block ? <div class="small yellow">Étude impossible : {block}.</div>
      : here.length ? <div class="small green">{here.map(f => f.name).join(', ')}{p.owner === me.id ? ' et votre colonie' : ''} : {rate} points par an, {years <= 1 ? 'résultat l\'an prochain' : `résultat dans ${years} ans`}.</div>
      : p.owner === me.id && rate > 0 ? <div class="small green">Votre colonie fouille seule : {rate} points par an ({years} ans). Un vaisseau avec scanner en orbite accélère l'étude.</div>
      : <div class="small muted">Un vaisseau équipé d'un scanner, laissé en orbite sans autre destination, étudie l'anomalie ({currentRateIf(g, me)} points par an avec un seul vaisseau).</div>}
    {rivals > 0 && <div class="small yellow">{rivals > 1 ? `${rivals} autres empires étudient` : 'Un autre empire étudie'} aussi ce site : le premier qui termine l'emporte.</div>}
    {d.site && <div class="small muted">{d.site.relic ? <>À la fin des fouilles : une relique, {RELICS[d.site.relic].name} ({RELICS[d.site.relic].effect}).</> : 'Chaque chapitre rapporte de la recherche ou des minerais.'}</div>}
    {!block && !here.length && <div class="mission-btns">
      {send[0] ? <button class={'primary mbtn' + (send[0].slow ? ' slow' : '')} onClick={() => send[0].slow ? slowWarning(send[0].fleet.name, send[0].years, send[0].warp, goSend) : goSend()}>Envoyer étudier<small>{send[0].fleet.name} · {send[0].years} a{send[0].slow ? ` · Warp ${send[0].warp} !` : ''}</small></button>
        : build[0] ? <button class={'primary mbtn' + (build[0].slow || !build[0].reachable ? ' slow' : '')} onClick={() => build[0].slow ? slowWarning(`${build[0].design.name}, construit à ${build[0].planet.name},`, build[0].travelYears, build[0].warp, goBuild) : goBuild()}>Construire et envoyer un éclaireur<small>{build[0].planet.name} · ≈ {build[0].buildYears} + {build[0].travelYears} a{build[0].slow ? ` · Warp ${build[0].warp} !` : ''}</small></button>
        : <button class="primary mbtn" disabled>Aucun éclaireur disponible</button>}
    </div>}
  </section>;
}
const currentRateIf = (g: GameState, me: Player) => { let r = 2 + Math.floor(me.tech.electronics / 4); if (me.origin === 'explorers') r *= 2; return r; };

/** 0.3.7: sends the nearest idle ship with a scanner to a point (the zone where to sound a cloud). */
function sendScanner(g: GameState, me: Player, at: { x: number; y: number }, what: string) {
  const cands = g.fleets.filter(f => f.owner === me.id && f.waypoints.length <= 1 && !f.auto && fleetSpec(g, f).hasEngines && (fleetSpec(g, f).scanRange > 0 || fleetSpec(g, f).scanRangePen > 0)).sort((a, b) => distance(a, at) - distance(b, at));
  const f = cands[0];
  if (!f) { store.notify('Aucun vaisseau équipé d\'un scanner n\'est libre.'); return; }
  store.checkpoint();
  f.waypoints = [f.waypoints[0], { x: Math.round(at.x), y: Math.round(at.y), target: 'space', warp: fleetSpec(g, f).idealSpeed || 5, task: 'none' }];
  store.notify(`${f.name} part ${what}`);
  store.bump();
}

/** 0.3.7: a hidden star, in the right panel: what it is, and the quest still open (the way in, the seal). */
function SecretBlock({ g, me, p }: { g: GameState; me: Player; p: Planet }) {
  useStore();
  if (!p.hidden || me.intel.planets[p.id]?.unknown) return null;
  const s = secretOfPlanet(g, p.id);
  if (!s) return null;
  const info = SECRET_INFO[p.hidden];
  return <section class="blk secret">
    <div class="blk-head"><h3>★ {s.kind === 'pocket' ? `Amas de ${s.name}` : info.name}</h3><span class="tag">étoile cachée</span></div>
    <p class="small">{info.text}</p>
    <SecretQuest g={g} me={me} s={s} />
  </section>;
}

/** The open part of a hidden star's quest for this empire, with a button when a ship can be sent. */
function SecretQuest({ g, me, s }: { g: GameState; me: Player; s: Secret }) {
  if (s.kind === 'veiled' && s.zone) {
    if (s.tunnel?.includes(me.id)) return <p class="small green">Vous connaissez le couloir qui y mène : il est tracé sur la carte. On y vole à Warp 3 au plus.</p>;
    const fl = probeFleets(g, me, s);
    const have = s.probe?.[me.id] ?? 0;
    const rate = fl.length ? studyRate(g, me, fl.length, false, fl.some(f => fleetSpec(g, f).scanRangePen > 0)) : 0;
    return <>
      <div class="anom-prog"><div class="bar"><div style={{ width: Math.min(100, have / PROBE_NEED * 100) + '%' }} /></div><span class="small">passage : {fmt(have)} / {PROBE_NEED} points</span></div>
      {fl.length ? <div class="small green">{fl.map(f => f.name).join(', ')} sonde{fl.length > 1 ? 'nt' : ''} le nuage : {rate} points par an.</div>
        : <><div class="small muted">Aucune route connue n'y mène. Un vaisseau équipé d'un scanner qui stationne dans la zone marquée sur la carte, au bord du nuage, finira par trouver un passage.</div>
          <div class="mission-btns"><button class="primary mbtn" onClick={() => sendScanner(g, me, s.zone!, 'sonder le nuage')}>Envoyer un vaisseau sonder le nuage</button></div></>}
    </>;
  }
  if (s.kind === 'pocket') return <p class="small muted">Un itinéraire qui sort de l'amas ou y entre passe par le trou de ver.</p>;
  if (s.kind === 'pulsar' || s.kind === 'blackhole') return <p class="small muted">Le cercle pointillé de la carte marque sa portée ({s.kind === 'pulsar' ? `${PULSAR_SHIELD_RANGE} al` : `${SLING_RANGE} al`}).</p>;
  return null;
}

/** 0.3.7: the sealed wormhole of the hidden cluster, in the wormhole summary. */
export function SealBlock({ g, me, wormholeId }: { g: GameState; me: Player; wormholeId: number }) {
  useStore();
  const s = g.secrets?.find(x => x.kind === 'pocket' && (x.mouthId === wormholeId || x.endId === wormholeId));
  const w = g.wormholes.find(x => x.id === wormholeId);
  if (!s || !w) return null;
  if (!w.sealed) return s.known.includes(me.id) ? <p class="small">Il relie la galaxie à l'amas de {s.name}{s.openedBy !== undefined ? `, ouvert par les ${g.players[s.openedBy].name}` : ''}. Il ne bouge jamais.</p> : null;
  const fl = sealFleets(g, me, s);
  const have = s.open?.[me.id] ?? 0;
  return <div class="blk secret">
    <p class="small"><b>Scellé.</b> Rien ne le traverse. Un vaisseau équipé d'un scanner qui reste à son embouchure peut l'étudier pour l'ouvrir ; il faut « Navigation des anomalies ». Il ne bouge jamais.</p>
    <div class="anom-prog"><div class="bar"><div style={{ width: Math.min(100, have / OPEN_NEED * 100) + '%' }} /></div><span class="small">ouverture : {fmt(have)} / {OPEN_NEED} points</span></div>
    {fl.length ? <div class="small green">{fl.map(f => f.name).join(', ')} l'étudie{fl.length > 1 ? 'nt' : ''}.</div>
      : <div class="mission-btns"><button class="primary mbtn" onClick={() => sendScanner(g, me, w, 'étudier le trou de ver scellé')}>Envoyer un vaisseau l'étudier</button></div>}
  </div>;
}

/** Anomaly and guardian of a planet, in the right panel. */
export function DiscoveryBlock({ g, me, p }: { g: GameState; me: Player; p: Planet }) {
  const lair = me.intel.planets[p.id]?.lair;
  if (!anomaliesOn(g) && !g.settings.guardians && !lair) return null;
  return <><SecretBlock g={g} me={me} p={p} /><GuardianBlock g={g} me={me} p={p} />{lair === 'pirates' && <LairBlock g={g} me={me} p={p} />}{lair === 'crisis' && <BreachBlock g={g} me={me} p={p} />}{anomaliesOn(g) && <AnomalyBlock g={g} me={me} p={p} />}</>;
}

/** Pending choices (Empire page and header). */
export function Decisions({ g, me, focus }: { g: GameState; me: Player; focus?: number }) {
  const s = useStore();
  const list = me.decisions ?? [];
  if (!list.length) return null;
  return <div class="decisions">{list.map(dec => {
    const d = ANOMALIES[dec.kind];
    if (!d?.choice) return null;
    const pl = g.planets[dec.planetId];
    const pick = (c: 'a' | 'b') => { s.checkpoint(); const t = decide(g, me, dec.id, c); if (t) s.notify(t); s.bump(); };
    return <div class={'decision' + (dec.anomalyId === focus ? ' hl' : '')}>
      <div><b>{d.name}</b> <button class="lnk small" onClick={() => s.focus({ kind: 'planet', id: pl.id }, pl)}>{pl.name}</button> <span class="muted small">({dec.year})</span></div>
      <p class="small muted">{d.text}</p>
      <div class="dec-pair">
        <button onClick={() => pick('a')}><b>{d.choice.a.label}</b><small>{d.choice.a.hint}</small></button>
        <button onClick={() => pick('b')}><b>{d.choice.b.label}</b><small>{d.choice.b.hint}</small></button>
      </div>
    </div>;
  })}</div>;
}

/** Empire page: origin, relics, the Ancients' map, choices, known discoveries. */
export function DiscoveriesSection({ g, me }: { g: GameState; me: Player }) {
  const s = useStore();
  // reached from a report: that anomaly (or relic) is pointed out
  const focusA: number | undefined = s.tab === 'empire' ? s.tabData?.anomalyId : undefined;
  const focusR: number | undefined = s.tab === 'empire' ? s.tabData?.relic : undefined;
  const known = knownAnomalies(g, me);
  const own = g.planets.filter(p => p.owner === me.id);
  const near = (pl: Planet) => own.length ? Math.min(...own.map(o => distance(o, pl))) : 0;
  const rows = known.map(a => {
    const d = defOf(a), pl = g.planets[a.planetId];
    const status = finished(a) ? (a.doneBy === me.id ? 'faite' : 'perdue') : studyBlocker(g, me, a) ? 'bloquée' : currentRate(g, me, a) > 0 ? 'en cours' : 'à étudier';
    return { a, d, pl, status, pct: finished(a) ? 1 : (a.progress[me.id] ?? 0) / pointsNeeded(a), dist: near(pl) };
  }).sort((x, y) => Number(finished(x.a)) - Number(finished(y.a)) || x.dist - y.dist);
  const { sorted, th } = useSorted(rows, [
    { key: 'name', get: r => r.d.name }, { key: 'planet', get: r => r.pl.name }, { key: 'level', get: r => r.a.level, num: true },
    { key: 'pct', get: r => r.pct, num: true }, { key: 'status', get: r => r.status }, { key: 'dist', get: r => r.dist, num: true },
  ], 'natural', 1);
  const vault = vaultOf(g);
  const need = fragmentsNeeded(g);
  const origin = me.origin ? ORIGIN[me.origin] : undefined;
  const guardians = (g.guardians ?? []).filter(x => me.intel.planets[x.planetId]?.guardian || (x.killedBy !== undefined && (x.killedBy === me.id || me.intel.planets[x.planetId]?.explored)));
  // 0.3.7: the hidden stars found
  const secrets = (g.secrets ?? []).filter(x => x.known.includes(me.id) && x.ids.length);
  const ancients = g.secrets?.some(x => x.kind === 'ancients');
  return <>
    {origin && g.settings.origins && <div class="emp-origin"><b>Origine : {origin.name}.</b> <span class="small">{origin.text}</span>{origin.pros.length > 0 && <div class="small"><span class="green">+</span> {origin.pros.join(' ; ')}{origin.cons.length ? <> · <span class="red">−</span> {origin.cons.join(' ; ')}</> : null}</div>}</div>}
    <Decisions g={g} me={me} focus={focusA} />
    <div class="emp-kpis">
      <div><small>Reliques</small><b>{(me.relics ?? []).length}</b></div>
      {anomaliesOn(g) && (vault || ancients) && <div><small>Carte des Anciens</small><b>{Math.min(me.fragments ?? 0, need)} / {need}</b><small>{vault?.known.includes(me.id) ? `sanctuaire : ${g.planets[vault.planetId].name}` : 'fragments trouvés'}</small></div>}
      {anomaliesOn(g) && g.secrets?.length ? <div><small>Étoiles cachées</small><b>{secrets.length}</b><small>trouvées</small></div> : null}
      <div><small>Découvertes</small><b>{(me.finds?.anomalies ?? 0) + (me.finds?.chapters ?? 0)}</b><small>anomalies et chapitres</small></div>
      {g.settings.guardians && <div><small>Gardiens vaincus</small><b>{me.finds?.guardians ?? 0}</b></div>}
    </div>
    {(me.relics ?? []).length > 0 && <div class="relics">{(me.relics as RelicId[]).map(r => <div class={'relic' + (focusR !== undefined && Object.keys(RELICS)[focusR] === r ? ' hl' : '')}><b>✦ {RELICS[r].name}</b><span class="small">{RELICS[r].effect}</span></div>)}</div>}
    {anomaliesOn(g) && (rows.length ? <div class="report-scroll"><table class="report compact"><thead><tr>{th('name', 'Découverte')}{th('planet', 'Planète')}{th('level', 'Diff.')}{th('pct', 'Avancement')}{th('status', 'État')}{th('dist', 'Distance')}</tr></thead>
      <tbody>{sorted.map(r => <tr onClick={() => s.focus({ kind: 'planet', id: r.pl.id }, r.pl)} class={'go' + (r.a.id === focusA ? ' hl' : '')}><td>{r.d.name}{r.d.site ? <span class="tag dim">site {(r.a.chapter ?? 0)}/{r.d.site.chapters}</span> : ''}</td><td>{r.pl.name}</td><td class="num">{r.a.level}</td><td class="num">{Math.round(r.pct * 100)} %</td><td class={r.status === 'en cours' ? 'green' : r.status === 'bloquée' ? 'yellow' : r.status === 'perdue' ? 'muted' : ''}>{r.status}{finished(r.a) && r.a.doneBy !== me.id && r.a.doneBy !== undefined ? ` (${g.players[r.a.doneBy].name})` : ''}</td><td class="num">{fmt(r.dist)} al</td></tr>)}</tbody></table></div>
      : <p class="small muted">Aucune anomalie repérée pour l'instant : elles apparaissent quand vos vaisseaux analysent une planète.</p>)}
    {secrets.length > 0 && <div class="emp-guards">{secrets.map(x => {
      const pl = g.planets[x.ids[0]];
      const state = x.kind === 'veiled' ? (x.tunnel?.includes(me.id) ? 'couloir trouvé' : `passage à trouver (${Math.round((x.probe?.[me.id] ?? 0) / PROBE_NEED * 100)} %)`) : x.kind === 'pocket' ? `${x.ids.length} étoiles` : pl.name;
      return <button class="chip" title={SECRET_INFO[x.kind].text} onClick={() => s.focus({ kind: 'planet', id: pl.id }, pl)}>★ {x.kind === 'pocket' ? `Amas de ${x.name}` : SECRET_INFO[x.kind].name} · {state}</button>;
    })}</div>}
    {guardians.length > 0 && <div class="emp-guards">{guardians.map(x => <button class="chip" onClick={() => { const pl = g.planets[x.planetId]; s.focus({ kind: 'planet', id: pl.id }, pl); }}>{x.alive ? '⚠ ' : '✓ '}{GUARDIAN_KINDS[x.kind]?.name} · {g.planets[x.planetId].name}{!x.alive && x.killedBy !== undefined ? ` (vaincu par les ${g.players[x.killedBy].name})` : ''}</button>)}</div>}
  </>;
}

export { isMonster };
