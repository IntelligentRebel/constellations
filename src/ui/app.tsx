// Application shell: header with the empire's numbers, top tabs, sidebar, center page, selection panel.
import { pendingRefit } from '../engine/refit';
import { LangPicker } from './langpick';
import { useEffect, useState } from 'preact/hooks';
import { store, useStore, fmt, fmtPop, INSPECTOR_TABS, type TabId } from './store';
import { CenterPage, fitGalaxy } from './pages';
import { Sidebar } from './sidebar';
import { Inspector } from './inspector';
import { Dialogs } from './dialogs';
import { Welcome } from './welcome';
import * as A from './actions';
import { planetSpec } from '../engine/planet';
import { fleetSpec } from '../engine/fleet';
import { gotoTarget } from './nav';
import { Tutorial, tutorialEnter, openTutorial } from './tutorial';
import { nextTodo } from './todo';
import { uiPrefs, setPrefs, onPrefs } from './prefs';

import { VERSION } from './version';
import { useUpdate } from './update';
import { researchCost, MAX_TECH, goalProgress } from '../engine/research';
import { resolveGoal, goalReached } from '../engine/goals';
import { TECHS, HULLS, FIELD_NAMES } from '../engine/tech';
import { tl } from '../data/labels';
import { pendingForks } from '../engine/doctrines';
import { inGoldenAge } from '../engine/golden';
import { portalThreat } from '../engine/megaprojects';
import { nemesisOn, nemesisOf } from '../engine/nemesis';
import { actsOn, actOf, ACT_INFO, actRules, nextActText } from '../engine/acts';
import { loadedArks } from '../engine/diaspora';
import * as PB from '../engine/pbem';

const TABS: [TabId, string, string][] = [
  ['map', 'Carte', 'Carte galactique'], ['colonies', 'Colonies', 'Vos colonies (F3)'], ['planner', 'Planificateur de colonies', 'Mondes analysés classés par habitabilité, envoi d\'arches (C)'], ['mining', 'Planificateur de minage', 'Mondes libres classés par richesse minérale, envoi de vaisseaux de minage (X)'], ['fleets', 'Flottes', 'Vos flottes'], ['empire', 'Empire', 'Administration, réseau logistique, mégaprojets, objectifs secrets, doctrines'],
  ['design', 'Conception', 'Conception de vaisseaux et de stations (F4)'], ['research', 'Recherche', 'Recherche (F5)'], ['diplomacy', 'Diplomatie', 'Relations avec les empires rencontrés (F7)'],
  ['reports', 'Rapports', 'Rapports de l\'année, batailles, score'], ['guide', 'Guide', 'Guide du joueur (F1)'],
];

function setMode(m: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8) { store.view.mode = m; store.savePrefs(); store.bump(); }
function toggle(k: 'scan' | 'mines' | 'paths' | 'names' | 'counts') { (store.view as any)[k] = !(store.view as any)[k]; store.savePrefs(); store.bump(); }

export function exportGame() {
  const g = store.game; if (!g) return;
  store.save();
  store.open('export', { title: 'Exporter la partie', text: JSON.stringify(g), file: `constellations-${g.name.replace(/\W+/g, '_')}-${g.year}.json`, note: `${g.name}, année ${g.year}.` });
}

export function importGame() { store.open('import', { kind: 'game' }); }

function Header() {
  const s = useStore();
  const g = s.game!, me = s.me!;
  const planets = g.planets.filter(p => p.owner === me.id);
  const specs = planets.map(p => planetSpec(g, p, me));
  const pop = planets.reduce((a, p) => a + p.pop, 0);
  const res = specs.reduce((a, sp) => a + sp.resources, 0);
  // yearly growth as the turn will apply it (rounded to whole hundreds per planet)
  const growth = specs.reduce((a, sp, i) => a + (sp.popNextYear - planets[i].pop), 0);
  const growthPct = pop > 0 ? growth / pop * 100 : 0;
  const ships = g.fleets.filter(f => f.owner === me.id).reduce((a, f) => a + f.tokens.reduce((b, t) => b + t.qty, 0), 0);
  return <header class="hdr">
    <button class="brand" onClick={() => s.open('about')} title="À propos">
      <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M12 1.5 L14 10 L22.5 12 L14 14 L12 22.5 L10 14 L1.5 12 L10 10 Z" fill="var(--accent)" /></svg>
      <span><b>Constellations</b><small>{me.name} · v{VERSION}</small></span>
    </button>
    <UpdateBadge />
    <div class="hstats" data-tut="hstats">
      <button onClick={() => s.goTab('colonies')}><b>{planets.length}</b><small>colonie{planets.length > 1 ? 's' : ''}</small></button>
      <button onClick={() => s.goTab('colonies')} title={`Croissance prévue l'an prochain : ${growth >= 0 ? '+' : ''}${fmtPop(growth)} habitants (${growthPct.toFixed(1).replace('.', ',')} %)`}><b>{fmtPop(pop)}</b><small>habitants <span class={growth >= 0 ? 'hgood' : 'hbad'}>{growth >= 0 ? '+' : ''}{fmtPop(growth)}/an</span></small></button>
      <button onClick={() => s.goTab('research')} title={`${me.researchPct} % des ressources vont à la recherche (réglable dans l'onglet Recherche)`}><b>{fmt(res)}</b><small>ressources/an · <span class="hacc">{me.researchPct} % recherche</span></small></button>
      <button onClick={() => s.goTab('fleets')}><b>{fmt(ships)}</b><small>vaisseaux</small></button>
      <ResearchStat />
    </div>
    <EmpireAlerts />
    <div class="sp" />
    <SoundToggle />
    <div class="hyear" data-tut="year">{actsOn(g) ? <ActChip /> : <small>Année</small>}<b>{g.year}</b>{s.dirty && <span class="dirty" title="Ordres modifiés depuis la dernière sauvegarde automatique">•</span>}</div>
    {g.pbem?.role === 'player' ? <button class="primary next" onClick={() => s.open('pbem')} title="Enregistrer le fichier de vos ordres pour l'hôte">{g.pbem.sent === g.pbem.turn ? 'Ordres envoyés' : 'Envoyer mes ordres'}</button>
      : g.pbem?.role === 'host' ? <button class="primary next" disabled={s.busy} onClick={() => s.open('pbem')} title="Fichiers de tour, ordres reçus, génération de l'année">{s.busy ? 'Calcul…' : `Hôte · ordres ${PB.pbemHumans(g).length - PB.missingOrders(g).length}/${PB.pbemHumans(g).length}`}</button>
      : <button class="primary next" data-tut="next" disabled={s.busy} onClick={() => s.endTurn(1)} title="Générer l'année suivante (Entrée ou F9)">{s.busy ? 'Calcul…' : <>Tour suivant <kbd>Entrée</kbd></>}</button>}
  </header>;
}

/** 0.3.9: sound on or off in one click (volumes in « Affichage et son »). */
function SoundToggle() {
  const [, tick] = useState(0);
  useEffect(() => onPrefs(() => tick(x => x + 1)), []);
  const on = uiPrefs.sound;
  return <button class="ghost hsound" onClick={() => setPrefs({ sound: !on })} title={on ? 'Couper le son (réglages : menu ⋯, Affichage et son)' : 'Activer le son'} aria-pressed={on}>
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />{on ? <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" /> : <path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />}</svg>
  </button>;
}

/** Constellations 3 alerts: doctrine to choose, a rival's Portail, disorganisation. */
function EmpireAlerts() {
  const s = useStore();
  const g = s.game!, me = s.me!;
  const forks = pendingForks(g, me);
  const portal = portalThreat(g);
  const rival = portal && portal.owner !== me.id && portal.announced > 0 ? portal : null;
  const disorg = g.settings.distanceCost && me.disorgUntil !== undefined && g.year < me.disorgUntil;
  const decisions = me.decisions?.length ?? 0;
  const nem = nemesisOn(g) ? nemesisOf(g, me.id) : undefined;
  const exile = me.exile && !me.exile.refounded ? me.exile : undefined;
  const ark = exile ? loadedArks(g, me)[0] : undefined;
  const dil = me.dilemmas ?? [];
  const golden = inGoldenAge(g, me) ? me.golden : undefined;
  if (!forks.length && !rival && !disorg && !decisions && !nem && !exile && !dil.length && !golden) return null;
  return <div class="halerts">
    {dil.length > 0 && <button class="halert dec" onClick={() => s.open('dilemma', { id: dil[0].id })} title={`À trancher avant ${dil[0].expires}`}>Dilemme{dil.length > 1 ? ` (${dil.length})` : ''}</button>}
    {decisions > 0 && <button class="halert dec" onClick={() => { s.goTab('empire'); setTimeout(() => document.getElementById('discoveries')?.scrollIntoView({ behavior: 'smooth' }), 60); }} title="Une découverte attend votre décision">Décision à prendre{decisions > 1 ? ` (${decisions})` : ''}</button>}
    {forks.length > 0 && <button class="halert doc" onClick={() => { s.goTab('research'); setTimeout(() => document.getElementById('doctrines')?.scrollIntoView({ behavior: 'smooth' }), 60); }} title={forks.map(f => `${f.title} : ${f.a.name} ou ${f.b.name}`).join('\n')}>Doctrine à choisir{forks.length > 1 ? ` (${forks.length})` : ''}</button>}
    {rival && <button class="halert portal" onClick={() => s.focus({ kind: 'planet', id: rival.planet.id }, rival.planet)} title={`Les ${g.players[rival.owner].name} construisent le Portail de l'Ascension sur ${rival.planet.name}. Achevé, il leur donne la victoire.`}>Portail des {g.players[rival.owner].name} : {rival.announced} %</button>}
    {exile && <button class="halert nem" onClick={() => { if (ark) { s.select({ kind: 'fleet', id: ark.id }); s.center(ark.x, ark.y); s.goTab('map'); } }} title="Votre peuple vit à bord de ses arches : fondez une colonie pour refonder l'empire.">En exil depuis {exile.since}</button>}
    {nem && <button class="halert nem" onClick={() => s.goTab('diplomacy', { playerId: nem.ai })} title={`Les ${g.players[nem.ai].name} ont juré votre perte en ${nem.since} : pas de paix tant que leur empire n'est pas brisé.`}>Némésis : {g.players[nem.ai].name}</button>}
    {golden && <button class="halert gold" onClick={() => { s.goTab('empire'); setTimeout(() => document.getElementById('golden')?.scrollIntoView({ behavior: 'smooth' }), 60); }} title="+15 % de ressources et de recherche sur tout l'empire">Âge d'or jusqu'en {golden.until}</button>}
    {disorg && <button class="halert dis" onClick={() => s.goTab('empire')} title="Capitale perdue : rendement de tout l'empire réduit">Désorganisé jusqu'en {me.disorgUntil}</button>}
  </div>;
}

/** Header: field being researched with its progress, and the targeted technology if any. */
function ResearchStat() {
  const s = useStore();
  const g = s.game!, me = s.me!;
  const f = me.researching;
  const maxed = me.tech[f] >= MAX_TECH;
  const cost = maxed ? 0 : researchCost(g, me, f);
  const pctv = cost ? Math.min(1, me.researchSpent[f] / cost) : 1;
  // a technology already in hand (found this year, the goal is dropped at the end of the turn) is no target
  const g0 = resolveGoal(g, me.researchGoal);
  const goal = g0 && !goalReached(me, g0) ? g0 : undefined;
  const gp = goal ? goalProgress(g, me, goal) : 0;
  return <button class="hresearch" onClick={() => s.goTab('research')} title={`Recherche en cours : ${FIELD_NAMES[f]}, vers le niveau ${me.tech[f] + 1}${goal ? `. Technologie ciblée : ${tl(goal.name)}` : ''}`}>
    <span class="hr-line"><b>{FIELD_NAMES[f]}</b><span class="muted">{maxed ? 'niveau max' : `vers niv. ${me.tech[f] + 1} · ${Math.round(pctv * 100)} %`}</span></span>
    <i class="hr-bar"><i style={{ width: pctv * 100 + '%' }} /></i>
    <small>{goal ? <>Cible : <span class="hr-goal">{tl(goal.name)}</span> · ≈ {Math.round(gp * 100)} %</> : 'Recherche · aucune technologie ciblée'}</small>
  </button>;
}

interface MoreItem { label: string; key?: string; action: () => void; sep?: boolean }
function moreItems(): MoreItem[] {
  const s = store;
  return [
    { label: 'Générer 5 années', action: () => s.endTurn(5) },
    { label: 'Générer 10 années', key: 'Maj+F9', action: () => s.endTurn(10) },
    { label: 'Sauvegarder maintenant', key: 'Ctrl+S', action: () => { s.save(); s.notify('Partie sauvegardée dans ce navigateur'); }, sep: true },
    { label: 'Sauvegardes de secours…', action: () => s.open('backups') },
    { label: 'Nouvelle partie…', action: () => s.open('newGame') },
    { label: 'Retour à l\'accueil', action: () => { s.save(); s.saved = s.game; s.game = null; s.bump(); } },
    { label: 'Ma race', key: 'F8', action: () => s.open('raceView'), sep: true },
    { label: 'Assistant de race…', action: () => s.open('raceWizard', { standalone: true }) },
    { label: 'Plans de bataille…', key: 'F6', action: () => s.open('battlePlans') },
    { label: 'Modèles de production…', action: () => s.open('templates') },
    { label: 'Catalogue des technologies', key: 'F2', action: () => s.open('techBrowser') },
    { label: 'Score', key: 'F10', action: () => s.open('score') },
    { label: 'Course à la victoire', key: 'W', action: () => s.open('victory') },
    { label: 'Chronique', key: 'H', action: () => s.open('chronicle') },
    { label: 'Succès…', action: () => s.open('achievements') },
    ...(s.game && (s.game.pbem || s.humans().length > 1) ? [{ label: 'Partie par fichiers…', action: () => s.open('pbem') }] : []),
    { label: 'Rechercher un objet…', key: 'Ctrl+F', action: () => s.open('find') },
    { label: 'Paramètres de la partie', action: () => s.open('settings'), sep: true },
    { label: 'Affichage et son…', action: () => s.open('prefs') },
    { label: 'Raccourcis clavier', action: () => s.goTab('guide', { tab: 'keys' }) },
    s.game?.tutorial ? { label: 'Tutoriel', action: () => void openTutorial() } : { label: 'Tutoriel…', action: () => s.ask('Ouvrir le tutoriel ? Il se joue dans une partie à part ; celle-ci reste enregistrée dans ce navigateur.', () => void openTutorial(), 'Ouvrir le tutoriel') },
    { label: 'À propos', action: () => s.open('about') },
  ];
}

function TabBar() {
  const s = useStore();
  const [more, setMore] = useState(false);
  useEffect(() => { if (!more) return; const h = () => setMore(false); window.addEventListener('click', h); return () => window.removeEventListener('click', h); }, [more]);
  const me = s.me!;
  return <nav class="tabbar">
    <button class="drawer-btn" onClick={() => { s.drawer = !s.drawer; s.bump(); }} aria-expanded={s.drawer} title="Colonies et flottes">☰</button>
    <div class="tabs-scroll">
      {TABS.map(([id, label, tip]) => <button class={'tab' + (s.tab === id ? ' on' : '')} data-tut={'tab-' + id} onClick={() => s.goTab(id)} title={tip}>{label}{id === 'reports' && me.messages.length > 0 && <span class="badge">{me.messages.length}</span>}{id === 'diplomacy' && (s.game!.diplomacy?.proposals.filter(x => x.to === me.id).length ?? 0) > 0 && <span class="badge warn" title="propositions en attente de votre réponse">{s.game!.diplomacy!.proposals.filter(x => x.to === me.id).length}</span>}</button>)}
    </div>
    <div class="tab-actions" data-tut="actions">
      <button class="ghost" disabled={!s.undo.length} onClick={() => s.undoLast()} title="Annuler le dernier ordre (Ctrl+Z)">↶ Annuler</button>
      <button class="ghost hide-sm" onClick={exportGame} title="Enregistrer la partie dans un fichier">Exporter</button>
      <button class="ghost hide-sm" onClick={importGame} title="Charger une partie depuis un fichier">Importer</button>
      <div class="pop-wrap">
        <button class={'ghost' + (more ? ' on' : '')} onClick={e => { e.stopPropagation(); setMore(!more); }} aria-expanded={more} title="Plus">⋯</button>
        {more && <div class="pop menu" onClick={e => e.stopPropagation()}>
          <button class="show-sm" onClick={() => { setMore(false); exportGame(); }}>Exporter la partie…</button>
          <button class="show-sm" onClick={() => { setMore(false); importGame(); }}>Importer une partie…</button>
          {moreItems().map(it => <>{it.sep && <hr />}<button onClick={() => { setMore(false); it.action(); }}><span>{it.label}</span>{it.key && <kbd>{it.key}</kbd>}</button></>)}
          <hr /><LangPicker compact />
        </div>}
      </div>
    </div>
  </nav>;
}

function Toast() {
  const s = useStore();
  if (!s.toast) return null;
  return <div class="toast" role="status">{s.toast.text}</div>;
}

function isInteractive(el: Element | null): boolean {
  if (!el) return false;
  const t = el.tagName;
  return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || t === 'BUTTON' || t === 'A' || (el as HTMLElement).isContentEditable;
}

function useKeyboard() {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const s = store;
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (e.key === 'Escape' && s.dialogs.length) { s.close(); e.preventDefault(); return; }
      if (!s.game || s.handoff) return;
      const fk: Record<string, () => void> = {
        F1: () => s.goTab('guide'), F2: () => s.open('techBrowser'), F3: () => s.goTab('colonies'), F4: () => s.goTab('design'), F5: () => s.goTab('research'),
        F6: () => s.open('battlePlans'), F7: () => s.goTab('diplomacy'), F8: () => s.open('raceView'), F9: () => s.endTurn(1), F10: () => s.open('score'), F12: () => s.endTurn(10),
      };
      if (e.key === 'F9' && e.shiftKey) { e.preventDefault(); s.endTurn(10); return; } // F12 is often taken by the browser
      if (fk[e.key]) { e.preventDefault(); fk[e.key](); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { if (!typing) { e.preventDefault(); s.undoLast(); } return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); s.save(); s.notify('Partie sauvegardée'); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); s.open('find'); return; }
      if (e.key === 'Escape') {
        if (s.dialogs.length) { s.close(); e.preventDefault(); }
        else if (s.drawer) { s.drawer = false; s.bump(); }
        else if (s.wpMode) { s.wpMode = false; s.bump(); }
        else if (s.tab !== 'map') s.goTab('map');
        return;
      }
      if (typing || s.dialogs.length) return;
      if (e.key === 'Enter' && !e.repeat && !e.ctrlKey && !e.altKey && !e.metaKey && !isInteractive(document.activeElement)) { e.preventDefault(); if (!tutorialEnter()) s.endTurn(1); return; }
      const g = s.game, me = s.me!;
      // digit row by physical key, so it works on AZERTY keyboards too (no Shift needed)
      const digit = /^(Digit|Numpad)(\d)$/.exec(e.code)?.[2];
      if (digit !== undefined && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const n = +digit;
        if (n >= 1 && n <= 8) setMode(n as 1);
        else if (n === 9) toggle(e.shiftKey ? 'paths' : 'scan');
        else if (n === 0) toggle(e.shiftKey ? 'counts' : 'names');
        e.preventDefault();
        return;
      }
      switch (e.key) {
        case 'ArrowUp': if (s.tab === 'map') { s.messageIndex = Math.max(0, s.messageIndex - 1); s.bump(); e.preventDefault(); } break;
        case 'ArrowDown': if (s.tab === 'map') { s.messageIndex = Math.min(me.messages.length - 1, s.messageIndex + 1); s.bump(); e.preventDefault(); } break;
        case 'g': { const m = me.messages[s.messageIndex]; if (m?.target) gotoTarget(m.target); break; }
        case 'q': if (s.commanded?.kind === 'planet') s.open('production', { planetId: s.commanded.id }); break;
        case 'c': s.goTab('planner'); break;
        case 'x': s.goTab('mining'); break;
        case 'w': case 'W': s.open('victory'); break;
        case 'h': case 'H': s.open('chronicle'); break;
        case 't': case 'T': nextTodo(e.key === 'T' ? -1 : 1); break;
        case 'm': s.goTab('map'); break;
        case 'v': { const c = s.commanded; if (c) { const o = c.kind === 'planet' ? g.planets[c.id] : g.fleets.find(f => f.id === c.id); if (o) s.center(o.x, o.y); } break; }
        case 'n': case 'p': case 'N': case 'P': {
          const dir = e.key.toLowerCase() === 'n' ? 1 : -1;
          if (s.commanded?.kind === 'fleet') {
            const list = g.fleets.filter(f => f.owner === me.id);
            const i = list.findIndex(f => f.id === s.commanded!.id);
            const f = list[(i + dir + list.length) % list.length];
            if (f) { s.select({ kind: 'fleet', id: f.id }); s.center(f.x, f.y); }
          } else {
            const list = g.planets.filter(p => p.owner === me.id && (e.key === e.key.toLowerCase() || p.starbase));
            const i = list.findIndex(p => p.id === s.commanded?.id);
            const p = list[(i + dir + list.length) % list.length];
            if (p) { s.select({ kind: 'planet', id: p.id }); s.center(p.x, p.y); }
          }
          break;
        }
        case 'i': case 'I': {
          const list = g.fleets.filter(f => f.owner === me.id && f.waypoints.length <= 1 && !f.auto && !['remoteMine', 'layMines', 'patrol', 'refuel', 'stay'].includes(f.waypoints[0]?.task) && !pendingRefit(g, f) && fleetSpec(g, f).hasEngines);
          if (!list.length) { s.notify('Aucune flotte sans ordre'); break; }
          const i = s.commanded?.kind === 'fleet' ? list.findIndex(f => f.id === s.commanded!.id) : -1;
          const f = list[(i + (e.key === 'I' ? -1 : 1) + list.length) % list.length];
          s.focus({ kind: 'fleet', id: f.id }, f);
          break;
        }
        case 'f': {
          if (s.commanded?.kind === 'planet') { const f = g.fleets.find(x => x.owner === me.id); if (f) { s.select({ kind: 'fleet', id: f.id }); s.center(f.x, f.y); } }
          else { const p = g.planets.find(x => x.owner === me.id); if (p) { s.select({ kind: 'planet', id: p.id }); s.center(p.x, p.y); } }
          break;
        }
        case 'Delete': case 'Backspace': if (s.commanded?.kind === 'fleet' && s.waypointIndex > 0) { A.deleteWaypoint(s.waypointIndex); e.preventDefault(); } break;
        case ',': case '.': {
          const f = A.commandedFleet();
          if (f && s.waypointIndex > 0) A.setWarp(s.waypointIndex, Math.max(1, Math.min(10, f.waypoints[s.waypointIndex].warp + (e.key === '.' ? 1 : -1))));
          break;
        }
        case '+': case '=': s.setCamera({ ...s.camera, zoom: Math.min(12, s.camera.zoom * 1.25) }); break;
        case '-': s.setCamera({ ...s.camera, zoom: Math.max(0.15, s.camera.zoom / 1.25) }); break;
        case 'Home': if (s.tab === 'map') fitGalaxy(); break;
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
}

export function App() {
  const s = useStore();
  useKeyboard();
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { store.saveNow(); void e; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);
  if (!s.game) return <><Welcome /><Dialogs /><Toast /></>;
  if (s.handoff) return <Handoff />;
  const withInspector = INSPECTOR_TABS.includes(s.tab);
  return (
    <div class={'app tab-' + s.tab + (withInspector ? ' with-insp' : '') + (s.drawer ? ' drawer-open' : '')}>
      <Header />
      <TabBar />
      <div class="body">
        <Sidebar />
        {s.drawer && <div class="drawer-back" onClick={() => { s.drawer = false; s.bump(); }} />}
        <main class="center">{CenterPage()}</main>
        {withInspector && <Inspector />}
      </div>
      <Dialogs />
      {s.game.tutorial && !s.game.tutorial.hidden && <Tutorial />}
      <ActCard />
      <Toast />
      {s.busy && <div class="busy">Génération de l'année {s.game.year + 1}…</div>}
    </div>
  );
}

/** 0.3.9: the title card of a new act, once per player. */
function ActCard() {
  const s = useStore();
  const g = s.game!, me = s.me!;
  if (!actsOn(g) || g.tutorial || me.dead) return null;
  const n = actOf(g);
  if ((me.actSeen ?? 0) >= n) return null;
  const roman = ['', 'I', 'II', 'III'][n];
  const close = () => { me.actSeen = n; s.save(); s.bump(); };
  return <div class="act-card" onClick={close} role="dialog" aria-label={`Acte ${roman}`}>
    <div class="act-inner" onClick={e => e.stopPropagation()}>
      <div class="act-n">Acte {roman}</div>
      <h1>{ACT_INFO[n].title}</h1>
      <p class="act-text">{ACT_INFO[n].text}</p>
      {g.act?.why && n > 1 && <p class="act-why">{g.act.since} : {g.act.why}.</p>}
      <ul>{actRules(g, n).map(r => <li>{r}</li>)}</ul>
      {nextActText(g) && <p class="small muted">{nextActText(g)}</p>}
      <button class="primary" onClick={close}>Continuer</button>
    </div>
  </div>;
}

/** 0.3.9: the act in the header, with what it changes and what brings the next one. */
function ActChip() {
  const s = useStore();
  const g = s.game!;
  if (!actsOn(g)) return null;
  const n = actOf(g);
  const tip = [`Acte ${['', 'I', 'II', 'III'][n]} : ${ACT_INFO[n].title}`, ...actRules(g, n), nextActText(g) ?? ''].filter(Boolean).join('\n');
  return <button class="hact" title={tip} onClick={() => { s.me!.actSeen = n - 1; s.bump(); }}>Année · acte {['', 'I', 'II', 'III'][n]}</button>;
}

/** Hotseat: hides the previous player's screen until the next one is ready. */
function Handoff() {
  const s = useStore();
  const g = s.game!, me = s.me!;
  const done = g.submitted ?? [];
  const humans = s.humans();
  return <div class="handoff">
    <div class="handoff-card">
      <div class="muted small">Année {g.year} · partie à {humans.length} joueurs</div>
      <h2 style={{ color: me.color }}>Au tour des {me.name}</h2>
      <p class="muted">Les autres joueurs ne doivent pas regarder l'écran.</p>
      <ul class="handoff-list">{humans.map(h => <li class={h === me.id ? 'cur' : done.includes(h) ? 'done' : ''}><span class="dot" style={{ background: g.players[h].color }} />{g.players[h].name}<span class="muted small">{h === me.id ? 'à vous de jouer' : done.includes(h) ? 'ordres donnés' : 'en attente'}</span></li>)}</ul>
      <button class="primary big" onClick={() => { s.handoff = false; s.bump(); }}>Afficher mon empire</button>
    </div>
  </div>;
}

/** 0.3.9.18: a newer version is out (local copy): a small button next to the name of the game. */
function UpdateBadge() {
  const list = useUpdate();
  if (!list.length) return null;
  return <button class="upd-badge" onClick={() => store.open('update')} title={`Nouvelle version disponible : ${list[0].version}`}>{`↑ ${list[0].version}`}</button>;
}
