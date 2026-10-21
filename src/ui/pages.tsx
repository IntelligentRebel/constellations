// Center pages behind the top tabs: map, colonies, planner, fleets, and the larger tools shown as pages.
import { radarContacts } from '../engine/radar';
import { DiplomacyDialog } from './diplomacy';
import { useState, useEffect } from 'preact/hooks';
import { colonyBlocker } from '../engine/culture';
import type { ComponentChildren } from 'preact';
import { viewRoute, viewSpec, viewMemo, viewFleet, viewScanners, viewQueue } from './memo';
import { store, useStore, useChannel, fmt, fmtPop, pct, MINERAL_COLORS, type ViewSettings } from './store';
import { closersOf } from '../engine/borders';
import { PageCtx, MineralLine, useSorted, RangeFilter, rangeOf, rangeDistance, setRangeOf, Num } from './components';
import type { Fleet, GameState, Planet, Player } from '../engine/types';
import { MapView, refPos } from './map';
import { gotoTarget, MsgText } from './nav';
import { TodoBar } from './summary';
import { SortTable } from './dialogs/reports';
import { ReportsDialog } from './dialogs/reports';
import { ResearchDialog } from './dialogs/research';
import { DesignerDialog } from './dialogs/designer';
import { RelationsDialog, HelpDialog } from './dialogs/misc';
import { planetSpec, terraformedHabValue, maxPopulation, prospectiveMaxPop } from '../engine/planet';
import { habitability, raceSpec } from '../engine/race';
import { fleetSpec, estimateRoute, cargoMass, distance } from '../engine/fleet';
import { itemLabel, isAuto, estimateQueue, queueBottleneck, availableItems } from '../engine/production';
import { isPureScout, canMineHere, miningYield, missionDesigns, missionStatus, haulCycleYears, capitalOf, type MissionStatus } from '../engine/missions';
import { designSpec } from '../engine/design';
import { scannersOf } from '../engine/scan';
import { fleetMission } from './sidebar';
import { missionModel, MissionButton, MissionOptions, HaulBlock } from './missionui';
import { wpName } from './command';
import { EmpirePage } from './empire';
import { fleetHasObsolete } from '../engine/refit';
import * as A from './actions';

function Page({ title, sub, actions, children, cls }: { title: ComponentChildren; sub?: ComponentChildren; actions?: ComponentChildren; children: ComponentChildren; cls?: string }) {
  return <section class={'page ' + (cls ?? '')}>
    <header class="page-head"><div><h2>{title}</h2>{sub && <div class="page-sub">{sub}</div>}</div>{actions && <div class="page-actions">{actions}</div>}</header>
    <div class="page-body">{children}</div>
  </section>;
}

// ------------------------------------------------------------------ map

type Toggle = 'scan' | 'mines' | 'paths' | 'names' | 'counts' | 'enemyTracks' | 'idleOnly' | 'minimap' | 'admin' | 'borders';
function toggle(k: Toggle) { (store.view as any)[k] = !(store.view as any)[k]; store.savePrefs(); store.bump(); }
function setMode(m: ViewSettings['mode']) { store.view.mode = m; store.savePrefs(); store.bump(); }

export function fitGalaxy() {
  const s = store, g = s.game; if (!g) return;
  const el = document.querySelector('.map-wrap') as HTMLElement | null;
  const w = el?.clientWidth ?? 800, h = el?.clientHeight ?? 600;
  s.camera = { x: g.width / 2, y: g.height / 2, zoom: Math.min(w, h) / g.width * 0.92 }; s.bump();
}

function MapMore() {
  const s = useStore();
  const v = s.view;
  const [open, setOpen] = useState(false);
  const designs = s.game!.designs.filter(d => d.owner === s.me!.id && !d.starbase && !d.deleted);
  return <div class="pop-wrap">
    <button class={'ghost' + (open ? ' on' : '')} onClick={() => setOpen(!open)} aria-expanded={open} title="Autres réglages de la carte">⋯</button>
    {open && <div class="pop" onMouseLeave={() => setOpen(false)}>
      {([['mines', 'Champs de mines (8)'], ['enemyTracks', 'Trajectoires estimées des flottes étrangères'], ['minimap', 'Vue d\'ensemble de la galaxie'], ['counts', 'Nombre de vaisseaux (Maj+0)'], ['idleOnly', 'Seulement les flottes sans ordre'], ...(s.game!.settings.distanceCost ? [['admin', 'Rayon administratif des capitales']] : [])] as [Toggle, string][]).map(([k, l]) => <label class="chk"><input type="checkbox" checked={!!v[k]} onChange={() => toggle(k)} /> {l}</label>)}
      <label class="field">Flottes affichées<select value={v.designFilter ?? ''} onChange={e => { const x = (e.target as HTMLSelectElement).value; v.designFilter = x ? +x : null; s.bump(); }}><option value="">Tous les modèles</option>{designs.map(d => <option value={d.id}>{d.name}</option>)}</select></label>
      <label class="field" title="Portée effective des scanners contre une cible camouflée">Portée des scanners<select value={v.scanPct} onChange={e => { v.scanPct = +(e.target as HTMLSelectElement).value; s.bump(); }}>{[0, 25, 50, 75, 90, 98].map(p => <option value={p}>{p ? `contre ${p} % de camouflage` : 'nominale'}</option>)}</select></label>
      <button class="small" onClick={() => { setOpen(false); s.open('find'); }}>Rechercher un objet… (Ctrl+F)</button>
    </div>}
  </div>;
}

/** 3.6: what the planets show, as clickable icons (keys 1 to 7). */
const MODES: { m: ViewSettings['mode']; label: string; tip?: string; icon: preact.JSX.Element }[] = [
  { m: 1, label: 'Habitabilité', icon: <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.4" /><path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="#5ee08a" /><path d="M8 2.5a5.5 5.5 0 0 0 0 11z" fill="#ff5f6d" opacity=".8" /></svg> },
  { m: 4, label: 'Valeur et terraformation', icon: <svg viewBox="0 0 16 16"><circle cx="7" cy="9" r="4.5" fill="none" stroke="currentColor" stroke-width="1.4" /><path d="M12.5 1.5v6M10 4l2.5-2.5L15 4" fill="none" stroke="#ffd24a" stroke-width="1.5" /></svg> },
  { m: 2, label: 'Minerais en surface', icon: <svg viewBox="0 0 16 16"><rect x="2" y="7" width="3" height="7" fill="#4f8dff" /><rect x="6.5" y="3" width="3" height="11" fill="#3ecf6e" /><rect x="11" y="9" width="3" height="5" fill="#f2c94c" /></svg> },
  { m: 3, label: 'Concentrations', icon: <svg viewBox="0 0 16 16"><rect x="2" y="5" width="3" height="9" fill="none" stroke="#4f8dff" stroke-width="1.2" /><rect x="6.5" y="8" width="3" height="6" fill="none" stroke="#3ecf6e" stroke-width="1.2" /><rect x="11" y="3" width="3" height="11" fill="none" stroke="#f2c94c" stroke-width="1.2" /></svg> },
  { m: 5, label: 'Population', icon: <svg viewBox="0 0 16 16"><circle cx="8" cy="5" r="2.6" fill="currentColor" /><path d="M3 14c0-3 2.2-5 5-5s5 2 5 5z" fill="currentColor" /></svg> },
  { m: 7, label: 'Statut des empires (alliés, paix, guerre)', icon: <svg viewBox="0 0 16 16"><path d="M3.5 15V1.5" stroke="currentColor" stroke-width="1.4" /><path d="M4 2h8.5l-2 3 2 3H4z" fill="#ffd24a" /><circle cx="11" cy="12" r="2.5" fill="none" stroke="#ff4d4d" stroke-width="1.5" /></svg> },
  { m: 8, label: 'Radar', tip: 'Radar : seulement les vaisseaux ennemis détectés, en rouge ceux qui sont sur votre territoire ou s\'y rendent', icon: <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.1" opacity=".75" /><circle cx="8" cy="8" r="3.4" fill="none" stroke="currentColor" stroke-width="1" opacity=".5" /><path d="M8 8L13.6 4.7A6.5 6.5 0 0 1 14.5 8Z" fill="#5ee08a" opacity=".55" /><path d="M8 8L13.6 4.7" stroke="#5ee08a" stroke-width="1.3" /><circle cx="10.8" cy="10.6" r="1.4" fill="#ff4d4d" /></svg> },
  { m: 6, label: 'Épuré', icon: <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.2" fill="currentColor" /></svg> },
];
function ModeBar({ mode }: { mode: ViewSettings['mode'] }) {
  const cur = MODES.find(x => x.m === mode);
  return <div class="modebar" data-tut="modes" role="group" aria-label="Ce que montrent les planètes">
    {MODES.map(x => <button class={'mode-btn' + (x.m === mode ? ' on' : '')} aria-pressed={x.m === mode} title={`${x.tip ?? x.label} (touche ${x.m})`} aria-label={x.label} onClick={() => setMode(x.m)}>{x.icon}</button>)}
    <span class="mode-name">{cur?.label.replace(/ \(.*\)/, '')}</span>
  </div>;
}

/** 3.6: radar mode, what the scanners see of the enemy. */
function RadarSummary() {
  const s = useStore();
  const list = radarContacts(s.game!, s.me!);
  const threats = list.filter(c => c.threat);
  const first = threats.find(c => c.threat === 'inside') ?? threats[0];
  if (!list.length) return <>Aucun vaisseau ennemi dans vos scanners.</>;
  return <>{list.length} contact{list.length > 1 ? 's' : ''} hostile{list.length > 1 ? 's' : ''} détecté{list.length > 1 ? 's' : ''} · {threats.length ? <b class="red">{threats.length} menace{threats.length > 1 ? 's' : ''}</b> : 'aucune menace'}{first && <> · <button class="lnk" onClick={() => s.focus({ kind: 'fleet', id: first.id }, first)}>{first.threat === 'inside' ? 'voir l\'intrus' : 'voir la menace'}</button></>}</>;
}
function RadarLegend() {
  return <>
    <span title="Sur votre territoire, ou dont la route (observée ces dernières années) ou le raid annoncé y mène"><i class="lg radar threat" />Menace</span>
    <span><i class="lg radar foe" />Ennemi détecté</span>
    <span title="Contact anonyme : propriétaire inconnu"><i class="lg radar unknown" />Non identifié</span>
    <span><i class="lg radar cover" />Couverture des scanners</span>
  </>;
}

export function MapPage() {
  const s = useStore();
  const g = s.game!, me = s.me!;
  const v = s.view;
  const analysed = me.intel.planets.filter(p => p.year !== undefined).length;
  const pen = Math.max(0, ...viewScanners(g, me).map(x => x.pen));
  return <section class="mappage">
    <header class="map-head">
      <div class="map-title"><h2>Carte galactique</h2><div class="page-sub">{v.mode === 8 ? <RadarSummary /> : <>{analysed} systèmes analysés sur {g.planets.length} · {pen > 0 ? `analyse à distance jusqu'à ${pen} al` : 'analyse en orbite uniquement'}</>}</div></div>
      <div class="map-ctrls">
        {([['names', 'Noms'], ['paths', 'Trajets'], ['scan', 'Scanners'], ...(g.settings.culture ? [['borders', 'Frontières']] : [])] as [Toggle, string][]).map(([k, l]) => <label class="chk tog"><input type="checkbox" checked={k === 'borders' ? v.borders !== false : !!v[k]} onChange={() => k === 'borders' ? (store.view.borders = v.borders === false, store.savePrefs(), store.bump()) : toggle(k)} /> {l}</label>)}
        <ModeBar mode={v.mode} />
        <div class="zoomgrp" data-tut="zoom">
          <button onClick={() => s.setCamera({ ...s.camera, zoom: Math.max(0.15, s.camera.zoom / 1.25) })} title="Dézoomer (−)" aria-label="Dézoomer">−</button>
          <button onClick={fitGalaxy} title="Toute la galaxie">Centrer</button>
          <button onClick={() => s.setCamera({ ...s.camera, zoom: Math.min(12, s.camera.zoom * 1.25) })} title="Zoomer (+)" aria-label="Zoomer">+</button>
        </div>
        <button class={'ghost touch-only' + (s.wpMode ? ' on' : '')} disabled={s.selected?.kind !== 'fleet' || s.commanded?.kind !== 'fleet'} title="Chaque toucher de la carte donne une étape à la flotte sélectionnée (équivaut à Maj+clic)" onClick={() => { s.wpMode = !s.wpMode; s.bump(); }}>✚ Étapes</button>
        <MapMore />
      </div>
    </header>
    <div class="map-area">
      <MapView />
      <div class="legend" data-tut="legend">
        {v.mode === 8 ? <RadarLegend /> : <><span><i class="lg own" />Votre empire</span>{v.mode === 7 ? <><span><i class="lg rel ally" />Alliés</span><span><i class="lg rel peace" />En paix</span><span><i class="lg rel war" />En guerre</span></> : <span><i class="lg other" />Autres empires</span>}<span><i class="lg good" />Favorable</span><span><i class="lg bad" />Défavorable</span><span><i class="lg unk" />Inexploré</span>
        {v.scan && <><span><i class="lg ring red" />Détection</span><span><i class="lg ring yel" />Analyse</span></>}</>}
        {v.borders !== false && closersOf(g, me.id).length > 0 && <span title="Territoires dont les frontières vous sont fermées : y entrer déclare la guerre à leur empire (page Diplomatie)"><i class="lg shut" />Frontières fermées</span>}
        {g.settings.terrain && (g.terrain?.length ?? 0) > 0 && <><span title="Scanners deux fois plus courts, Warp limité à 6"><i class="lg ter neb" />Nébuleuse</span><span title="Planètes riches, Warp limité à 5"><i class="lg ter clu" />Amas</span><span title="Boucliers réduits de moitié en combat ; la tempête se déplace chaque année"><i class="lg ter sto" />Tempête</span></>}
      </div>
    </div>
    <ReportsStrip />
  </section>;
}

function ReportsStrip() {
  // 0.3.9.20: the arrows move through the reports without rendering the rest of the interface again
  const s = useChannel('reports');
  const g = s.game!, me = s.me!;
  const msgs = me.messages;
  const n = msgs.length;
  const i = Math.min(s.messageIndex, Math.max(0, n - 1));
  const m = msgs[i];
  return <div class="repstrip" data-tut="reports">
    <div class="rep-main">
      <div class="rep-head">Derniers rapports · {g.year}{n ? ` · ${i + 1} / ${n}` : ''} · <b>{n} nouveau{n > 1 ? 'x' : ''} rapport{n > 1 ? 's' : ''} cette année</b></div>
      <div class={'rep-text kind-' + (m?.kind ?? 'info') + (m?.target ? ' go' : '')} onClick={() => m?.target && gotoTarget(m.target)} title={m?.target ? 'Aller à l\'objet (Entrée sur la ligne)' : ''}>{m ? <MsgText g={g} me={me} m={m} /> : 'Aucun rapport cette année.'}</div>
      <TodoBar />
    </div>
    <div class="rep-btns">
      <button class="icon" onClick={() => s.setMessageIndex(Math.max(0, i - 1))} disabled={i <= 0} title="Rapport précédent (↑)" aria-label="Rapport précédent">↑</button>
      <button class="icon" onClick={() => s.setMessageIndex(Math.min(n - 1, i + 1))} disabled={i >= n - 1} title="Rapport suivant (↓)" aria-label="Rapport suivant">↓</button>
      <button onClick={() => s.goTab('reports')}>Tous les rapports</button>
    </div>
  </div>;
}

// ------------------------------------------------------------------ colonies

/** 3.6: one order for several colonies: an item at the end or the head of their queues, a template, or empty queues. */
function BulkBar({ picked, all, setPicked }: { picked: number[]; all: number[]; setPicked: (ids: number[]) => void }) {
  const s = useStore();
  const g = s.game!, me = s.me!;
  const [key, setKey] = useState('');
  const [qty, setQty] = useState(10);
  const [sure, setSure] = useState(false);
  if (!picked.length) return <div class="bulk-bar muted small"><button class="small" onClick={() => setPicked(all)}>Tout sélectionner</button> Cochez des colonies pour leur donner le même ordre de production d'un coup.</div>;
  // every item available on at least one of them, with the number of colonies that can take it
  const keyOf = (it: { kind: string; designId?: number; megaId?: string; cultureId?: string; bountyOn?: number }) => [it.kind, it.designId ?? '', it.megaId ?? '', it.cultureId ?? '', it.bountyOn ?? ''].join('|');
  const opts = new Map<string, { item: ReturnType<typeof availableItems>[number]; n: number }>();
  for (const id of picked) for (const it of availableItems(g, g.planets[id])) {
    const k = keyOf(it), o = opts.get(k);
    if (!it.disabled) { if (o) o.n++; else opts.set(k, { item: it, n: 1 }); } else if (!o) opts.set(k, { item: it, n: 0 });
  }
  const list = [...opts.entries()].filter(([, o]) => o.n > 0);
  // 0.3.9.21: the item chosen, while some picked colony can still take it; otherwise the first one, shown as such
  const k0 = list.some(([k]) => k === key) ? key : list[0]?.[0] ?? '';
  const cur = k0 ? opts.get(k0) : undefined;
  const go = (atStart: boolean) => {
    if (!cur) return;
    const n = A.queueAddMany(picked, cur.item, qty, atStart);
    s.notify(n ? (atStart ? `${cur.item.label} ajouté en tête de la file de ${n} colonie${n > 1 ? 's' : ''}.` : `${cur.item.label} ajouté à la fin de la file de ${n} colonie${n > 1 ? 's' : ''}.`) : 'Aucune des colonies choisies ne peut le construire.');
  };
  return <div class="bulk-bar">
    <b>{picked.length} colonie{picked.length > 1 ? 's' : ''}</b>
    <select value={k0} onChange={e => setKey((e.target as HTMLSelectElement).value)}>{list.map(([k, o]) => <option value={k}>{o.item.label}{o.n < picked.length ? ` (${o.n}/${picked.length})` : ''}</option>)}</select>
    <Num value={qty} min={1} onChange={v => setQty(Math.max(1, v))} width={64} />
    <button class="primary small" disabled={!cur} onClick={() => go(false)}>Ajouter en fin de file</button>
    <button class="small" disabled={!cur} onClick={() => go(true)}>En tête</button>
    <select onChange={e => { const v = +(e.target as HTMLSelectElement).value; if (v) { A.applyTemplateMany(picked, v, true); s.notify(`Modèle « ${me.templates.find(t => t.id === v)?.name} » appliqué à ${picked.length} colonie${picked.length > 1 ? 's' : ''} (leurs éléments automatiques remplacés).`); } (e.target as HTMLSelectElement).value = ''; }}>
      <option value="">Appliquer un modèle…</option>{me.templates.map(t => <option value={t.id}>{t.name}</option>)}
    </select>
    {!sure ? <button class="small danger" onClick={() => setSure(true)}>Vider les files…</button> : <><button class="small danger" onClick={() => { A.clearQueues(picked); setSure(false); s.notify(`Files vidées (${picked.length}).`); }}>Confirmer : vider {picked.length} file{picked.length > 1 ? 's' : ''}</button><button class="small" onClick={() => setSure(false)}>Annuler</button></>}
    <span class="sp" />
    <button class="small ghost" onClick={() => setPicked(all)}>Tout</button>
    <button class="small ghost" onClick={() => setPicked([])}>Aucune</button>
  </div>;
}

export function ColoniesPage() {
  const s = useStore();
  const g = s.game!, me = s.me!;
  const rows = g.planets.filter(p => p.owner === me.id).map(p => {
    const sp = viewSpec(g, p, me);
    const est = p.queue.length ? viewQueue(g, p, 50) : [];
    const k = p.queue.findIndex(q => !isAuto(q.kind));
    return { p, sp, est, cur: k >= 0 ? p.queue[k] : p.queue[0], years: k >= 0 ? est[k]?.lastYear ?? null : null, blocked: k >= 0 && !!est[k]?.blocked, dropped: k >= 0 && est[k]?.dropped !== undefined };
  });
  const tot = rows.reduce((a, r) => ({ pop: a.pop + r.p.pop, res: a.res + r.sp.resources, fe: a.fe + r.p.surface.ironium, bo: a.bo + r.p.surface.boranium, ge: a.ge + r.p.surface.germanium }), { pop: 0, res: 0, fe: 0, bo: 0, ge: 0 });
  const sel = s.selected;
  const pickRow = (p: Planet) => { s.select({ kind: 'planet', id: p.id }); };
  // 3.6: several colonies picked at once, for the same production order
  const [picked, setPicked] = useState<number[]>([]);
  const live = picked.filter(id => g.planets[id]?.owner === me.id);
  const togglePick = (id: number) => setPicked(live.includes(id) ? live.filter(x => x !== id) : [...live, id]);
  return <Page title="Vos colonies" sub={<>{rows.length} colonie{rows.length > 1 ? 's' : ''} · {fmtPop(tot.pop)} habitants · {fmt(tot.res)} ressources/an · minerais <MineralLine m={{ ironium: tot.fe, boranium: tot.bo, germanium: tot.ge }} unit=" kt" /></>}
    actions={<button onClick={() => s.open('templates')}>Modèles de production…</button>}>
    <BulkBar picked={live} all={rows.map(r => r.p.id)} setPicked={setPicked} />
    <SortTable csv="colonies" rows={rows} onRow={r => pickRow(r.p)} onDbl={r => s.focus({ kind: 'planet', id: r.p.id }, r.p)} isSel={r => sel?.kind === 'planet' && sel.id === r.p.id} initial="pop" initialDir={-1} cols={[
      { key: 'pick', label: '✓', csv: false, get: r => live.includes(r.p.id) ? 0 : 1, render: r => <input type="checkbox" class="pick" checked={live.includes(r.p.id)} onClick={e => { e.stopPropagation(); togglePick(r.p.id); }} aria-label={`Sélectionner ${r.p.name}`} /> },
      { key: 'name', label: 'Planète', get: r => r.p.name, render: r => <>{r.p.name}{r.p.homeworld ? <span class="tag">natal</span> : ''}{g.settings.distanceCost && r.p.regionalCapital ? <span class="tag">capitale rég.</span> : ''}{r.p.migration ? <span class="tag dim" title={r.p.migration.mode === 'out' ? `Émigration au-delà de ${r.p.migration.target} % de la population maximale` : `Immigration jusqu'à ${r.p.migration.target} % de la population maximale`}>{r.p.migration.mode === 'out' ? 'émigration' : 'immigration'}</span> : ''}{r.p.mineralPolicy ? <span class="tag dim">{r.p.mineralPolicy.mode === 'export' ? 'exporte' : 'importe'}</span> : ''}{r.p.starbase ? <span class="tag dim">station</span> : ''}</> },
      { key: 'hab', label: 'Habit.', num: true, get: r => r.sp.hab, render: r => <span class={r.sp.hab > 0 ? 'good' : 'bad'}>{r.sp.hab} %</span> },
      { key: 'pop', label: 'Population', num: true, get: r => r.p.pop, render: r => <span class={r.p.pop > r.sp.maxPop ? 'red' : ''}>{fmtPop(r.p.pop)}</span> },
      { key: 'res', label: 'R/an', num: true, get: r => r.sp.resources },
      ...(g.settings.distanceCost ? [{ key: 'eff', label: 'Rend.', num: true, get: (r: typeof rows[number]) => r.sp.efficiency.total, render: (r: typeof rows[number]) => <span class={r.sp.efficiency.total < 0.65 ? 'red' : r.sp.efficiency.total < 0.9 ? 'yellow' : ''} title={r.sp.efficiency.nearest ? `à ${Math.round(r.sp.efficiency.distance)} al de ${r.sp.efficiency.nearest.name}` : ''}>{pct(r.sp.efficiency.total)}</span> }] : []),
      { key: 'prod', label: 'Production', get: r => r.years ?? (r.cur ? 999 : 1000), csv: r => !r.cur ? 'file vide' : `${itemLabel(g, r.cur)}${r.cur.qty > 1 ? ` ×${r.cur.qty}` : ''}${isAuto(r.cur.kind) ? '' : r.blocked ? ' (bloqué)' : r.dropped ? ' (sans objet)' : r.years === null ? ' (plus de 50 ans)' : r.years === 1 ? ' (cette année)' : ` (${r.years} ans)`}`, render: r => !r.cur ? <span class="red">file vide</span> : isAuto(r.cur.kind) ? <span class="muted">{itemLabel(g, r.cur)}</span> : <>{itemLabel(g, r.cur)}{r.cur.qty > 1 ? ` ×${r.cur.qty}` : ''} <span class={(r.blocked ? 'red small' : !r.dropped && (r.years ?? 99) >= 5 ? 'yellow small' : 'muted small') + (r.blocked || (!r.dropped && (r.years ?? 99) >= 5) ? ' slow-why' : '')} title={r.blocked || (!r.dropped && (r.years ?? 99) >= 5) ? `${r.blocked ? 'Bloqué' : 'Ce qui le retarde'} : ${queueBottleneck(g, r.p, r.p.queue.indexOf(r.cur!), r.est).text}` : undefined}>· {r.blocked ? 'bloqué' : r.dropped ? 'sans objet' : r.years === null ? 'plus de 50 ans' : r.years === 1 ? 'cette année' : `${r.years} ans`}</span></> },
      { key: 'mines', label: 'Mines', num: true, get: r => r.p.mines, render: r => <span class={r.p.mines > r.sp.maxMines ? 'red' : ''}>{r.p.mines}</span> },
      { key: 'fact', label: 'Usines', num: true, get: r => r.p.factories, render: r => <span class={r.p.factories > r.sp.maxFactories ? 'red' : ''}>{r.p.factories}</span> },
      { key: 'def', label: 'Déf.', num: true, get: r => r.p.defenses },
      { key: 'min', label: 'Minerais (kt)', num: true, get: r => r.p.surface.ironium + r.p.surface.boranium + r.p.surface.germanium, render: r => <MineralLine m={r.p.surface} />, minerals: r => r.p.surface },
      { key: 'cap', label: 'Rempl.', num: true, get: r => r.sp.maxPop ? r.p.pop / r.sp.maxPop : 0, render: r => pct(r.sp.maxPop ? r.p.pop / r.sp.maxPop : 0) },
    ]} />
    <p class="small muted">Clic : afficher la planète à droite · double-clic : la montrer sur la carte. La colonne Production indique le premier élément non automatique de la file et le nombre d'années avant qu'il soit terminé.</p>
  </Page>;
}

// ------------------------------------------------------------------ planner

const near = (own: Planet[], id: number) => own.find(o => o.id === id)?.name;

export function PlannerPage() {
  const s = useStore();
  const g = s.game!, me = s.me!;
  const [freeOnly, setFreeOnly] = useState(true);
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(40);
  const [open, setOpen] = useState<number | null>(null);
  const mine = g.planets.filter(p => p.owner === me.id);
  const analysed = me.intel.planets.filter(pi => pi.hab);
  const range = rangeOf('planner');
  const arkCache = new Map<number, number>();
  const arkYears = (r: { pl: Planet; free: boolean; val: number; terr: number | null }) => {
    if (!r.free || r.val <= 0) return 9999;
    if (r.terr !== null) return 9997; // in a foreign territory: no colony possible
    let v = arkCache.get(r.pl.id);
    if (v === undefined) {
      const m = missionModel(g, me, r.pl, 'colonize');
      v = m.st.arks.length ? Math.min(...m.st.arks.map(a => a.arrival)) : m.send.length ? Math.min(...m.send.map(o => o.years)) : m.build.filter(o => o.reachable).length ? Math.min(...m.build.filter(o => o.reachable).map(o => o.total)) : 9998;
      arkCache.set(r.pl.id, v);
    }
    return v;
  };
  const rows = analysed.map(pi => {
    const pl = g.planets[pi.id];
    const val = habitability(me.race, pi.hab!);
    const tf = terraformedHabValue(me, { ...pl, hab: pi.hab!, baseHab: pi.baseHab ?? pi.hab! });
    const { d: nd, ref } = rangeDistance(range, mine, pl);
    const near = ref as Planet | null;
    const maxPop = val > 0 ? prospectiveMaxPop(g, me, { ...pl, hab: pi.hab! }, val) : 0;
    const owner = pi.owner;
    const conc = pi.conc ? pi.conc.ironium + pi.conc.boranium + pi.conc.germanium : -1;
    const free = owner === undefined || owner < 0;
    const terr = free ? colonyBlocker(g, me, pl, true) : null;
    return { pi, pl, val, tf, near, nd, maxPop, conc, free, mineP: owner === me.id, owner, terr };
  }).filter(r => (!freeOnly || r.free) && r.pl.name.toLowerCase().includes(q.toLowerCase()) && (range.max === null || r.nd <= range.max))
    .sort((a, b) => b.val - a.val || b.tf - a.tf || a.nd - b.nd);
  const { sorted, th } = useSorted(rows, [
    { key: 'name', get: r => r.pl.name }, { key: 'val', get: r => r.val, num: true }, { key: 'tf', get: r => r.tf, num: true },
    { key: 'owner', get: r => r.mineP ? 'A' : r.free ? (r.terr !== null ? 'B2' : 'B') : 'C' + g.players[r.owner!].name }, { key: 'dist', get: r => r.nd, num: true },
    { key: 'conc', get: r => r.conc, num: true }, { key: 'pop', get: r => r.maxPop, num: true },
    // the quickest worlds to settle: an ark on its way, a ready ark, or one to build (build + trip)
    { key: 'ark', get: r => arkYears(r), num: true, asc: true },
  ], 'val', -1);
  const shown = sorted.slice(0, limit);
  return <Page title="Planificateur de colonies" sub={<>{rows.length} monde{rows.length > 1 ? 's' : ''} affiché{rows.length > 1 ? 's' : ''} sur {analysed.length} analysé{analysed.length > 1 ? 's' : ''} · {me.race.pluralName}</>}>
    <div class="planner-head">
      <label class="field">Rechercher une étoile<input placeholder="Nom du système" value={q} onInput={e => setQ((e.target as HTMLInputElement).value)} /></label>
      <label class="chk"><input type="checkbox" checked={freeOnly} onChange={e => setFreeOnly((e.target as HTMLInputElement).checked)} /> Mondes libres uniquement</label>
      <RangeFilter page="planner" own={mine} />
      <span class="muted small">Selon le dernier relevé. Cliquez sur un en-tête pour trier.</span>
    </div>
    <div class="report-scroll"><table class="report planner">
      <thead><tr>{th('name', 'Étoile')}{th('val', 'Habitabilité', { title: 'Population maximale en dessous' })}{th('tf', 'Terraformée')}{th('owner', 'Occupation')}{th('dist', range.from >= 0 && near(mine, range.from) ? `Distance de ${near(mine, range.from)}` : 'Plus proche colonie', { num: false })}{th('conc', 'Minerais', { num: false, title: 'Concentrations en ironium / boranium / germanium (tri par total)' })}{th('ark', 'Arche', { num: false, title: 'Trier par délai de colonisation : arche en route, arche prête, ou à construire (construction + trajet)' })}</tr></thead>
      <tbody>{shown.map(r => {
        const age = g.year - r.pi.year!;
        const canAct = r.free && r.val > 0;
        const m = canAct ? missionModel(g, me, r.pl, 'colonize') : null;
        return <>
          <tr class={s.selected?.kind === 'planet' && s.selected.id === r.pl.id ? 'sel' : ''} data-tut={'plan-' + r.pl.id} onClick={() => s.select({ kind: 'planet', id: r.pl.id })} onDblClick={() => s.focus({ kind: 'planet', id: r.pl.id }, r.pl)}>
            <td><b class="pname">{r.pl.name}</b>{r.pi.guardian && <span class="tag guard" title="Un gardien veille sur ce monde : il attaque toute flotte qui s'y arrête">gardé</span>}<div class="muted small">{r.mineP ? 'Données de votre colonie' : `Relevé ${r.pi.year}${age > 0 ? ` (il y a ${age} a)` : ''}`}</div></td>
            <td class="num"><span class={r.val > 0 ? 'good' : 'bad'}>{r.val} %</span>{r.maxPop > 0 && <div class="muted small">{fmtPop(r.maxPop)} hab. max</div>}</td>
            <td class="num">{r.tf !== r.val ? <span class={r.tf > 0 ? 'good' : 'bad'}>{r.tf} %</span> : <span class="muted">—</span>}</td>
            <td>{r.mineP ? 'Votre colonie' : r.free ? (r.terr !== null ? <span title="Dans leur territoire culturel : impossible d'y fonder une colonie">Libre<div class="small" style={{ color: g.players[r.terr].color }}>territoire des {g.players[r.terr].name}</div></span> : 'Libre') : <span style={{ color: g.players[r.owner!].color }}>{g.players[r.owner!].name}</span>}</td>
            <td>{r.near ? <>{fmt(r.nd, 0)} al<div class="muted small">{r.near.name}</div></> : '—'}</td>
            <td>{r.pi.conc ? <MineralLine m={r.pi.conc} /> : '?'}</td>
            <td class="actions" onClick={e => e.stopPropagation()}>{!m ? <span class="muted small">{r.mineP ? 'déjà colonisée' : !r.free ? 'occupée' : r.tf > 0 ? 'à terraformer d\'abord' : 'hostile'}</span> : <div class="plan-act">
              {m.st.arks.length > 0 && <div class="status small">En route, arrivée {g.year + m.st.arks[0].arrival}</div>}
              {m.st.queued.some(x => x.kind === 'colonize') && <div class="status small">En construction à {m.st.queued.find(x => x.kind === 'colonize')!.planet.name}</div>}
              <div class="mission-btns"><MissionButton g={g} p={r.pl} m={m} short /><button class="ghost icon" onClick={() => setOpen(open === r.pl.id ? null : r.pl.id)} aria-expanded={open === r.pl.id} title="Options : choisir une autre arche, un autre modèle ou un autre chantier" aria-label="Options">⋯</button></div>
            </div>}</td>
          </tr>
          {open === r.pl.id && <tr class="opts-row"><td colSpan={7}><MissionOptions g={g} me={me} p={r.pl} kind="colonize" onDone={() => setOpen(null)} /></td></tr>}
        </>;
      })}</tbody>
    </table></div>
    {rows.length > limit && <button class="small" onClick={() => setLimit(limit + 40)}>Afficher 40 mondes de plus</button>}
    {analysed.length === 0 && <p class="muted">Aucun monde analysé pour l'instant : envoyez vos éclaireurs.</p>}
    <p class="small muted">« Envoyer une arche » choisit l'arche prête la plus rapide à arriver. Sans arche disponible, « Construire et envoyer » choisit le chantier qui offre le meilleur compromis entre délai de construction et durée du voyage ; l'arche part seule une fois construite. Quand une arche est déjà en route ou en chantier, le bouton est grisé : « Options » permet quand même d'en envoyer ou d'en construire une autre. Les mondes inexplorés n'apparaissent pas ici.</p>
  </Page>;
}

// ------------------------------------------------------------------ mining planner

export function MiningPage() {
  const s = useStore();
  const g = s.game!, me = s.me!;
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(40);
  const [open, setOpen] = useState<{ id: number; kind: 'mine' | 'haul' } | null>(null);
  const [hideHab, setHideHab] = useState(true);
  // 3.6: opened from a slow queue line: worlds near that planet with enough of the missing mineral
  const [focus, setFocus] = useState<{ from: number; mineral: 'ironium' | 'boranium' | 'germanium'; short: number } | null>(s.tabData?.focus ?? null);
  useEffect(() => { if (focus) { const r = rangeOf('mining'); if (r.from !== focus.from || r.max === null) setRangeOf('mining', { from: focus.from, max: Math.max(r.from === focus.from && r.max ? r.max : 0, 200) }); } }, []);
  const mine = g.planets.filter(p => p.owner === me.id);
  const best = missionDesigns(g, me, 'mine')[0];
  const rate = best ? designSpec(me, best).miningRate : 0;
  const range = rangeOf('mining');
  const exploited = exploitedWorlds(g, me);
  const busyIds = new Set(exploited.map(x => x.pl.id));
  const rows = me.intel.planets.filter(pi => pi.conc && pi.year !== undefined && !busyIds.has(pi.id) && canMineHere(g, me, pi.id)).map(pi => {
    const pl = g.planets[pi.id];
    const { d: nd, ref } = rangeDistance(range, mine, pl);
    const near = ref as Planet | null;
    const y = miningYield(pi.conc!, rate || 10);
    const total = y.ironium + y.boranium + y.germanium;
    // habitability for our race: a good world is better colonised than mined
    const hab = pi.hab ? habitability(me.race, pi.hab) : null;
    return { pi, pl, near, nd, y, total, hab };
  }).filter(r => r.pl.name.toLowerCase().includes(q.toLowerCase()) && (!hideHab || r.hab === null || r.hab <= 0) && (range.max === null || r.nd <= range.max)
    // enough to make the difference: in stock on the surface, or within ten years of mining
    && (!focus || (r.pi.surface?.[focus.mineral] ?? 0) >= focus.short || r.y[focus.mineral] * 10 >= focus.short))
    .sort((a, b) => b.total - a.total || a.nd - b.nd);
  const sum = (m?: { ironium: number; boranium: number; germanium: number }) => m ? m.ironium + m.boranium + m.germanium : -1;
  const { sorted, th, btn } = useSorted(rows, [
    { key: 'name', get: r => r.pl.name }, { key: 'hab', get: r => r.hab ?? -999, num: true }, { key: 'conc', get: r => sum(r.pi.conc), num: true },
    { key: 'total', get: r => r.total, num: true }, { key: 'fe', get: r => r.y.ironium, num: true }, { key: 'bo', get: r => r.y.boranium, num: true }, { key: 'ge', get: r => r.y.germanium, num: true },
    { key: 'surf', get: r => sum(r.pi.surface), num: true }, { key: 'dist', get: r => r.nd, num: true },
  ], focus ? ({ ironium: 'fe', boranium: 'bo', germanium: 'ge' } as const)[focus.mineral] : 'total', -1);
  const shown = sorted.slice(0, limit);
  const working = g.fleets.filter(f => f.owner === me.id && viewFleet(g, f).miningRate > 0);
  const totX = exploited.reduce((a, x) => a + x.extraction, 0), totF = exploited.reduce((a, x) => a + x.flow, 0);
  const optsRow = (pl: Planet, cols: number) => open?.id === pl.id && <tr class="opts-row"><td colSpan={cols}>{open.kind === 'mine' ? <MissionOptions g={g} me={me} p={pl} kind="mine" onDone={() => setOpen(null)} /> : <HaulBlock g={g} me={me} p={pl} compact onDone={() => setOpen(null)} />}</td></tr>;
  const toggle = (pl: Planet, k: 'mine' | 'haul') => setOpen(open?.id === pl.id && open.kind === k ? null : { id: pl.id, kind: k });
  return <Page title="Planificateur de minage" sub={<>{exploited.length} monde{exploited.length > 1 ? 's' : ''} exploité{exploited.length > 1 ? 's' : ''} · {rows.length} à exploiter · {working.length} vaisseau{working.length > 1 ? 'x' : ''} de minage · {best ? <>rendement calculé pour {best.name} ({rate} robots)</> : 'aucun modèle de vaisseau de minage : créez-en un dans Conception'}</>}>
    {exploited.length > 0 && <section class="mine-sec">
      <h3>Mondes exploités <span class="muted small">extraction ≈ {fmt(totX)} kt/an · navettes ≈ {fmt(totF)} kt/an</span></h3>
      <ExploitedTable g={g} me={me} list={exploited} open={open} toggle={toggle} optsRow={optsRow} />
    </section>}
    <section class="mine-sec">
      <h3>Mondes à exploiter</h3>
      {focus && <div class="alert info mine-focus">Il manque environ {fmt(focus.short)} kt {focus.mineral === 'ironium' ? 'd\'' : 'de '}{focus.mineral} à {g.planets[focus.from].name} : voici les mondes proches qui en ont assez (en surface, ou en dix ans de forage), triés par rendement en {focus.mineral}. Le réseau logistique (politique « Importer » sur {g.planets[focus.from].name}) ou un cargo peuvent ensuite l'y apporter. <button class="small" onClick={() => setFocus(null)}>Tout afficher</button></div>}
      <div class="planner-head">
        <label class="field">Rechercher une étoile<input placeholder="Nom du système" value={q} onInput={e => setQ((e.target as HTMLInputElement).value)} /></label>
        <label class="chk" title="Un monde habitable pour votre race vaut souvent mieux comme colonie que comme mine"><input type="checkbox" checked={hideHab} onChange={e => setHideHab((e.target as HTMLInputElement).checked)} /> Masquer les mondes habitables</label>
        <RangeFilter page="mining" own={mine} />
        <span class="muted small">Cliquez sur un en-tête pour trier (Fe, B, Ge : rendement de chaque minerai).</span>
      </div>
      <div class="report-scroll"><table class="report planner">
        <thead><tr>{th('name', 'Étoile')}{th('hab', 'Habitabilité', { title: 'Habitabilité pour votre race : un monde favorable mérite plutôt une colonie' })}{th('conc', 'Concentrations', { num: false, title: 'Concentrations ironium / boranium / germanium (tri par total)' })}{th('total', <>Rendement / an<span class="yield-sub">{btn('fe', 'Fe', 'Trier par ironium extrait')}{btn('bo', 'B', 'Trier par boranium extrait')}{btn('ge', 'Ge', 'Trier par germanium extrait')}</span></>)}{th('surf', 'En surface', { num: false, title: 'Minerais déjà en surface (tri par total)' })}{th('dist', range.from >= 0 && near(mine, range.from) ? `Distance de ${near(mine, range.from)}` : 'Plus proche colonie', { num: false })}<th>Vaisseau de minage</th></tr></thead>
        <tbody>{shown.map(r => {
          const age = g.year - r.pi.year!;
          return <>
            <tr class={s.selected?.kind === 'planet' && s.selected.id === r.pl.id ? 'sel' : ''} onClick={() => s.select({ kind: 'planet', id: r.pl.id })} onDblClick={() => s.focus({ kind: 'planet', id: r.pl.id }, r.pl)}>
              <td><b class="pname">{r.pl.name}</b>{r.pi.guardian && <span class="tag guard" title="Un gardien veille sur ce monde : il attaque toute flotte qui s'y arrête">gardé</span>}<div class="muted small">Relevé {r.pi.year}{age > 0 ? ` (il y a ${age} a)` : ''}</div></td>
              <td class="num">{r.hab === null ? <span class="muted">?</span> : <span class={r.hab > 0 ? 'good' : 'bad'} title={r.hab > 0 ? 'Monde habitable : à coloniser plutôt qu\'à miner ?' : 'Monde hostile pour votre race'}>{r.hab} %</span>}{r.hab !== null && r.hab >= 25 && <div class="small yellow">à coloniser ?</div>}</td>
              <td><MineralLine m={r.pi.conc!} /></td>
              <td class="num"><MineralLine m={r.y} /><div class="muted small">{fmt(r.total)} kt/an</div></td>
              <td>{r.pi.surface ? <><MineralLine m={r.pi.surface} /> kt</> : <span class="muted">?</span>}</td>
              <td>{r.near ? <>{fmt(r.nd, 0)} al<div class="muted small">{r.near.name}</div></> : '—'}</td>
              <td class="actions" onClick={e => e.stopPropagation()}><MiningAction pl={r.pl} open={open?.id === r.pl.id ? open.kind : null} toggle={k => toggle(r.pl, k)} /></td>
            </tr>
            {optsRow(r.pl, 7)}
          </>;
        })}</tbody>
      </table></div>
      {rows.length > limit && <button class="small" onClick={() => setLimit(limit + 40)}>Afficher 40 mondes de plus</button>}
      {rows.length === 0 && <p class="muted">Aucun autre monde libre analysé{range.max !== null ? ` à moins de ${range.max} al` : ''} pour l'instant.</p>}
    </section>
    <p class="small muted">Le minage à distance ne fonctionne que sur les mondes inhabités. Un vaisseau équipé de robots foreurs, en orbite avec la tâche « Minage à distance », extrait chaque année des minerais selon la concentration de la planète et les dépose à sa surface ; une navette (un cargo en allers-retours) vient les chercher pour la capitale ou le port choisi. Dans « Mondes exploités », « + Foreuse » ajoute un vaisseau de minage et « + Navette » un cargo, prêt ou à construire. Les concentrations baissent lentement à l'usage. Un monde habitable pour votre race vaut souvent mieux comme colonie.</p>
  </Page>;
}

interface Exploited { pl: Planet; st: MissionStatus; extraction: number; yearly: { ironium: number; boranium: number; germanium: number }; flow: number; robots: number; minable: boolean; nd: number; near: Planet | null }

/** Worlds where your mining ships work, are heading, are being built for, or that your shuttles serve. */
function exploitedWorlds(g: GameState, me: Player): Exploited[] {
  const ids = new Set<number>();
  for (const f of g.fleets) {
    if (f.owner !== me.id) continue;
    if (f.orbiting >= 0 && viewFleet(g, f).miningRate > 0) ids.add(f.orbiting);
    for (const w of [...f.waypoints, ...(f.route ?? [])]) if (w.target === 'planet' && w.targetId !== undefined && (w.task === 'remoteMine' || w.task === 'transport')) ids.add(w.targetId);
  }
  for (const pl of g.planets) if (pl.owner === me.id) for (const it of pl.queue) if (it.mission && (it.mission.kind === 'mine' || it.mission.kind === 'haul')) ids.add(it.mission.planetId);
  const own = g.planets.filter(p => p.owner === me.id);
  const out: Exploited[] = [];
  for (const id of ids) {
    const pl = g.planets[id];
    if (pl.owner === me.id && !raceSpec(me.race).canRemoteMineOwn) continue;
    const st = missionStatus(g, me, id);
    const queued = st.queued.some(x => x.kind === 'mine' || x.kind === 'haul');
    if (!st.mining.length && !st.miners.length && !st.haulers.length && !queued) continue;
    const conc = me.intel.planets[id].conc ?? pl.conc;
    const yearly = { ironium: 0, boranium: 0, germanium: 0 };
    let robots = 0;
    for (const f of st.mining) { const r = viewFleet(g, f).miningRate; robots += r; const y = miningYield(conc, r); yearly.ironium += y.ironium; yearly.boranium += y.boranium; yearly.germanium += y.germanium; }
    const flow = st.haulers.reduce((t, h) => { const cy = haulCycleYears(g, h.fleet, id, h.home.id); return t + (Number.isFinite(cy) && cy > 0 ? viewFleet(g, h.fleet).cargoCapacity / cy : 0); }, 0);
    let near: Planet | null = null, nd = Infinity;
    for (const o of own) { const d = distance(o, pl); if (d < nd) { nd = d; near = o; } }
    out.push({ pl, st, extraction: yearly.ironium + yearly.boranium + yearly.germanium, yearly, flow, robots, minable: canMineHere(g, me, id), nd, near });
  }
  return out.sort((a, b) => b.extraction - a.extraction || a.nd - b.nd);
}

function ExploitedTable({ g, me, list, open, toggle, optsRow }: { g: GameState; me: Player; list: Exploited[]; open: { id: number; kind: 'mine' | 'haul' } | null; toggle: (pl: Planet, k: 'mine' | 'haul') => void; optsRow: (pl: Planet, cols: number) => ComponentChildren }) {
  const s = useStore();
  const sum = (m?: { ironium: number; boranium: number; germanium: number }) => m ? m.ironium + m.boranium + m.germanium : -1;
  const { sorted, th } = useSorted(list, [
    { key: 'name', get: r => r.pl.name }, { key: 'ships', get: r => r.st.mining.length * 100 + r.st.miners.length, num: true },
    { key: 'x', get: r => r.extraction, num: true }, { key: 'surf', get: r => sum(me.intel.planets[r.pl.id].surface), num: true },
    { key: 'flow', get: r => r.flow, num: true }, { key: 'bal', get: r => r.flow - r.extraction, num: true }, { key: 'dist', get: r => r.nd, num: true },
  ], 'natural', 1);
  return <div class="report-scroll"><table class="report planner exploited">
    <thead><tr>{th('name', 'Étoile')}{th('ships', 'Foreuses', { num: false })}{th('x', 'Extraction / an')}{th('surf', 'En surface', { num: false })}{th('flow', 'Navettes', { num: false })}{th('bal', 'Bilan', { num: false, title: 'Débit des navettes moins extraction' })}<th>Ajouter</th></tr></thead>
    <tbody>{sorted.map(r => {
      const pi = me.intel.planets[r.pl.id];
      const mineM = { ...missionModel(g, me, r.pl, 'mine'), busy: false };
      const cap = capitalOf(g, me);
      const haulM = { ...missionModel(g, me, r.pl, 'haul', null, true, false, { homeId: cap?.id }), busy: false };
      const queuedMine = r.st.queued.filter(x => x.kind === 'mine').length, queuedHaul = r.st.queued.filter(x => x.kind === 'haul').length;
      const bal = r.extraction === 0 ? (r.st.haulers.length ? <span class="muted">navettes à vide</span> : <span class="muted">—</span>)
        : !r.st.haulers.length ? <span class="yellow">sans navette : s'accumule</span>
        : r.flow < r.extraction * 0.95 ? <span class="yellow">navettes insuffisantes ({fmt(r.flow - r.extraction)} kt/an)</span>
        : <span class="green">tout est rapatrié</span>;
      return <>
        <tr class={s.selected?.kind === 'planet' && s.selected.id === r.pl.id ? 'sel' : ''} onClick={() => s.select({ kind: 'planet', id: r.pl.id })} onDblClick={() => s.focus({ kind: 'planet', id: r.pl.id }, r.pl)}>
          <td><b class="pname">{r.pl.name}</b>{!r.minable && <span class="tag guard" title="Ce monde n'est plus minable à distance (occupé)">occupé</span>}{pi.guardian && <span class="tag guard">gardé</span>}<div class="muted small">{r.near ? `${fmt(r.nd, 0)} al de ${r.near.name}` : ''}</div></td>
          <td>{r.st.mining.length > 0 ? <div>{r.st.mining.length} en orbite <span class="muted small">({r.robots} robots)</span></div> : null}
            {r.st.miners.map(a => <div class="small">{a.fleet.name} en route, {g.year + a.arrival}</div>)}
            {queuedMine > 0 && <div class="small muted">{queuedMine} en chantier</div>}
            {!r.st.mining.length && !r.st.miners.length && !queuedMine && <span class="muted">aucune</span>}</td>
          <td class="num">{r.extraction > 0 ? <><MineralLine m={r.yearly} /><div class="muted small">{fmt(r.extraction)} kt/an</div></> : <span class="muted">—</span>}</td>
          <td>{pi.surface ? <><MineralLine m={pi.surface} /> kt</> : <span class="muted">?</span>}</td>
          <td>{r.st.haulers.length ? <><div>{r.st.haulers.length} · ≈ {fmt(r.flow)} kt/an</div><div class="muted small">{[...new Set(r.st.haulers.map(h => h.home.name))].join(', ')}</div></> : <span class="muted">aucune</span>}{queuedHaul > 0 && <div class="small muted">{queuedHaul} cargo{queuedHaul > 1 ? 's' : ''} en chantier</div>}</td>
          <td class="small bal">{bal}</td>
          <td class="actions" onClick={e => e.stopPropagation()}><div class="add-btns">
            <div class="mission-btns"><MissionButton g={g} p={r.pl} m={mineM} label={() => '+ Foreuse'} /><button class="ghost icon" onClick={() => toggle(r.pl, 'mine')} aria-expanded={open?.id === r.pl.id && open.kind === 'mine'} title="Choisir le vaisseau, le modèle ou le chantier" aria-label="Options des foreuses">⋯</button></div>
            <div class="mission-btns"><MissionButton g={g} p={r.pl} m={haulM} label={() => '+ Navette'} /><button class="ghost icon" onClick={() => toggle(r.pl, 'haul')} aria-expanded={open?.id === r.pl.id && open.kind === 'haul'} title="Port de livraison, cargo, modèle ou chantier" aria-label="Options des navettes">⋯</button></div>
          </div></td>
        </tr>
        {optsRow(r.pl, 7)}
      </>;
    })}</tbody>
  </table></div>;
}

function MiningAction({ pl, open, toggle }: { pl: Planet; open: 'mine' | 'haul' | null; toggle: (k: 'mine' | 'haul') => void }) {
  const s = useStore();
  const g = s.game!, me = s.me!;
  const m = missionModel(g, me, pl, 'mine');
  const working = m.st.mining.length > 0 || m.st.miners.length > 0;
  return <div class="plan-act">
    {m.st.mining.length > 0 && <div class="status small">{m.st.mining.length} vaisseau{m.st.mining.length > 1 ? 'x' : ''} en train de forer</div>}
    {m.st.miners.length > 0 && <div class="status small">En route, arrivée {g.year + m.st.miners[0].arrival}</div>}
    {m.st.queued.some(x => x.kind === 'mine') && <div class="status small">En construction à {m.st.queued.find(x => x.kind === 'mine')!.planet.name}</div>}
    {m.st.haulers.map(h => <div class="status small">Navette {h.fleet.name} ⇄ {h.home.name}</div>)}
    {m.st.queued.some(x => x.kind === 'haul') && <div class="status small">Cargo de navette en construction</div>}
    <div class="mission-btns"><MissionButton g={g} p={pl} m={m} short /><button class="ghost icon" onClick={() => toggle('mine')} aria-expanded={open === 'mine'} title="Options : choisir un autre vaisseau, un autre modèle ou un autre chantier" aria-label="Options">⋯</button></div>
    {working && <button class={'small' + (m.st.haulers.length ? ' ghost' : '')} onClick={() => toggle('haul')} aria-expanded={open === 'haul'} title="Un cargo vient chercher les minerais et les livre à la capitale (ou au port choisi), en allers-retours">{m.st.haulers.length ? 'Navettes…' : 'Créer une navette…'}</button>}
  </div>;
}

// ------------------------------------------------------------------ fleets

const FLEET_TYPES: [string, string][] = [['all', 'Tous les types'], ['scout', 'Éclaireurs'], ['ark', 'Arches'], ['cargo', 'Cargos'], ['war', 'Navires armés'], ['miner', 'Foreuses'], ['layer', 'Mouilleurs'], ['tanker', 'Ravitailleurs'], ['other', 'Autres']];
function fleetType(sp: ReturnType<typeof fleetSpec>): string {
  if (sp.colonizer) return 'ark';
  if (sp.purposeIcon === 'fuel') return 'tanker';
  if (isPureScout(sp)) return 'scout';
  if (sp.hasWeapons || sp.bomber) return 'war';
  if (sp.miningRate > 0) return 'miner';
  if (sp.mineLaying.standard + sp.mineLaying.heavy + sp.mineLaying.speedBump > 0) return 'layer';
  if (sp.cargoCapacity > 0) return 'cargo';
  return 'other';
}

export function FleetsPage() {
  const s = useStore();
  const g = s.game!, me = s.me!;
  const [type, setType] = useState('all');
  const [design, setDesign] = useState('');
  const [mission, setMission] = useState('all');
  const all = g.fleets.filter(f => f.owner === me.id).map(f => { const sp = viewFleet(g, f); return { f, sp, est: viewRoute(g, f), mi: fleetMission(g, me, f), type: fleetType(sp) }; });
  const rows = all.filter(r => (type === 'all' || r.type === type) && (!design || r.f.tokens.some(t => t.designId === +design)) && (mission === 'all' || (mission === 'idle' ? r.mi.id === 'idle' : r.mi.id !== 'idle')));
  const designs = g.designs.filter(d => d.owner === me.id && !d.starbase && !d.deleted);
  const sel = s.selected;
  return <Page title="Vos flottes" sub={<>{rows.length} sur {all.length} flotte{all.length > 1 ? 's' : ''} · double-cliquez une ligne pour la montrer sur la carte</>}>
    <div class="filters">
      <label class="field">Type de vaisseau<select value={type} onChange={e => setType((e.target as HTMLSelectElement).value)}>{FLEET_TYPES.map(([k, l]) => <option value={k}>{l}</option>)}</select></label>
      <label class="field">Modèle<select value={design} onChange={e => setDesign((e.target as HTMLSelectElement).value)}><option value="">Tous les modèles</option>{designs.map(d => <option value={d.id}>{d.name}</option>)}</select></label>
      <label class="field">Mission<select value={mission} onChange={e => setMission((e.target as HTMLSelectElement).value)}><option value="all">Toutes</option><option value="idle">Sans mission</option><option value="busy">Avec mission</option></select></label>
    </div>
    <SortTable csv="flottes" rows={rows} onRow={r => s.select({ kind: 'fleet', id: r.f.id })} onDbl={r => s.focus({ kind: 'fleet', id: r.f.id }, r.f)} isSel={r => sel?.kind === 'fleet' && sel.id === r.f.id} empty="Aucune flotte ne correspond aux filtres." cols={[
      { key: 'name', label: 'Flotte', get: r => r.f.name, render: r => <><b>{r.f.name}</b>{fleetHasObsolete(g, r.f) && <i class="obs"> obsolète</i>}</> },
      { key: 'ships', label: 'Vaisseaux', num: true, get: r => r.sp.ships, render: r => <>{r.sp.ships}<div class="muted small">{r.f.tokens.map((t, k) => { const d = g.designs.find(x => x.id === t.designId); return <>{k ? ', ' : ''}{t.qty} × {d?.name ?? '?'}{d?.deleted && <i class="obs"> obsolète</i>}</>; })}</div></> },
      { key: 'loc', label: 'Position', get: r => r.f.orbiting >= 0 ? g.planets[r.f.orbiting].name : `(${Math.round(r.f.x)}, ${Math.round(r.f.y)})` },
      { key: 'mission', label: 'Mission', get: r => r.mi.label, render: r => <span class={r.mi.id === 'idle' ? 'yellow' : ''}>{r.mi.id === 'idle' ? 'Sans ordre' : r.mi.label}</span> },
      { key: 'dest', label: 'Destination', get: r => r.f.waypoints.length > 1 ? wpName(g, me.id, r.f.waypoints[r.f.waypoints.length - 1]) : '' , render: r => r.f.waypoints.length > 1 ? wpName(g, me.id, r.f.waypoints[r.f.waypoints.length - 1]) : <span class="muted">·</span> },
      { key: 'eta', label: 'Arrivée', num: true, get: r => r.est.length ? r.est[r.est.length - 1].arrival : 0, csv: r => r.est.length ? g.year + r.est[r.est.length - 1].arrival : '', render: r => r.est.length ? <>{g.year + r.est[r.est.length - 1].arrival}{r.est.every(l => l.ok) ? '' : <span class="red" title="Carburant insuffisant"> ⚠</span>}</> : <span class="muted">·</span> },
      { key: 'fuel', label: 'Carburant', num: true, get: r => r.sp.fuelCapacity ? r.f.fuel / r.sp.fuelCapacity : 0, csv: r => Math.round(r.f.fuel), render: r => <div class="fuelcell"><span>{fmt(r.f.fuel)} / {fmt(r.sp.fuelCapacity)} mg</span><i><b style={{ width: (r.sp.fuelCapacity ? Math.min(100, r.f.fuel / r.sp.fuelCapacity * 100) : 0) + '%' }} class={r.f.fuel < r.sp.fuelCapacity * 0.2 ? 'low' : ''} /></i></div> },
      { key: 'cargo', label: 'Soute', num: true, get: r => cargoMass(r.f.cargo), render: r => r.sp.cargoCapacity ? `${fmt(cargoMass(r.f.cargo))} / ${fmt(r.sp.cargoCapacity)}` : '—' },
      { key: 'power', label: 'Attaque', num: true, get: r => r.sp.powerRating },
    ]} />
  </Page>;
}

// ------------------------------------------------------------------ tool pages (the former windows, laid out as pages)

export function ToolPage({ children }: { children: ComponentChildren }) {
  return <PageCtx.Provider value={true}>{children}</PageCtx.Provider>;
}

export function CenterPage() {
  const s = useStore();
  switch (s.tab) {
    case 'map': return <MapPage />;
    case 'colonies': return <ColoniesPage />;
    case 'planner': return <PlannerPage />;
    case 'mining': return <MiningPage key={'mn' + JSON.stringify(s.tabData?.focus ?? '')} />;
    case 'fleets': return <FleetsPage />;
    case 'empire': return <EmpirePage />;
    case 'design': return <ToolPage><DesignerDialog designId={s.tabData?.designId} newHull={s.tabData?.newHull} key={'d' + (s.tabData?.designId ?? '') + (s.tabData?.newHull ?? '')} /></ToolPage>;
    case 'research': return <ToolPage><ResearchDialog /></ToolPage>;
    case 'diplomacy': return <ToolPage>{s.game?.settings.diplomacy && s.game.diplomacy ? <DiplomacyDialog key={'dip' + (s.tabData?.playerId ?? '')} /> : <RelationsDialog key={'dip' + (s.tabData?.playerId ?? '')} />}</ToolPage>;
    case 'reports': return <ToolPage><ReportsDialog tab={s.tabData?.tab} /></ToolPage>;
    case 'guide': return <ToolPage><HelpDialog tab={s.tabData?.tab} /></ToolPage>;
  }
}

export { refPos, gotoTarget };
export type { Fleet };
