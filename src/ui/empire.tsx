// Empire page (Constellations 3): administration and regional capitals, logistics network, megaprojects,
// secret objectives and doctrines, in one place.
import type { ComponentChildren } from 'preact';
import { useStore, fmt, fmtPop, pct } from './store';
import { Bar, Cost, PageCtx, useSorted, Num } from './components';
import type { GameState, Planet, Player } from '../engine/types';
import { planetSpec } from '../engine/planet';
import { distance } from '../engine/fleet';
import { ADMIN_RADIUS, ADMIN_LOSS, ADMIN_STEP, adminFactor, capitalOf, regionalAllowance, regionalBlocker, seatsOf, REGIONAL_PER_WORLDS, DISORG_FACTOR } from '../engine/empire';
import { activeFlows, colonistNeed, colonistSurplus, idleFreighters, jobText, logisticsOn, mineralSurplus, networkFleets, DEFAULT_IN, DEFAULT_OUT, joinNetwork , migrationTargets, autoImmigration } from '../engine/logistics';
import { MEGAPROJECTS, megaList, megaBlocker, megaProgress, portalThreat, megaVisible, MEGA_HORIZON, relaysOn, relaysOf, RELAYS_NEEDED, type MegaId } from '../engine/megaprojects';
import { OBJ, objectiveProgress, objectiveText, OBJECTIVE_POINTS } from '../engine/objectives';
import { DOCTRINE_FORKS, pendingForks } from '../engine/doctrines';
import { FIELD_NAMES } from '../engine/tech';
import { canBuildShip, zeroCost } from '../engine/production';
import { missionDesigns, queueMission } from '../engine/missions';
import { store } from './store';
import * as A from './actions';
import { DiscoveriesSection } from './discoveries';
import { CultureSection } from './culture';
import { PiratesSection, CrisisSection } from './factions';
import { GoldenSection, SecretSection, OriginWinSection, StoriesSection } from './destiny';
import { GovernorsSection } from './govui';

function Sec({ title, sub, children, id }: { title: ComponentChildren; sub?: ComponentChildren; children: ComponentChildren; id?: string }) {
  return <section class="emp-sec" id={id}><div class="emp-head"><h3>{title}</h3>{sub && <span class="small muted">{sub}</span>}</div>{children}</section>;
}

export function EmpirePage() {
  const s = useStore();
  const g = s.game!, me = s.me!;
  const st = g.settings;
  const any = st.crisis || st.pirates || st.culture || st.distanceCost || st.logistics || st.megaprojects || st.secretObjectives || st.doctrines || st.anomalies || st.guardians || st.origins || st.eventChains || st.governors;
  return <PageCtx.Provider value={true}><section class="page empire">
    <header class="page-head"><div><h2>Empire</h2><div class="page-sub">Découvertes, administration, culture, pirates, réseau logistique, mégaprojets, objectifs secrets et doctrines.</div></div>
      <div class="page-actions"><button onClick={() => s.open('settings')}>Règles de la partie…</button></div></header>
    <div class="page-body emp-grid">
      {!any && <p class="muted">Aucune règle de Constellations 3 n'est active dans cette partie. Vous pouvez les activer dans les règles de la partie.</p>}
      {(st.anomalies || st.guardians || st.origins || (me.relics?.length ?? 0) > 0) && <Sec id="discoveries" title="Découvertes" sub="anomalies, sites archéologiques, reliques et gardiens"><DiscoveriesSection g={g} me={me} /></Sec>}
      {st.distanceCost && <Administration g={g} me={me} />}
      {st.governors && <Sec id="governors" title="Secteurs et gouverneurs" sub="talents, consignes et candidats"><GovernorsSection g={g} me={me} /></Sec>}
      {st.culture && <Sec id="culture" title="Culture et territoire" sub="rayonnement, frontières, assimilation"><CultureSection g={g} me={me} /></Sec>}
      <OriginWinSection g={g} me={me} />
      <StoriesSection g={g} me={me} />
      <GoldenSection g={g} me={me} />
      {st.crisis && <Sec id="crisis" title="Crise de fin de partie" sub="la Brèche et les Moissonneurs"><CrisisSection g={g} me={me} /></Sec>}
      <SecretSection g={g} me={me} />
      {st.pirates && <Sec id="pirates" title="Pirates" sub="repaires, raids et primes"><PiratesSection g={g} me={me} /></Sec>}
      {logisticsOn(g) && <Logistics g={g} me={me} />}
      {st.megaprojects && <Megaprojects g={g} me={me} />}
      {st.secretObjectives && <Objectives g={g} me={me} />}
      {st.doctrines && <DoctrineSummary g={g} me={me} />}
    </div>
  </section></PageCtx.Provider>;
}

/** Output gained if this planet became a regional capital (resources per year). */
function regionalGain(g: GameState, me: Player, c: Planet, mine: Planet[]): number {
  const seats = seatsOf(g, me);
  let gain = 0;
  for (const o of mine) {
    if (distance(o, c) > ADMIN_RADIUS) continue;
    const now = seats.length ? adminFactor(Math.min(...seats.map(x => distance(x, o)))) : 1;
    gain += planetSpec(g, o, me).resourcesBase * (1 - now);
  }
  return gain;
}

function Administration({ g, me }: { g: GameState; me: Player }) {
  const s = useStore();
  const mine = g.planets.filter(p => p.owner === me.id);
  const rows = mine.map(p => ({ p, sp: planetSpec(g, p, me) }));
  const base = rows.reduce((a, r) => a + r.sp.resourcesBase, 0), real = rows.reduce((a, r) => a + r.sp.resources - (r.p.bonusResources ?? 0), 0);
  const lost = Math.max(0, base - real);
  const cap = capitalOf(g, me);
  const seats = seatsOf(g, me);
  const al = regionalAllowance(g, me);
  const worst = rows.filter(r => r.sp.efficiency.total < 0.999).sort((a, b) => (b.sp.resourcesBase - b.sp.resources) - (a.sp.resourcesBase - a.sp.resources)).slice(0, 8);
  const { sorted: worstSorted, th: wth } = useSorted(worst, [
    { key: 'name', get: r => r.p.name }, { key: 'dist', get: r => r.sp.efficiency.distance, num: true },
    { key: 'eff', get: r => r.sp.efficiency.total, num: true }, { key: 'loss', get: r => r.sp.resourcesBase - r.sp.resources, num: true },
  ], 'loss', -1);
  const cands = mine.filter(p => !regionalBlocker(g, p)).map(p => ({ p, gain: regionalGain(g, me, p, mine) })).filter(c => c.gain > 0).sort((a, b) => b.gain - a.gain).slice(0, 3);
  const queued = mine.find(p => p.queue.some(q => q.kind === 'capital'));
  const disorg = me.disorgUntil !== undefined && g.year < me.disorgUntil;
  return <Sec id="admin" title="Administration" sub={`plein rendement à ${ADMIN_RADIUS} al d'une capitale, puis −${Math.round(ADMIN_LOSS * 100)} % tous les ${ADMIN_STEP} al`}>
    <div class="emp-kpis">
      <div><small>Rendement moyen</small><b class={real / Math.max(1, base) < 0.85 ? 'yellow' : 'green'}>{pct(base ? real / base : 1)}</b></div>
      <div><small>Perdu chaque année</small><b>{fmt(lost)} R</b></div>
      <div><small>Capitales régionales</small><b>{al.have} / {al.allowed}</b><small>une par {REGIONAL_PER_WORLDS} planètes</small></div>
    </div>
    {disorg && <div class="alert">Capitale perdue : l'empire est désorganisé jusqu'en {me.disorgUntil} (rendement ×{DISORG_FACTOR}).</div>}
    <div class="emp-seats">{seats.map(p => <button class="chip" onClick={() => s.focus({ kind: 'planet', id: p.id }, p)}>{p === cap ? '★ ' : '◆ '}{p.name}</button>)}</div>
    {worst.length > 0 && <table class="report compact"><thead><tr>{wth('name', 'Planète la plus pénalisée')}{wth('dist', 'Distance')}{wth('eff', 'Rendement')}{wth('loss', 'Perte')}</tr></thead>
      <tbody>{worstSorted.map(r => <tr class="go" title="Voir sur la carte" onClick={() => s.focus({ kind: 'planet', id: r.p.id }, r.p)}><td>{r.p.name}{r.p.conqueredYear !== undefined && r.sp.efficiency.conquest < 1 ? <span class="tag">conquise</span> : ''}</td><td class="num">{fmt(r.sp.efficiency.distance)} al</td><td class="num">{pct(r.sp.efficiency.total)}</td><td class="num">{fmt(r.sp.resourcesBase - r.sp.resources)} R</td></tr>)}</tbody></table>}
    {queued ? <p class="small">Capitale régionale en construction à <button class="lnk" onClick={() => s.focus({ kind: 'planet', id: queued.id }, queued)}><b>{queued.name}</b></button>.</p>
      : cands.length ? <div class="emp-cands"><span class="small muted">Meilleurs emplacements pour une capitale régionale :</span>{cands.map(c => <div class="emp-cand"><span><button class="lnk" onClick={() => s.focus({ kind: 'planet', id: c.p.id }, c.p)}><b>{c.p.name}</b></button> <span class="muted small">+{fmt(c.gain)} R/an autour</span></span><button class="small" onClick={() => { A.queueAdd(c.p.id, 'capital', undefined, 1, 0); s.notify(`Capitale régionale mise en tête de la file de ${c.p.name}.`); }}>Construire</button></div>)}</div>
      : <p class="small muted">{al.have >= al.allowed ? `Il faut ${REGIONAL_PER_WORLDS} planètes de plus pour une nouvelle capitale régionale.` : 'Aucune planète éloignée ne remplit les conditions (population, distance aux autres capitales).'}</p>}
  </Sec>;
}

function Logistics({ g, me }: { g: GameState; me: Player }) {
  const s = useStore();
  const mine = g.planets.filter(p => p.owner === me.id);
  const net = networkFleets(g, me);
  const idle = idleFreighters(g, me);
  const flows = activeFlows(g, me);
  const st = me.logStats;
  const senders = mine.filter(p => p.migration?.mode === 'out'), receivers = mine.filter(p => p.migration?.mode === 'in');
  const ai = autoImmigration(me);
  const autoIn = migrationTargets(g, me).filter(t => t.auto);
  const exporters = mine.filter(p => p.mineralPolicy?.mode === 'export'), importers = mine.filter(p => p.mineralPolicy?.mode === 'import');
  const fd = missionDesigns(g, me, 'haul')[0];
  const yard = fd ? [...mine].sort((a, b) => b.pop - a.pop).find(x => !canBuildShip(g, x, fd)) : undefined;
  const suggest = () => {
    s.checkpoint();
    const cap = capitalOf(g, me);
    for (const p of mine) {
      if (p === cap) continue;
      const sp = planetSpec(g, p, me);
      if (sp.hab > 0 && sp.maxPop > 0 && p.pop / sp.maxPop < DEFAULT_IN / 100) p.migration = { mode: 'in', target: DEFAULT_IN };
    }
    if (cap) cap.migration = { mode: 'out', target: DEFAULT_OUT };
    s.notify('Politique conseillée : la capitale envoie ses colons vers les jeunes colonies habitables.');
    s.bump();
  };
  return <Sec id="logistics" title="Réseau logistique" sub="les cargos du réseau suivent vos politiques ; ce sont de vrais vaisseaux, interceptables">
    <div class="emp-kpis">
      <div><small>Cargos du réseau</small><b>{net.length}</b></div>
      <div><small>Colons livrés</small><b>{fmtPop(st?.colonists ?? 0)}</b></div>
      <div><small>Minerais livrés</small><b>{fmt(st?.minerals ?? 0)} kt</b></div>
      <div><small>Convois perdus</small><b class={(st?.convoysLost ?? 0) > 0 ? 'red' : ''}>{st?.convoysLost ?? 0}</b>{(st?.lostColonists ?? 0) + (st?.lostMinerals ?? 0) > 0 && <small>{fmtPop(st!.lostColonists)} colons, {fmt(st!.lostMinerals)} kt</small>}</div>
    </div>
    <div class="btns">
      {idle.length > 0 && <button class="small primary" onClick={() => { s.checkpoint(); for (const f of idle) joinNetwork(g, f); s.notify(`${idle.length} cargo${idle.length > 1 ? 's' : ''} affecté${idle.length > 1 ? 's' : ''} au réseau.`); s.bump(); }}>{idle.length > 1 ? `Affecter les ${idle.length} cargos inactifs` : 'Affecter le cargo inactif'}</button>}
      {fd && yard && <button class="small" onClick={() => { s.checkpoint(); queueMission(g, yard, fd, { kind: 'logistics', planetId: yard.id }); s.notify(`${fd.name} ajouté à la file de ${yard.name} pour le réseau.`); s.bump(); }}>Construire un {fd.name} ({yard.name})</button>}
      <button class="small" onClick={suggest} title={`Capitale : émigration au-delà de ${DEFAULT_OUT} % ; colonies habitables peu peuplées : immigration jusqu'à ${DEFAULT_IN} %`}>Politique conseillée</button>
    </div>
    <div class="emp-pol">
      <div><h4>Émigration <span class="muted">· colons à envoyer</span></h4>{senders.length ? senders.map(p => <div class="pl" onClick={() => s.focus({ kind: 'planet', id: p.id }, p)} title={`Envoie les colons au-delà de ${p.migration!.target} % de sa capacité`}><span>{p.name} <small class="muted">&gt; {p.migration!.target} %</small></span><b>{fmtPop(colonistSurplus(g, p) * 100)}</b></div>) : <span class="muted small">aucune</span>}</div>
      <div><h4>Immigration <span class="muted">· colons attendus</span></h4>{receivers.length || autoIn.length ? <>
        {receivers.map(p => <div class="pl" onClick={() => s.focus({ kind: 'planet', id: p.id }, p)} title={`Reçoit des colons jusqu'à ${p.migration!.target} % de sa capacité`}><span>{p.name} <small class="muted">&lt; {p.migration!.target} %</small></span><b>{fmtPop(colonistNeed(g, p) * 100)}</b></div>)}
        {autoIn.slice(0, 8).map(t => <div class="pl" onClick={() => s.focus({ kind: 'planet', id: t.planet.id }, t.planet)} title={`Colonie habitable sans politique, sous ${ai.upTo} % de sa capacité : reçoit les émigrants automatiquement`}><span>{t.planet.name} <small class="muted">auto</small></span><b>{fmtPop(t.need * 100)}</b></div>)}
        {autoIn.length > 8 && <div class="small muted">et {autoIn.length - 8} autres colonies</div>}
      </> : <span class="muted small">aucune</span>}</div>
      <div><h4>Minerais <span class="muted">· à exporter</span></h4>{exporters.length ? exporters.map(p => { const m = mineralSurplus(p); return <div class="pl" onClick={() => s.focus({ kind: 'planet', id: p.id }, p)}><span>{p.name}</span><b>{fmt(m.ironium + m.boranium + m.germanium)} kt</b></div>; }) : <span class="muted small">aucun export</span>}
        {exporters.length > 0 && <div class="small muted">vers {importers.length ? importers.map(p => p.name).join(', ') : `la capitale (${capitalOf(g, me)?.name ?? '?'})`}</div>}</div>
    </div>
    <div class="emp-auto">
      <label class="chk"><input type="checkbox" checked={ai.on} onChange={e => A.setAutoImmigration((e.target as HTMLInputElement).checked)} /> Envoyer aussi les émigrants vers vos colonies habitables sans politique, jusqu'à</label>
      <Num value={ai.upTo} min={5} max={100} width={56} onChange={v => A.setAutoImmigration(ai.on, v)} /><span>% de leur capacité</span>
    </div>
    <p class="small muted">Les cargos du réseau prennent les colons des planètes en Émigration, au-delà de leur seuil, et les livrent aux planètes en Immigration, jusqu'au leur ; avec l'option ci-dessus, vos colonies habitables sans politique les reçoivent aussi, les plus vides en priorité. Chaque cargo choisit le convoi qui livre le plus de colons par année de route, en évitant les routes où des navires ennemis ont été vus ; les planètes en Immigration passent avant les autres. Une planète inhabitable pour votre race ne reçoit jamais de colons.</p>
    {flows.length > 0 && <><h4>Convois en cours</h4><ul class="emp-flows">{flows.map(fl => <li onClick={() => s.focus({ kind: 'fleet', id: fl.fleet.id }, fl.fleet)}><b>{fl.fleet.name}</b> <span class="small">{jobText(g, fl.fleet)}</span></li>)}</ul></>}
    {net.length > 0 && net.some(f => !f.job) && <p class="small muted">{net.filter(f => !f.job).length} cargo(s) en attente : aucun besoin, ou routes jugées dangereuses (navires ennemis repérés à proximité).</p>}
    {!net.length && <p class="small muted">Réglez les politiques dans le panneau de chaque planète, puis cochez « Réseau logistique » sur des flottes de cargos.</p>}
  </Sec>;
}

function Megaprojects({ g, me }: { g: GameState; me: Player }) {
  const s = useStore();
  const mine = g.planets.filter(p => p.owner === me.id);
  const built = mine.flatMap(p => (p.megaprojects ?? []).map(id => ({ p, id: id as MegaId })));
  const running = mine.flatMap(p => p.queue.filter(q => q.kind === 'mega').map(q => ({ p, q })));
  const threat = portalThreat(g);
  const best = [...mine].sort((a, b) => planetSpec(g, b, me).resources - planetSpec(g, a, me).resources)[0];
  const list = megaList(g).filter(m => m.id !== 'seal' || me.secretKnown !== undefined);
  const visible = list.filter(m => megaVisible(me, m) || built.some(b => b.id === m.id) || running.some(r => r.q.megaId === m.id));
  const hidden = list.length - visible.length;
  // 0.3.9: a relay goes to the richest world that has none (and none on the way)
  const relayAt = [...mine].sort((a, b) => planetSpec(g, b, me).resources - planetSpec(g, a, me).resources).find(p => !megaBlocker(g, p, 'relay'));
  const relays = relaysOn(g) ? relaysOf(g, me.id) : [];
  return <Sec id="megaprojects" title="Mégaprojets" sub={`travaux de longue haleine ; ils apparaissent quand vos sciences approchent de leur niveau (à ${MEGA_HORIZON} niveaux près)`}>
    {threat && threat.owner !== me.id && <div class="alert strong">Les {g.players[threat.owner].name} construisent le Portail de l'Ascension sur <button class="lnk" onClick={() => s.focus({ kind: 'planet', id: threat.planet.id }, threat.planet)}>{threat.planet.name}</button> : travaux avancés à {threat.announced} % au moins. S'ils l'achèvent, ils gagnent.</div>}
    {running.map(r => <div class="emp-mega"><b>{MEGAPROJECTS.find(m => m.id === r.q.megaId)?.name}</b> <span class="muted small">à <button class="lnk" onClick={() => s.focus({ kind: 'planet', id: r.p.id }, r.p)}>{r.p.name}</button></span><Bar value={megaProgress(r.q)} max={1} color="#c9a227" label={`${Math.floor(megaProgress(r.q) * 100)} %`} /></div>)}
    {built.map(b => <div class="emp-mega done"><b>{MEGAPROJECTS.find(m => m.id === b.id)?.name}</b> <span class="muted small">à <button class="lnk" onClick={() => s.focus({ kind: 'planet', id: b.p.id }, b.p)}>{b.p.name}</button> · {MEGAPROJECTS.find(m => m.id === b.id)?.effect}</span></div>)}
    {relaysOn(g) && (relays.length > 0 || visible.some(m => m.id === 'relay')) && <div class="small">Relais de l'Ascension : <b>{relays.length} sur {RELAYS_NEEDED}</b>{relays.length ? <> ({relays.map((p, i) => <>{i > 0 && ', '}<button class="lnk" onClick={() => s.focus({ kind: 'planet', id: p.id }, p)}>{p.name}</button></>)})</> : ''}. {relays.length >= RELAYS_NEEDED ? 'Le Portail peut être bâti ; perdre un relais met son chantier en pause.' : 'Il en faut trois, sur trois mondes, avant de bâtir le Portail.'}</div>}
    {!visible.length && <p class="small muted">Vos scientifiques n'imaginent encore aucun grand projet : il faut d'abord progresser dans la recherche.</p>}
    <div class="mega-list">{visible.map(m => {
      const at = m.id === 'relay' ? relayAt ?? best : best;
      const why = at ? megaBlocker(g, at, m.id) : 'aucune planète';
      return <div class={'mega-card' + (m.victory ? ' victory' : '')}>
        <div class="mc-head"><b>{m.name}</b><span class="muted small">{m.minYears} ans au moins</span></div>
        <div class="small">{m.effect}</div>
        <div class="mc-foot"><Cost c={m.cost} />{why ? <span class="small muted">{why}</span> : <button class="small" onClick={() => { A.queueAdd(at!.id, 'mega', undefined, 1, undefined, m.id); s.notify(`${m.name} ajouté à la file de ${at!.name}.`); }}>Lancer à {at!.name}</button>}</div>
      </div>;
    })}</div>
    {hidden > 0 && visible.length > 0 && <p class="small muted">D'autres grands projets restent hors de portée de vos scientifiques (??????).</p>}
  </Sec>;
}

function Objectives({ g, me }: { g: GameState; me: Player }) {
  const over = g.victor !== null;
  const others = g.players.filter(p => p.id !== me.id && !p.monster && (me.intel.met.includes(p.id) || over));
  return <Sec id="objectives" title="Objectifs secrets" sub={`chacun accompli rapporte ${OBJECTIVE_POINTS} points de score ; ceux des autres sont révélés en fin de partie`}>
    <ul class="emp-obj">{(me.objectives ?? []).map(o => <li class={o.done !== undefined ? 'done' : o.failed !== undefined ? 'failed' : ''}>
      <b>{OBJ[o.id]?.name}</b> {objectiveText(g, o)}
      <span class="small muted">{o.done !== undefined ? ` · accompli en ${o.done}` : o.failed !== undefined ? ` · manqué en ${o.failed}` : objectiveProgress(g, me, o) ? ` · actuellement ${objectiveProgress(g, me, o)}` : ''}</span>
    </li>)}</ul>
    {others.length > 0 && <table class="report compact"><thead><tr><th>Empire</th><th>{over ? 'Objectifs (révélés)' : 'Objectifs accomplis'}</th></tr></thead>
      <tbody>{others.map(p => <tr><td style={{ color: p.color }}>{p.name}</td><td class="small">{over
        ? (p.objectives ?? []).map(o => `${OBJ[o.id]?.name} (${objectiveText(g, o)})${o.done !== undefined ? ' ✓' : ' ✗'}`).join(' · ')
        : `${(p.objectives ?? []).filter(o => o.done !== undefined).length} sur 2`}</td></tr>)}</tbody></table>}
  </Sec>;
}

function DoctrineSummary({ g, me }: { g: GameState; me: Player }) {
  const s = useStore();
  const pend = pendingForks(g, me);
  return <Sec id="doctrine-sum" title="Doctrines" sub="choix exclusifs et définitifs">
    {pend.length > 0 && <div class="alert info">{pend.length} doctrine{pend.length > 1 ? 's' : ''} à choisir : {pend.map(f => f.title).join(', ')}. <button class="small primary" onClick={() => s.goTab('research')}>Choisir</button></div>}
    <ul class="emp-doc">{DOCTRINE_FORKS.map(f => { const c = me.doctrines?.[f.id]; return <li class={c ? 'done' : ''}><b>{f.title}</b> <span class="small muted">{FIELD_NAMES[f.field]} {f.level}</span> : {c ? <>{f[c].name} <span class="small muted">({f[c].effect})</span></> : <span class="muted small">{f.a.name} ou {f.b.name}</span>}</li>; })}</ul>
  </Sec>;
}

export { store, zeroCost };
