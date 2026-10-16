// 0.3.8: the tutorial. A card that walks the player through the real game, on a fixed map (newgame.tutorialGame):
// first the essentials (the core chapters, the 20 % of the game used 80 % of the time), then optional chapters.
// Each step explains one thing, points at it on the screen (a ring around a button, a panel, or a star of the map)
// and, when it asks for an action, watches the game until the player has done it (or does it for them).
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { store, useStore, fmt, fmtPop } from './store';
import type { Fleet, GameState, Planet, Player, TutorialState } from '../engine/types';
import { tutorialGame } from '../engine/newgame';
import { habitability, raceSpec } from '../engine/race';
import { fleetSpec, distance, estimateRoute } from '../engine/fleet';
import { planetSpec } from '../engine/planet';
import { estimateQueue } from '../engine/production';
import { sendOptions, sendFleet, missionDesigns, buildOptions, queueMission, missionStatus, isPureScout, planMission } from '../engine/missions';
import { FIELD_NAMES } from '../engine/tech';
import { VICTORY_LABELS } from '../engine/score';
import { availableHulls, autoDesign } from '../engine/design';
import { addDesign } from '../engine/newgame';
import { ADMIN_RADIUS, ADMIN_LOSS, ADMIN_STEP, ADMIN_FLOOR, CONQUEST_YEARS } from '../engine/empire';
import { OBJECTIVE_POINTS } from '../engine/objectives';
import { OMEN_START } from '../engine/crisis';
import { uiZoom, viewWidth } from './prefs';

// ------------------------------------------------------------------ steps and chapters

/** A target on the screen: a CSS selector (an element of the interface), or an object of the map. */
type Target = string | { planet: number } | { fleet: number };

interface Step {
  id: string;
  title: string;
  /** paragraphs; **bold**, [[key]], and a paragraph starting with "• " is a list item */
  body: string[];
  /** what to do (the step waits for it when there is a goal) */
  todo?: string;
  goal?: () => boolean;
  /** "Do it for me" */
  doIt?: () => void;
  target?: Target | null;
  /** run once when the step opens (select, center the map, open a page) */
  enter?: () => void;
  /** Enter ends the year on this step (everywhere else in the tutorial, Enter goes to the next step) */
  turn?: boolean;
}

interface Chapter { id: string; title: string; blurb: string; core: boolean; steps: () => Step[] }

const tut = (): TutorialState | undefined => store.game?.tutorial;
const game = () => store.game!;
const me = () => store.me!;
const P = (id: number): Planet | undefined => store.game?.planets[id];
const F = (id: number): Fleet | undefined => store.game?.fleets.find(f => f.id === id && f.owner === store.game!.human);
const T = () => tut()!.targets;
/** Phone layout: the colonies and fleets are in a drawer, opened for the steps that point at them. */
const drawer = (open: boolean) => { if (typeof window !== 'undefined' && viewWidth() <= 700 && store.drawer !== open) { store.drawer = open; store.bump(); } };
const home = (): Planet => { const g = game(); return g.planets.find(p => p.owner === g.human && p.homeworld) ?? g.planets.find(p => p.owner === g.human) ?? g.planets[0]; };
const mine = () => game().planets.filter(p => p.owner === game().human);
const myFleets = () => game().fleets.filter(f => f.owner === game().human);
const valueOf = (p: Planet) => { const i = me().intel.planets[p.id]; return i?.hab ? habitability(me().race, i.hab) : null; };
const explored = (p: Planet | undefined) => !!p && me().intel.planets[p.id]?.year !== undefined;
const heading = (f: Fleet, pid: number) => f.waypoints.some((w, k) => k > 0 && w.target === 'planet' && w.targetId === pid);
const commandedFleet = () => store.commanded?.kind === 'fleet' ? F(store.commanded.id) : undefined;
const scoutDesign = () => missionDesigns(game(), me(), 'explore')[0];
const arkDesign = () => missionDesigns(game(), me(), 'colonize')[0];

/** The map shows the object, near the middle, close enough to see the stars around it. */
function show(x: number, y: number, zoom = 1.6) {
  if (store.tab !== 'map') store.goTab('map');
  store.camera = { x, y, zoom: Math.max(zoom, store.camera.zoom) };
  store.bump();
}
function selectPlanet(p: Planet | undefined) { if (p) { store.focus({ kind: 'planet', id: p.id }, p); } }
function selectFleet(f: Fleet | undefined) { if (f) { store.focus({ kind: 'fleet', id: f.id }, f); } }
function unfoldQueue() { store.collapsed['insp-prod'] = false; store.bump(); }

/** The scout ordered at the start, once built: a scout that is not one of the starting ships. */
const newScout = () => myFleets().find(f => !T().startFleets.includes(f.id) && isPureScout(fleetSpec(game(), f)));

/** The nearest unexplored world a fleet can reach and that nobody is already heading to. */
function nearestUnknown(f: Fleet): Planet | undefined {
  const g = game();
  const taken = new Set(myFleets().flatMap(x => x.waypoints.filter(w => w.target === 'planet').map(w => w.targetId)));
  return g.planets.filter(p => !explored(p) && !p.hidden && !taken.has(p.id)).sort((a, b) => distance(a, f) - distance(b, f))
    .slice(0, 12).find(p => { const c: Fleet = JSON.parse(JSON.stringify(f)); return planMission(g, c, p.id, 'explore'); });
}

/** The best known free world with a positive value, to send the next ark to. */
function nextColony(): Planet | undefined {
  const g = game();
  const order = [T().scout, T().probe].map(id => g.planets[id]);
  const ok = (p: Planet) => explored(p) && (me().intel.planets[p.id].owner ?? -1) < 0 && (valueOf(p) ?? 0) > 0;
  return order.find(ok) ?? g.planets.filter(ok).sort((a, b) => (valueOf(b) ?? 0) - (valueOf(a) ?? 0))[0];
}

/** Research points of next year, as the Research page counts them. */
function researchPerYear(): number {
  const g = game(), m = me();
  const budget = mine().reduce((a, p) => a + planetSpec(g, p, m).resourcesResearch, 0);
  return Math.trunc(Math.max(budget, m.researchLastYear) * raceSpec(m.race).researchFactor + 0.5);
}

const years = (n: number) => `${n} an${n > 1 ? 's' : ''}`;

/** An element of the interface marked for the tutorial (built without a template, which would be taken for text). */
const tutSel = (k: string) => '[data-tut=' + k + ']';

// interface labels, so the steps name the buttons as the interface does, in every language (the buttons that the
// interface assembles from two texts are assembled the same way)
const L = {
  next: 'Tour suivant', edit: 'Ajouter / modifier…', add: 'Ajouter ▸', research: 'Recherche', map: 'Carte', planner: 'Planificateur de colonies',
  scoutBtn: `Envoyer${' ' + 'un éclaireur'}`, arkBtn: `Envoyer${''}`, buildArk: `Construire et envoyer${' ' + 'une arche'}`, design: 'Conception', reports: 'Rapports', guide: 'Guide',
  idle: 'Sans mission', autoFactories: 'Usines (auto)', autoMines: 'Mines (auto)', center: 'Centrer', aim: 'Cibler cette technologie', speed: 'Vitesse auto',
  undo: '↶ Annuler', exportBtn: 'Exporter', steps: '✚ Étapes', ok: 'OK', empire: 'Empire', colonies: 'Colonies', fleets: 'Flottes', mining: 'Planificateur de minage', diplomacy: 'Diplomatie',
};

// ------------------------------------------------------------------ the essentials

const START: Chapter = {
  id: 'start', core: true, title: 'Premiers pas', blurb: 'L\'écran, la carte, la sélection.',
  steps: () => {
    const hw = home();
    const res = planetSpec(game(), hw, me()).resources;
    return [
      {
        id: 'welcome', title: 'Bienvenue aux commandes',
        body: [
          `Vous dirigez les **${me().name}**, une jeune espèce qui ne possède encore qu'une planète : **${hw.name}**. Autour d'elle, une galaxie à explorer, des mondes à coloniser et, quelque part dans le noir, des empires rivaux.`,
          `Le jeu se joue **au tour par tour** : un tour dure un an. Vous donnez vos ordres, sans limite de temps, puis vous cliquez sur **${L.next}**. Tous les empires agissent alors en même temps et l'année se calcule.`,
          'Ce tutoriel enseigne d\'abord l\'essentiel, ce qui sert dans presque chaque tour (une vingtaine de minutes). Des chapitres facultatifs approfondissent ensuite le reste.',
          'Quand une étape demande une action, elle attend que vous l\'ayez faite. Si vous bloquez, **Le faire pour moi** l\'exécute à votre place. Cette fenêtre se déplace en la tirant par son titre.',
        ],
      },
      {
        id: 'header', title: 'Votre empire d\'un coup d\'œil', target: '[data-tut=hstats]',
        body: [
          'Le bandeau du haut résume votre empire : colonies, population (avec sa croissance annuelle), ressources produites par an, vaisseaux, et la recherche en cours.',
          `Les **ressources** (R) sont la monnaie du jeu : elles paient les constructions et la recherche. ${hw.name} en produit ${fmt(res)} par an. Faire grimper ce chiffre est votre premier objectif.`,
          'Chaque case est un raccourci vers la page correspondante.',
        ],
      },
      {
        id: 'map', title: 'La carte galactique', target: '[data-tut=zoom]',
        enter: () => { show(hw.x, hw.y, 1.2); enterCam = { ...store.camera }; },
        body: [
          'Au centre, la carte. Chaque point est une étoile, avec sa planète. **Glissez** pour vous déplacer ; la **molette** (ou les boutons + et −) zoome. **Centrer** montre toute la galaxie.',
          'Survolez une étoile : une bulle donne son nom, sa valeur pour votre espèce et sa distance en années-lumière (al) depuis l\'objet sélectionné.',
        ],
        todo: 'Zoomez ou déplacez la carte.',
        goal: () => { const c = store.camera; return !!enterCam && (Math.abs(c.zoom - enterCam.zoom) > 0.01 || Math.hypot(c.x - enterCam.x, c.y - enterCam.y) > 3); },
        doIt: () => store.setCamera({ ...store.camera, zoom: store.camera.zoom * 1.25 }),
      },
      {
        id: 'colors', title: 'Lire les couleurs', target: '[data-tut=legend]',
        body: [
          'La légende, sous la carte, donne le sens des couleurs. Votre empire est en **cyan**. Une planète **verte** convient à votre espèce, une **rouge** lui est hostile, une **grise** n\'a pas encore été analysée. Plus le point est gros, plus l\'effet est fort.',
          'Les cercles autour de vos planètes et de vos vaisseaux montrent la portée de leurs scanners : le **rouge** détecte les vaisseaux, le **jaune** analyse les planètes à distance.',
          'Les boutons au-dessus de la carte changent ce que montrent les planètes (habitabilité, minerais, population...). Les touches [[1]] à [[8]] font de même.',
        ],
      },
      {
        id: 'select-home', title: 'Sélectionner votre monde natal', target: { planet: hw.id },
        enter: () => { show(hw.x, hw.y, 1.6); store.select(null); },
        body: [`Votre monde natal, **${hw.name}**, est entouré sur la carte. Cliquez dessus.`],
        todo: `Cliquez sur ${hw.name}.`,
        goal: () => store.selected?.kind === 'planet' && store.selected.id === hw.id,
        doIt: () => selectPlanet(hw),
      },
      {
        id: 'inspector', title: 'Le panneau de sélection', target: 'aside.insp',
        enter: () => { if (store.selected?.kind !== 'planet' || store.selected.id !== hw.id) selectPlanet(hw); },
        body: [
          `À droite, le **panneau de sélection** décrit ce que vous avez cliqué. Pour une planète à vous : sa file de production, son habitabilité, ses minerais, sa population et sa station orbitale.`,
          'C\'est le principe de toute l\'interface : **on choisit un objet (sur la carte ou dans la liste de gauche), on agit dans ce panneau.**',
          'Les flèches ‹ › du panneau passent d\'une planète à la suivante, comme les touches [[N]] et [[P]].',
        ],
      },
    ];
  },
};

let enterCam: { x: number; y: number; zoom: number } | null = null;

const PRODUCE: Chapter = {
  id: 'produce', core: true, title: 'Produire', blurb: 'Ressources, minerais et file de production.',
  steps: () => {
    const g = game(), m = me(), hw = home();
    const sp = planetSpec(g, hw, m);
    const scout = scoutDesign();
    const scoutQ = () => hw.queue.findIndex(q => q.kind === 'ship' && q.designId === scout?.id);
    const est = estimateQueue(g, hw, 20);
    const sq = scoutQ();
    return [
      {
        id: 'economy', title: 'D\'où viennent les ressources', target: '[data-tut=minerals]',
        enter: () => selectPlanet(hw),
        body: [
          'Une planète produit des **ressources** grâce à sa population et à ses **usines**. Ses **mines** extraient trois minerais : l\'**ironium** (bleu), le **boranium** (vert) et le **germanium** (jaune).',
          `${hw.name} a ${fmt(hw.factories)} usines et ${fmt(hw.mines)} mines : ${fmt(sp.resources)} R et ${fmt(sp.mining.ironium + sp.mining.boranium + sp.mining.germanium)} kt de minerais extraits par an.`,
          'Chaque vaisseau, chaque bâtiment coûte des ressources **et** des minerais. Plus de population fait tourner plus d\'usines, donc plus de ressources : la croissance est le moteur de tout le reste.',
          'La concentration (conc.) d\'un minerai baisse à mesure qu\'on le creuse. Un jour, il faudra en chercher ailleurs.',
        ],
      },
      {
        id: 'queue', title: 'La file de production', target: '[data-tut=prod]',
        enter: () => { selectPlanet(hw); unfoldQueue(); },
        body: [
          'Chaque planète a sa **file de production**. Chaque année, elle y dépense ses ressources et ses minerais **dans l\'ordre, de haut en bas**.',
          `Celle de ${hw.name} contient deux éléments **automatiques**, « ${L.autoFactories} » et « ${L.autoMines} ». Ils restent dans la file et construisent chaque année autant d'usines et de mines que la population peut en faire tourner. Au début, c'est le meilleur réglage : gardez-les.`,
        ],
      },
      {
        id: 'open-prod', title: 'Ouvrir la file', target: '[data-tut=prod-edit]',
        enter: () => { selectPlanet(hw); unfoldQueue(); },
        body: [`Construisons un vaisseau. Cliquez sur **${L.edit}** sous la file.`],
        todo: `Ouvrez la file de production de ${hw.name}.`,
        goal: () => store.isOpen('production'),
        doIt: () => store.open('production', { planetId: hw.id }),
      },
      {
        id: 'add-scout', title: 'Commander un éclaireur', target: sq >= 0 ? tutSel('q-' + sq) : scout ? tutSel('avail-d' + scout.id) : '[data-tut=prod-avail]',
        enter: () => { if (!store.isOpen('production')) store.open('production', { planetId: hw.id }); },
        body: [
          `À gauche, ce que ${hw.name} sait construire ; à droite, sa file. Un **éclaireur** coûte peu et part explorer : c'est le meilleur achat du début de partie.`,
          `Cliquez sur **${scout?.name ?? '?'}** dans la liste de gauche, puis sur **${L.add}** (un double-clic fait la même chose).`,
          'Montez-le ensuite **tout en haut** de la file avec la flèche ⤒. Sinon, les usines automatiques passent avant lui et dépensent les ressources de l\'année.',
        ],
        todo: `${scout?.name ?? '?'} en tête de la file.`,
        goal: () => !scout || (hw.queue[0]?.kind === 'ship' && hw.queue[0].designId === scout.id),
        doIt: () => {
          if (!scout) return;
          store.checkpoint();
          const i = scoutQ();
          if (i >= 0) { const [it] = hw.queue.splice(i, 1); hw.queue.unshift(it); }
          else hw.queue.unshift({ kind: 'ship', designId: scout.id, qty: 1, allocated: { ironium: 0, boranium: 0, germanium: 0, resources: 0 } });
          store.bump();
        },
      },
      {
        id: 'close-prod', title: 'Rien à valider', target: '[data-tut=prod-ok]',
        body: [
          `La colonne **Fin** estime quand chaque ligne sera terminée${sq === 0 && est[0]?.lastYear ? ` : l'éclaireur sortira du chantier ${est[0].lastYear <= 1 ? 'dès l\'an prochain' : `dans ${years(est[0].lastYear)}`}` : ''}.`,
          'Vos ordres sont pris en compte immédiatement, il n\'y a rien à valider. Fermez la fenêtre avec **OK**.',
        ],
        todo: 'Fermez la fenêtre de production.',
        goal: () => !store.isOpen('production'),
        doIt: () => store.close('production'),
      },
    ];
  },
};

const RESEARCH: Chapter = {
  id: 'research', core: true, title: 'Faire de la recherche', blurb: 'Les six domaines et le budget.',
  steps: () => {
    const m = me();
    return [
      {
        id: 'open-research', title: 'La recherche', target: '[data-tut=tab-research]',
        body: [`La recherche débloque de meilleurs moteurs, coques, armes et scanners, la terraformation, et bien d'autres choses. Ouvrez l'onglet **${L.research}**.`],
        todo: `Ouvrez l'onglet ${L.research}.`,
        goal: () => store.tab === 'research',
        doIt: () => store.goTab('research'),
      },
      {
        id: 'fields', title: 'Six domaines', target: '[data-tut=fields]',
        enter: () => { if (store.tab !== 'research') store.goTab('research'); },
        body: [
          'La recherche avance dans six domaines. Chaque niveau atteint débloque des pièces de vaisseaux et des technologies. Survolez le nom d\'un domaine pour voir ce qu\'il apporte.',
          `Un seul domaine reçoit vos points (le bouton rond de la ligne). Pour ce tutoriel, choisissez **${FIELD_NAMES.propulsion}** : de meilleurs moteurs accélèrent l'exploration et la colonisation.`,
          'Les percées sont en partie aléatoires : passé la moitié du coût d\'un niveau, chaque année donne une chance de l\'atteindre (colonne « Cette année »).',
        ],
        todo: `Choisissez ${FIELD_NAMES.propulsion}.`,
        goal: () => m.researching === 'propulsion',
        doIt: () => { store.checkpoint(); m.researching = 'propulsion'; m.researchGoal = undefined; store.bump(); },
      },
      {
        id: 'budget', title: 'Le budget', target: '[data-tut=budget]',
        body: [
          `${m.researchPct} % de vos ressources vont à la recherche, soit ${fmt(researchPerYear())} points l'an prochain. C'est peu, et c'est voulu : au début, une usine construite rapporte pendant toute la partie, alors que quelques points de recherche de plus ne changent presque rien.`,
          `Augmentez cette part plus tard, quand vos planètes seront bien équipées. Plus bas dans la page, **${L.aim}** laisse le jeu choisir lui-même les domaines menant à une technologie précise.`,
        ],
      },
      {
        id: 'back-map', title: 'Retour à la carte', target: '[data-tut=tab-map]',
        body: [`Revenez sur la carte : onglet **${L.map}**, ou touche [[Échap]].`],
        todo: `Ouvrez l'onglet ${L.map}.`,
        goal: () => store.tab === 'map',
        doIt: () => store.goTab('map'),
      },
    ];
  },
};

const EXPLORE: Chapter = {
  id: 'explore', core: true, title: 'Explorer', blurb: 'Donner des ordres aux flottes.',
  steps: () => {
    const g = game(), t = T(), hw = home();
    const scout = F(t.scoutFleet), probe = F(t.probeFleet), ark = F(t.arkFleet);
    const uranie = P(t.scout)!, rorqual = P(t.probe)!;
    const est = scout ? estimateRoute(g, scout) : [];
    const arrival = est.length ? est[est.length - 1].arrival : 0;
    const names = myFleets().filter(f => t.startFleets.includes(f.id)).map(f => f.name);
    return [
      {
        id: 'fleets', title: 'Vos vaisseaux', target: '[data-tut=side]',
        enter: () => { if (store.tab !== 'map') store.goTab('map'); drawer(true); },
        body: [
          `La colonne de gauche liste vos colonies, puis vos flottes. Les ${me().name} commencent avec ${names.length} vaisseaux : ${names.join(', ')}.`,
          `${scout?.name ?? '?'} et ${probe?.name ?? '?'} ont des scanners et beaucoup de carburant : ce sont vos explorateurs. ${ark?.name ?? '?'} est une arche, qui transporte des colons.`,
          `Le groupe « ${L.idle} » rassemble les flottes qui attendent vos ordres. Un vaisseau qui attend ne rapporte rien : à la fin d'un tour, ce groupe devrait être vide.`,
        ],
      },
      {
        id: 'select-scout', title: 'Sélectionner l\'éclaireur', target: scout ? tutSel('fleet-' + scout.id) : null,
        enter: () => { if (store.tab !== 'map') store.goTab('map'); store.collapsed['sb-idle'] = false; drawer(true); store.bump(); },
        body: [`Cliquez sur **${scout?.name ?? '?'}** dans la liste de gauche (ou sur son icône, sur la carte).`],
        todo: `Sélectionnez ${scout?.name ?? '?'}.`,
        goal: () => !scout || (store.commanded?.kind === 'fleet' && store.commanded.id === scout.id && store.selected?.kind === 'fleet' && store.selected.id === scout.id),
        doIt: () => selectFleet(scout),
      },
      {
        id: 'route-scout', title: 'Donner une destination', target: { planet: uranie.id },
        enter: () => { show((hw.x + uranie.x) / 2, (hw.y + uranie.y) / 2, 1.8); if (scout && commandedFleet() !== scout) store.select({ kind: 'fleet', id: scout.id }); },
        body: [
          `Pour envoyer une flotte quelque part : **Maj + clic** sur la destination. L'étoile grise entourée, **${uranie.name}**, n'a jamais été analysée. L'éclaireur étant sélectionné, maintenez [[Maj]] et cliquez dessus.`,
          `Sur un écran tactile : touchez **${L.steps}** au-dessus de la carte, puis la destination.`,
        ],
        todo: `Envoyez ${scout?.name ?? '?'} vers ${uranie.name}.`,
        goal: () => !scout || scout.waypoints.length > 1,
        doIt: () => { if (!scout) return; store.checkpoint(); sendFleet(g, scout, uranie.id, 'explore'); store.select({ kind: 'fleet', id: scout.id }); store.waypointIndex = 1; store.bump(); },
      },
      {
        id: 'route-details', title: 'Vitesse, carburant, durée', target: '[data-tut=route]',
        enter: () => { if (scout) { store.select({ kind: 'fleet', id: scout.id }); store.waypointIndex = Math.min(1, scout.waypoints.length - 1); store.bump(); } },
        body: [
          `Le panneau montre l'itinéraire : chaque étape, sa vitesse (**Warp**), la durée et le carburant consommé.${arrival > 0 ? ` ${scout?.name} arrivera dans ${years(arrival)}.` : ''}`,
          `Plus on va vite, plus on consomme : au-delà de la **vitesse idéale** de ses moteurs, une flotte brûle son carburant à toute allure. **${L.speed}** choisit la vitesse la plus rapide sans gaspillage.`,
          'Le plein se refait gratuitement en orbite de vos planètes équipées d\'une station. Une flotte à sec se traîne à Warp 1 : surveillez la jauge.',
        ],
      },
      {
        id: 'select-probe-target', title: 'Le raccourci', target: { planet: rorqual.id },
        enter: () => show((hw.x + rorqual.x) / 2, (hw.y + rorqual.y) / 2, 1.8),
        body: [`Il existe une méthode encore plus simple. Cliquez sur **${rorqual.name}**, l'autre étoile grise entourée.`],
        todo: `Sélectionnez ${rorqual.name}.`,
        goal: () => (store.selected?.kind === 'planet' && store.selected.id === rorqual.id) || myFleets().some(f => heading(f, rorqual.id)) || explored(rorqual),
        doIt: () => selectPlanet(rorqual),
      },
      {
        id: 'mission-button', title: 'Envoyer un éclaireur', target: '[data-tut=mission]',
        enter: () => { if (!myFleets().some(f => heading(f, rorqual.id)) && !explored(rorqual)) selectPlanet(rorqual); },
        body: [
          `Pour une planète inexplorée, le panneau propose **${L.scoutBtn}** : le jeu choisit le vaisseau prêt le plus rapide à arriver, et calcule route et vitesse. Cliquez.`,
          'Pour un monde déjà analysé, le même bloc propose d\'y envoyer une arche, ou un vaisseau de minage.',
        ],
        todo: `Envoyez un éclaireur vers ${rorqual.name}.`,
        goal: () => myFleets().some(f => heading(f, rorqual.id)) || explored(rorqual),
        doIt: () => { const o = sendOptions(g, me(), rorqual.id, 'explore')[0]; if (o) { store.checkpoint(); sendFleet(g, o.fleet, rorqual.id, 'explore'); store.bump(); } },
      },
    ];
  },
};

const COLONIZE: Chapter = {
  id: 'colonize', core: true, title: 'Coloniser', blurb: 'Habitabilité, planificateur, arches.',
  steps: () => {
    const g = game(), t = T(), hw = home();
    const igloo = P(t.colony)!, ark = F(t.arkFleet);
    const v = valueOf(igloo) ?? 0;
    const arkGoing = () => myFleets().some(f => f.waypoints.some((w, k) => k > 0 && w.task === 'colonize')) || mine().length > 1;
    return [
      {
        id: 'habitability', title: 'Où vivre ?', target: '[data-tut=hab]',
        enter: () => selectPlanet(igloo),
        body: [
          `Voici **${igloo.name}**, à ${fmt(distance(igloo, hw), 0)} al de ${hw.name}. Vos scanners l'ont déjà analysée : sa valeur pour les ${me().name} est de **${v} %**.`,
          'La valeur résume trois conditions : la gravité, la température et les radiations. Chaque barre montre la valeur de la planète et la plage que supporte votre espèce.',
          'Au-dessus de 0 %, une colonie grandit ; en dessous, sa population meurt peu à peu. Plus la valeur est haute, plus la planète peut accueillir d\'habitants.',
        ],
      },
      {
        id: 'planner', title: 'Le planificateur de colonies', target: '[data-tut=tab-planner]',
        body: [`Pour comparer tous les mondes connus, ouvrez l'onglet **${L.planner}** (touche [[C]]). Il les classe par valeur, avec leur distance et leur population maximale.`],
        todo: `Ouvrez le ${L.planner}.`,
        goal: () => store.tab === 'planner' || arkGoing(),
        doIt: () => store.goTab('planner'),
      },
      {
        id: 'send-ark', title: 'Envoyer l\'arche', target: tutSel('plan-' + igloo.id),
        enter: () => { if (store.tab !== 'planner' && !arkGoing()) store.goTab('planner'); },
        body: [
          `${igloo.name} est en tête de liste. Cliquez sur **${L.arkBtn}**, sur sa ligne : ${ark?.name ?? '?'} embarquera des colons sur ${hw.name} en partant, et fondera une colonie à l'arrivée.`,
          'Sans arche disponible, le même bouton propose d\'en construire une : elle partira seule une fois terminée.',
        ],
        todo: `Envoyez l'arche vers ${igloo.name}.`,
        goal: arkGoing,
        doIt: () => { const o = sendOptions(g, me(), igloo.id, 'colonize')[0]; if (o) { store.checkpoint(); sendFleet(g, o.fleet, igloo.id, 'colonize'); store.bump(); } },
      },
      {
        id: 'colonists', title: 'Une colonie, ça grandit', target: '[data-tut=tab-map]',
        body: [
          'Une colonie commence petite : quelques millions d\'habitants, qui se multiplient d\'année en année si la planète leur convient. Elle construit ses propres usines et mines, et paie à son tour vos projets.',
          'L\'arche ne sert qu\'une fois : elle se démonte à l\'arrivée pour bâtir la colonie. Pour la suivante, il faudra en construire une autre.',
          `Retournez sur l'onglet **${L.map}**.`,
        ],
        todo: `Ouvrez l'onglet ${L.map}.`,
        goal: () => store.tab === 'map',
        doIt: () => store.goTab('map'),
      },
    ];
  },
};

const TURN: Chapter = {
  id: 'turn', core: true, title: 'Le temps passe', blurb: 'Tour suivant, rapports, flottes en attente.',
  steps: () => {
    const g = game(), t = T(), hw = home();
    const igloo = P(t.colony)!, uranie = P(t.scout)!, rorqual = P(t.probe)!;
    const ns = newScout();
    const target = nextColony();
    const tv = target ? valueOf(target) ?? 0 : 0;
    const arkFor = (p: Planet) => { const st = missionStatus(g, me(), p.id); return st.arks.length > 0 || st.queued.some(q => q.kind === 'colonize') || p.owner === g.human; };
    return [
      {
        id: 'end-turn', title: 'Tour suivant', target: '[data-tut=next]', turn: true,
        enter: () => { if (store.tab !== 'map') store.goTab('map'); },
        body: [
          `Les ordres de l'année sont donnés : un éclaireur en chantier, la recherche orientée, deux explorateurs en route, une arche en partance. Cliquez sur **${L.next}** (ou appuyez sur [[Entrée]]).`,
          'Rien ne presse jamais : on passe autant de temps qu\'on veut sur un tour. Une fois l\'année calculée, en revanche, ses ordres ne peuvent plus être annulés.',
        ],
        todo: `Cliquez sur ${L.next}.`,
        goal: () => g.year > 2400,
        doIt: () => void store.endTurn(1),
      },
      {
        id: 'reports', title: 'Les rapports de l\'année', target: '[data-tut=reports]',
        enter: () => { if (store.tab !== 'map') store.goTab('map'); },
        body: [
          `Sous la carte, les **rapports** racontent l'année écoulée (${me().messages.length} cette fois). Les flèches ↑ ↓ (ou celles du clavier) les font défiler ; un clic sur un rapport montre l'objet concerné.`,
          'Lisez-les à chaque tour : c\'est là qu\'on apprend qu\'une colonie est fondée, qu\'un vaisseau est arrivé, ou qu\'un ennemi approche. L\'onglet **Rapports** garde l\'historique et les batailles.',
        ],
      },
      {
        id: 'new-colony', title: 'Première colonie', target: { planet: igloo.id },
        enter: () => show(igloo.x, igloo.y, 1.6),
        body: igloo.owner === g.human ? [
          `**${igloo.name}** est votre première colonie : votre empire compte maintenant ${mine().length} planètes.`,
          'Sa file de production s\'est remplie toute seule (le modèle « Colonie standard ») : usines et mines automatiques, et terraformation dès que la technologie le permettra. Elle se développera sans vous.',
        ] : [`L'arche n'est pas encore arrivée à ${igloo.name}. Passez un tour de plus.`],
        todo: igloo.owner === g.human ? undefined : `Attendez la fondation de la colonie (${L.next}).`,
        goal: () => mine().length > 1,
        doIt: () => {
          // an ark must be on its way (the chapter may have been opened from the list)
          if (!myFleets().some(f => f.waypoints.some((w, k) => k > 0 && w.task === 'colonize'))) { const o = sendOptions(g, me(), igloo.id, 'colonize')[0]; if (o) sendFleet(g, o.fleet, igloo.id, 'colonize'); }
          void store.endTurn(1);
        },
        turn: true,
      },
      {
        id: 'idle', title: 'Un nouveau vaisseau attend', target: ns ? tutSel('fleet-' + ns.id) : '[data-tut=sb-idle]',
        enter: () => { store.collapsed['sb-idle'] = false; drawer(true); store.bump(); },
        body: ns ? [
          `L'éclaireur commandé l'an dernier est sorti du chantier : **${ns.name}** attend dans « ${L.idle} ».`,
          'Envoyez-le explorer : sélectionnez-le, puis Maj + clic sur une étoile grise. Pour aller loin, visez au-delà de vos premières explorations.',
          'Astuce : la touche [[I]] sélectionne tour à tour chaque flotte sans ordre.',
        ] : ['Pas de nouvel éclaireur (il n\'a pas été construit, ou il a déjà ses ordres). Retenez l\'idée : chaque vaisseau neuf apparaît dans « Sans mission » et attend vos ordres.'],
        todo: ns ? `Envoyez ${ns.name} explorer.` : undefined,
        goal: () => { const f = newScout(); return !f || f.waypoints.length > 1; },
        doIt: () => { const f = newScout(); const p = f && nearestUnknown(f); if (f && p) { store.checkpoint(); sendFleet(g, f, p.id, 'explore'); store.select({ kind: 'fleet', id: f.id }); store.bump(); } },
      },
      {
        id: 'arrivals', title: 'Laisser passer le temps', target: explored(uranie) || explored(rorqual) ? { planet: explored(uranie) ? uranie.id : rorqual.id } : '[data-tut=next]', turn: true,
        enter: () => { if (explored(uranie) || explored(rorqual)) show((uranie.x + rorqual.x) / 2, (uranie.y + rorqual.y) / 2, 1.8); },
        body: explored(uranie) || explored(rorqual) ? [
          explored(uranie) && explored(rorqual) ? `Regardez la carte : ${uranie.name} et ${rorqual.name} ont déjà pris leur couleur.` : `Regardez la carte : ${(explored(uranie) ? uranie : rorqual).name} a déjà pris sa couleur.`,
          'Vos explorateurs ne sont pas encore arrivés, mais leurs **scanners pénétrants** analysent les planètes à distance : ils les ont vues en chemin.',
          'Un bon éclaireur n\'a donc pas besoin de se poser partout : il suffit de passer assez près. Le cercle jaune autour de chaque vaisseau montre cette portée d\'analyse.',
          'Le menu **⋯** peut aussi générer 5 ou 10 années d\'un coup, quand rien ne demande votre attention.',
        ] : [
          `Vos explorateurs approchent de ${uranie.name} et ${rorqual.name}. Passez au tour suivant : les planètes qu'ils analysent prendront leur couleur.`,
          'Le menu **⋯** peut aussi générer 5 ou 10 années d\'un coup, quand rien ne demande votre attention.',
        ],
        todo: 'Passez un tour, jusqu\'à l\'arrivée des explorateurs.',
        goal: () => explored(uranie) || explored(rorqual),
        doIt: () => {
          for (const p of [uranie, rorqual]) if (!myFleets().some(f => heading(f, p.id))) { const o = sendOptions(g, me(), p.id, 'explore')[0]; if (o) sendFleet(g, o.fleet, p.id, 'explore'); }
          void store.endTurn(1);
        },
      },
      {
        id: 'discovered', title: 'Explorer, puis coloniser', target: target ? '[data-tut=mission]' : null,
        enter: () => { if (target) selectPlanet(target); },
        body: target ? [
          `${target.name} est analysée : valeur **${tv} %** pour les ${me().name}. Une excellente cible pour votre prochaine arche.`,
          `Vous n'avez plus d'arche ? Le panneau propose **${L.buildArk}** : l'arche est ajoutée en tête de la file du meilleur chantier, et part seule pour ${target.name} une fois construite.`,
          'C\'est la boucle de base du jeu : **explorer, coloniser, développer**, et recommencer un peu plus loin.',
        ] : ['Aucun monde favorable n\'est encore connu. C\'est la boucle de base du jeu : **explorer, coloniser, développer**. Continuez d\'explorer, et envoyez une arche dès qu\'une planète verte apparaît.'],
        todo: target ? `Commandez une arche pour ${target.name}.` : undefined,
        goal: () => !target || arkFor(target),
        doIt: () => {
          if (!target) return;
          const d = arkDesign(); const o = d && buildOptions(g, me(), target.id, 'colonize', d).find(x => x.reachable);
          const send = sendOptions(g, me(), target.id, 'colonize')[0];
          store.checkpoint();
          if (send) sendFleet(g, send.fleet, target.id, 'colonize');
          else if (o) queueMission(g, o.planet, o.design, { kind: 'colonize', planetId: target.id });
          store.bump();
        },
      },
    ];
  },
};

const DEFEND: Chapter = {
  id: 'defend', core: true, title: 'Se défendre', blurb: 'Modèles de vaisseaux, batailles, stations.',
  steps: () => {
    const war = myFleets().find(f => { const s = fleetSpec(game(), f); return s.hasWeapons && !isPureScout(s) && f.id !== T().probeFleet; });
    return [
      {
        id: 'design', title: 'Des vaisseaux sur mesure', target: '[data-tut=tab-design]',
        body: [
          `Un vaisseau est construit selon un **modèle** : une coque, plus des pièces (moteurs, armes, blindages, boucliers, scanners, soutes). L'onglet **${L.design}** montre vos modèles et permet d'en créer, avec les pièces que la recherche débloque.`,
          'Ouvrez-le pour jeter un œil à vos modèles de départ.',
        ],
        todo: `Ouvrez l'onglet ${L.design}.`,
        goal: () => store.tab === 'design',
        doIt: () => store.goTab('design'),
      },
      {
        id: 'combat', title: 'Les batailles', target: '[data-tut=tab-reports]',
        body: [
          'Les combats sont automatiques : quand des flottes ennemies se croisent, ou qu\'une flotte armée arrive sur une planète ennemie, la bataille se joue seule, selon le **plan de bataille** de chaque flotte. Le compte rendu, avec la rediffusion, arrive dans les **Rapports**.',
          'Ce qui décide d\'une bataille : le nombre et la qualité des vaisseaux, donc votre production et votre recherche. La **station orbitale** d\'une planète la défend et sert de chantier naval ; les **défenses** planétaires la protègent des bombes et des invasions.',
          `Des pirates apparaissent au bout d'une dizaine d'années et pillent les colonies riches et mal défendues.${war ? ` Votre ${war.name} peut monter la garde.` : ''} Les empires rivaux, eux, ne restent pas loin pour toujours.`,
        ],
      },
    ];
  },
};

const HABITS: Chapter = {
  id: 'habits', core: true, title: 'Les bons réflexes', blurb: 'La routine d\'un tour, sauvegarder, gagner.',
  steps: () => {
    const v = game().settings.victory;
    const crit = [v.ownPlanets !== null && VICTORY_LABELS[0].replace('{ownPlanets}', String(v.ownPlanets)), v.attainTech && VICTORY_LABELS[1].replace('{level}', String(v.attainTech.level)).replace('{fields}', String(v.attainTech.fields)), v.exceedScore !== null && VICTORY_LABELS[2].replace('{exceedScore}', String(v.exceedScore)), v.exceedSecond !== null && VICTORY_LABELS[3].replace('{exceedSecond}', String(v.exceedSecond)), v.production !== null && VICTORY_LABELS[4].replace('{production}', String(v.production)), v.capitalShips !== null && VICTORY_LABELS[5].replace('{capitalShips}', String(v.capitalShips)), v.highestAfter !== null && VICTORY_LABELS[6].replace('{highestAfter}', String(v.highestAfter))].filter(Boolean) as string[];
    return [
      {
        id: 'routine', title: 'La routine d\'un tour', target: '[data-tut=reports]',
        enter: () => { if (store.tab !== 'map') store.goTab('map'); },
        body: [
          'Un bon tour tient en cinq gestes :',
          '• lire les **rapports** ;',
          `• donner un ordre aux flottes « **${L.idle}** » ;`,
          '• vérifier qu\'aucune **file de production** n\'est vide (un point orange le signale dans la liste des colonies) ;',
          '• jeter un œil à la **recherche** ;',
          `• **${L.next}**.`,
          'Sous les rapports, la barre « à faire » rappelle ce qui attend (éclaireurs sans ordre, files vides...) : un clic mène à l\'objet.',
        ],
      },
      {
        id: 'safety', title: 'Annuler, sauvegarder, s\'informer', target: '[data-tut=actions]',
        body: [
          `**${L.undo}** ([[Ctrl+Z]]) défait le dernier ordre de l'année en cours. La partie s'enregistre seule dans ce navigateur ; **${L.exportBtn}** en fait un fichier, à garder en lieu sûr ou à reprendre sur un autre ordinateur.`,
          `Le menu **⋯** donne accès au reste : plusieurs années d'un coup, paramètres, raccourcis clavier, et ce tutoriel. L'onglet **${L.guide}** ([[F1]]) explique chaque règle en détail.`,
        ],
      },
      {
        id: 'victory', title: 'Comment gagner', target: '[data-tut=tab-reports]',
        body: [
          `Dans cette partie, la victoire va au premier empire qui remplit ${v.numCriteria > 1 ? `${v.numCriteria} de ces conditions` : 'l\'une de ces conditions'}, pas avant ${v.minYears} ans de partie :`,
          ...crit.map(c => `• ${c}`),
          `Les mégaprojets offrent d'autres chemins vers la victoire. L'onglet **${L.reports}** compare votre score à celui de vos rivaux.`,
        ],
      },
    ];
  },
};

// ------------------------------------------------------------------ going further (optional chapters)

/** A colony that is not the homeworld (the first one, normally), else the homeworld. */
const aColony = (): Planet => { const t = T(); const c = P(t.colony); return c && c.owner === game().human ? c : mine().find(p => !p.homeworld) ?? home(); };
const fleetWith = (ok: (sp: ReturnType<typeof fleetSpec>) => boolean) => myFleets().find(f => ok(fleetSpec(game(), f)));
const setMode = (m: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8) => { store.view.mode = m; store.savePrefs(); store.bump(); };
/** A design made since the tutorial began. */
const newDesign = () => game().designs.find(d => d.owner === game().human && !d.deleted && !(T().startDesigns ?? []).includes(d.id));

const SHIPS: Chapter = {
  id: 'ships', core: false, title: 'Concevoir des vaisseaux', blurb: 'Coques, pièces, caractéristiques, mises à jour.',
  steps: () => {
    const hull = availableHulls(me(), false).find(h => h.name === 'Destroyer') ?? availableHulls(me(), false)[0];
    return [
      {
        id: 'open', title: 'Vos modèles', target: '[data-tut=tab-design]',
        body: [`Chaque vaisseau sort d'un **modèle**. L'onglet **${L.design}** ([[F4]]) liste les vôtres : à gauche la liste, à droite le plan du modèle choisi, ses caractéristiques et son coût.`],
        todo: `Ouvrez l'onglet ${L.design}.`,
        goal: () => store.tab === 'design',
        doIt: () => store.goTab('design'),
      },
      {
        id: 'stats', title: 'Ce qui compte dans un modèle', target: '.ds-main',
        enter: () => { if (store.tab !== 'design') store.goTab('design'); },
        body: [
          'Les **moteurs** donnent la vitesse idéale ; les **réservoirs**, l\'autonomie. Le **blindage** et les **boucliers** encaissent les coups ; la **puissance** résume l\'armement. Et la **masse** pèse sur tout : un vaisseau lourd consomme davantage.',
          'Sous un modèle armé, le **simulateur de combat** le fait affronter 40 fois un modèle ennemi connu (ou l\'un des vôtres) : de quoi vérifier un modèle avant d\'en lancer la production.',
        ],
      },
      {
        id: 'hull', title: 'Choisir une coque', target: '.ds-left',
        body: [
          'Pour créer un modèle : onglet **Coques**, choisissez une coque, puis **Nouveau modèle sur cette coque**. Une grande coque offre plus d\'emplacements, et coûte plus cher. La recherche en Construction en débloque de nouvelles.',
          'On peut aussi partir d\'un modèle existant : **Copier le modèle**.',
        ],
        todo: 'Ouvrez le concepteur sur une coque.',
        goal: () => (typeof document !== 'undefined' && !!document.querySelector('.editor')) || (store.tab === 'design' && !!store.tabData?.newHull) || !!newDesign(),
        doIt: () => store.goTab('design', { newHull: hull?.name }),
      },
      {
        id: 'editor', title: 'Placer les pièces', target: '.editor',
        body: [
          'Glissez une pièce de la liste de gauche sur un emplacement du plan (ou cliquez la pièce, puis l\'emplacement). Chaque emplacement accepte certains types de pièces, écrits dessus ; un vaisseau a besoin d\'au moins un moteur.',
          `Les caractéristiques se mettent à jour à chaque pièce posée. **Enregistrer le modèle** le rend constructible dans tous vos chantiers.`,
        ],
        todo: 'Enregistrez un nouveau modèle.',
        goal: () => !!newDesign(),
        doIt: () => {
          const g = game(), m = me();
          const d = (hull && (autoDesign(m, hull.name, 'beamWarship', 'Escorteur') ?? autoDesign(m, hull.name, 'startingFighter', 'Escorteur'))) ?? autoDesign(m, 'Scout', 'scout', 'Escorteur');
          if (!d) return;
          store.checkpoint();
          const nd = addDesign(g, { ...d, owner: m.id, built: 0 });
          store.goTab('design', { designId: nd.id });
        },
      },
      {
        id: 'upgrade', title: 'Rester à jour', target: '[data-tut=tab-research]',
        body: [
          'Quand la recherche débloque une meilleure pièce, un rapport le signale, et la page **Recherche** propose de **mettre à jour** vos modèles d\'un clic.',
          'Les vaisseaux déjà construits gardent leur équipement. En orbite d\'un chantier, le bloc **Modernisation** d\'une flotte les remet à niveau : on ne paie que les pièces changées, et un peu de main-d\'œuvre.',
        ],
      },
    ];
  },
};

const ORDERS: Chapter = {
  id: 'orders', core: false, title: 'Ordres avancés', blurb: 'Tâches, cargaisons, itinéraires, flottes.',
  steps: () => {
    const cargo = fleetWith(sp => sp.cargoCapacity > 0 && !sp.colonizer) ?? myFleets()[0];
    return [
      {
        id: 'task', title: 'Une tâche à chaque étape', target: '[data-tut=task]',
        enter: () => selectFleet(cargo),
        body: [
          `Voici ${cargo?.name ?? '?'}, un cargo. Chaque étape d'un itinéraire peut porter une **tâche**, exécutée à l'arrivée : transporter (charger ou décharger minerais et colons), coloniser, forer, poser des mines, patrouiller, fusionner avec une autre flotte, rester en poste, moderniser...`,
          'Cliquez sur une étape dans la liste de l\'itinéraire, puis choisissez sa tâche dans ce menu.',
        ],
      },
      {
        id: 'cargo', title: 'Charger et décharger', target: '[data-tut=cargo]',
        enter: () => selectFleet(cargo),
        body: [
          '**Échanger** ouvre la cargaison : on y fait passer minerais, colons et carburant entre la flotte et la planète (ou une autre flotte au même endroit).',
          'Un cargo sert à porter des minerais d\'une planète riche vers un chantier qui en manque, ou des colons vers une jeune colonie qui grandira plus vite.',
        ],
      },
      {
        id: 'routes', title: 'Itinéraires à étapes', target: '[data-tut=route]',
        enter: () => selectFleet(cargo),
        body: [
          'Gardez [[Maj]] enfoncée et cliquez plusieurs destinations à la suite : chacune devient une étape. [[Ctrl]]+[[Maj]]+clic ajoute une étape à la fin d\'un itinéraire existant.',
          'Sur la carte, on peut **tirer** une étape pour la déplacer, ou tirer un segment du trajet pour y insérer une étape. **Répéter l\'itinéraire** fait d\'un trajet une navette sans fin.',
          'Le **clic droit** sur la carte ouvre un menu : Aller ici, Ajouter une étape, ou **Intercepter** une flotte étrangère (le point de rencontre est recalculé chaque année).',
        ],
      },
      {
        id: 'groups', title: 'Réunir et séparer', target: '[data-tut=ships]',
        enter: () => selectFleet(cargo),
        body: [
          'Une flotte peut réunir plusieurs vaisseaux, de modèles différents : elle voyage à la vitesse du plus lent. **Séparer…**, **Fusionner…** et **Absorber** (bloc « Autres flottes ici ») réorganisent vos flottes.',
          'Le **plan de bataille** de la flotte se choisit dans ce même bloc.',
        ],
      },
      {
        id: 'fleets-page', title: 'Toutes les flottes', target: '[data-tut=tab-fleets]',
        body: [`L'onglet **${L.fleets}** les présente toutes dans un tableau triable : position, mission, carburant, cargaison. Un double-clic sur une ligne montre la flotte sur la carte.`],
        todo: `Ouvrez l'onglet ${L.fleets}.`,
        goal: () => store.tab === 'fleets',
        doIt: () => store.goTab('fleets'),
      },
    ];
  },
};

const MINERALS: Chapter = {
  id: 'minerals', core: false, title: 'Minerais et minage', blurb: 'Concentrations, vaisseaux de minage, pénuries.',
  steps: () => {
    const miner = fleetWith(sp => sp.miningRate > 0);
    return [
      {
        id: 'modes', title: 'Voir les minerais', target: '[data-tut=modes]',
        enter: () => { if (store.tab !== 'map') store.goTab('map'); },
        body: [
          'Touche [[2]] : la carte montre les minerais **en surface** de chaque planète connue. Touche [[3]] : leurs **concentrations**, c\'est-à-dire ce que des mines pourraient en tirer. Les barres bleue, verte et jaune suivent l\'ironium, le boranium et le germanium.',
          'Touche [[1]] pour revenir à l\'habitabilité.',
        ],
        todo: 'Affichez les concentrations (touche 3).',
        goal: () => store.view.mode === 3,
        doIt: () => setMode(3),
      },
      {
        id: 'mining-page', title: 'Le planificateur de minage', target: '[data-tut=tab-mining]',
        body: [
          `Le **${L.mining}** ([[X]]) classe les mondes libres par richesse. Un monde riche mais invivable n'est pas perdu : un **vaisseau de minage**${miner ? ` (comme ${miner.name})` : ''} peut s'y poser et forer sans colons.`,
        ],
        todo: `Ouvrez le ${L.mining}.`,
        goal: () => store.tab === 'mining',
        doIt: () => store.goTab('mining'),
      },
      {
        id: 'remote', title: 'Forer, puis rapatrier', target: '.page',
        enter: () => { if (store.tab !== 'mining') store.goTab('mining'); },
        body: [
          'Le vaisseau de minage dépose chaque année ses minerais à la surface du monde foré. Une **navette** (un cargo en allers-retours) vient les chercher et les livre à votre capitale, ou au port de votre choix. Le planificateur organise l\'un et l\'autre d\'un clic.',
          'Les concentrations baissent à mesure qu\'on creuse : un gisement finit par s\'épuiser, et il faut aller plus loin.',
        ],
      },
      {
        id: 'shortage', title: 'Quand un minerai manque', target: '[data-tut=tab-colonies]',
        body: [
          'Quand une ligne de production traîne, la file dit ce qui la retient : les ressources, ou un minerai précis. Un bouton ouvre alors le planificateur de minage sur ce minerai.',
          'Autres remèdes : un cargo depuis une planète riche, le **réseau logistique** (politiques Exporter et Importer), ou l\'**alchimie minérale**, qui change des ressources en minerais (cher, mais rapide).',
        ],
      },
    ];
  },
};

const GROWTH: Chapter = {
  id: 'growth', core: false, title: 'Développer l\'empire', blurb: 'Croissance, colonies, stations, logistique, rendement.',
  steps: () => {
    const col = aColony();
    return [
      {
        id: 'growth', title: 'La croissance', target: '[data-tut=planet-rows]',
        enter: () => selectPlanet(col),
        body: [
          'Une population croît à plein régime jusqu\'au **quart de la capacité** de sa planète, puis de plus en plus lentement. Une planète presque pleine ne gagne presque plus rien : ses colons seraient plus utiles ailleurs.',
          `La ligne **Capacité** du panneau dit où en est ${col.name}.`,
        ],
      },
      {
        id: 'colonies-page', title: 'Toutes les colonies', target: '[data-tut=tab-colonies]',
        body: [
          `L'onglet **${L.colonies}** ([[F3]]) réunit vos planètes : population, ressources, file de production. Cochez-en plusieurs pour leur donner le même ordre d'un coup, ou leur appliquer un **modèle de production**.`,
          'Un modèle de production est une file type. « Colonie standard » s\'applique d\'office aux nouvelles colonies ; le menu ⋯ (**Modèles de production…**) permet d\'en créer d\'autres.',
        ],
        todo: `Ouvrez l'onglet ${L.colonies}.`,
        goal: () => store.tab === 'colonies',
        doIt: () => store.goTab('colonies'),
      },
      {
        id: 'station', title: 'Une station pour chaque colonie', target: '[data-tut=station]',
        enter: () => selectPlanet(col),
        body: [
          'Une planète sans **station orbitale** ne peut ni construire de vaisseaux ni ravitailler vos flottes. Le **Fortin** coûte peu, fait le plein des flottes et défend la planète, mais n\'a pas de chantier. La **Station mère** ajoute un chantier naval.',
          'Les deux se commandent depuis la file de production de la planète.',
        ],
      },
      {
        id: 'logistics', title: 'Le réseau logistique', target: '[data-tut=empire-blk]',
        enter: () => selectPlanet(col),
        body: [
          'Le réseau déplace colons et minerais sans que vous ayez à piloter les cargos. Sur chaque planète (bloc Empire du panneau), choisissez une politique : **Émigration** ou **Immigration** pour la population, **Exporter** ou **Importer** pour les minerais.',
          'Cochez ensuite **Réseau logistique** sur des flottes de cargos : elles suivront ces politiques, en évitant les zones où l\'ennemi a été vu.',
        ],
      },
      {
        id: 'admin', title: 'Loin de la capitale', target: '#admin',
        enter: () => store.goTab('empire'),
        body: [
          `Une planète éloignée de la capitale rend moins : plein rendement jusqu'à ${ADMIN_RADIUS} al, puis −${Math.round(ADMIN_LOSS * 100)} % tous les ${ADMIN_STEP} al (au pire ${Math.round(ADMIN_FLOOR * 100)} %).`,
          'Une **capitale régionale**, construite dans la file d\'une grande colonie lointaine, rétablit le plein rendement autour d\'elle. Cette section calcule ce que chacune vous rapporterait.',
        ],
      },
      {
        id: 'terraform', title: 'La terraformation', target: '[data-tut=modes]',
        enter: () => { if (store.tab !== 'map') store.goTab('map'); },
        body: [
          'La **terraformation** rapproche la gravité, la température ou les radiations d\'une planète de l\'idéal de votre espèce : sa valeur monte, et sa capacité avec. Chaque progrès de la recherche (Biotechnologie surtout) permet d\'aller plus loin.',
          'Elle se construit dans la file : les éléments « Terraformation (auto) » de la Colonie standard s\'en chargent. Le mode de carte [[4]] montre la valeur que chaque monde atteindrait une fois terraformé.',
        ],
      },
    ];
  },
};

const WAR: Chapter = {
  id: 'war', core: false, title: 'Faire la guerre', blurb: 'Plans de bataille, défenses, mines, invasions.',
  steps: () => {
    const war = fleetWith(sp => sp.hasWeapons && sp.cargoCapacity === 0 && sp.scanRange >= 0 && !isPureScout(sp));
    const hw = home();
    return [
      {
        id: 'plans', title: 'Le plan de bataille', target: '[data-tut=ships]',
        enter: () => selectFleet(war),
        body: [
          'Une bataille se joue seule, mais selon vos consignes. Chaque flotte suit un **plan de bataille** : quelles cibles viser d\'abord (vaisseaux armés, stations, cargos...), avec quelle tactique, et à partir de quelles pertes battre en retraite.',
          'Les plans se modifient dans le menu ⋯ (**Plans de bataille…**, [[F6]]) et s\'attribuent flotte par flotte, ici.',
          'Dans **Conception**, chaque modèle armé a aussi un **rôle** : écran (attire les tirs), ligne, ou artillerie (tire de loin, reste en retrait).',
        ],
      },
      {
        id: 'defense', title: 'Défendre ses planètes', target: '[data-tut=station]',
        enter: () => selectPlanet(hw),
        body: [
          'Une planète se défend avec sa **station orbitale**, qui tire sur les assaillants, et ses **défenses** planétaires, qui arrêtent une part des bombes et des troupes. « Défenses (auto) », dans la file, en construit au rythme de la population.',
          'Une flotte armée en orbite combat aux côtés de la station.',
        ],
      },
      {
        id: 'mines', title: 'Les champs de mines', target: '[data-tut=modes]',
        enter: () => { if (store.tab !== 'map') store.goTab('map'); },
        body: [
          'Un poseur de mines (tâche « Poser des mines ») sème un **champ de mines** autour de sa position. Une flotte qui le traverse plus vite que la vitesse sûre du champ risque d\'être touchée ; le panneau d\'itinéraire prévient et propose la bonne vitesse.',
          'Les armes à rayon balaient les mines ennemies au passage. Les champs connus s\'affichent sur la carte (menu ⋯ de la carte).',
        ],
      },
      {
        id: 'invade', title: 'Prendre une planète', target: null,
        body: [
          'Pour conquérir une planète : détruire sa station, la **bombarder** (des bombardiers tuent sa population et ses défenses), puis **débarquer des colons** depuis un cargo (tâche Transport, décharger les colons). Il faut être en guerre, et vos troupes doivent dépasser ses défenseurs.',
          `Une planète conquise rend peu au début : il faut ${CONQUEST_YEARS} ans pour l'assimiler pleinement.`,
        ],
      },
      {
        id: 'radar', title: 'Le radar', target: '[data-tut=modes]',
        enter: () => { if (store.tab !== 'map') store.goTab('map'); },
        body: [
          'Le mode **Radar** (touche [[8]]) n\'affiche que les vaisseaux hostiles détectés ; en rouge, ceux qui sont sur votre territoire ou s\'y dirigent.',
          'Le compte rendu de chaque bataille, avec sa rediffusion pas à pas, se trouve dans **Rapports**. Touche [[1]] pour revenir à la carte habituelle.',
        ],
        todo: 'Passez en mode Radar (touche 8).',
        goal: () => store.view.mode === 8,
        doIt: () => setMode(8),
      },
    ];
  },
};

const DIPLOMACY: Chapter = {
  id: 'diplomacy', core: false, title: 'Diplomatie et renseignement', blurb: 'Rencontrer, négocier, espionner.',
  steps: () => {
    const met = game().players.filter(p => p.id !== game().human && !p.monster && me().intel.met?.includes(p.id)).length;
    return [
      {
        id: 'tab', title: 'Les autres empires', target: '[data-tut=tab-diplomacy]',
        body: [
          `L'onglet **${L.diplomacy}** ([[F7]]) liste les empires rencontrés${met ? ` (${met} pour l'instant)` : ' : aucun pour l\'instant'}. La rencontre se fait quand vos scanners croisent leurs vaisseaux ou leurs planètes.`,
        ],
        todo: `Ouvrez l'onglet ${L.diplomacy}.`,
        goal: () => store.tab === 'diplomacy',
        doIt: () => store.goTab('diplomacy'),
      },
      {
        id: 'relations', title: 'Paix, accords, guerre', target: '.page',
        enter: () => { if (store.tab !== 'diplomacy') store.goTab('diplomacy'); },
        body: [
          'Deux empires sont en **paix** tant que l\'un ne déclare pas la guerre. On peut proposer des accords (ambassades, commerce, coopération scientifique, alliance), offrir des minerais, ou exiger un tribut.',
          'Chaque empire a une **opinion** de vous, nourrie de vos actes : dons, accords tenus, trahisons, guerres. La réponse probable s\'affiche à côté de chaque proposition, mais rien n\'est jamais certain.',
        ],
      },
      {
        id: 'intel', title: 'Le renseignement', target: '[data-tut=tab-reports]',
        body: [
          'Ce que vous savez d\'un empire dépend de vos scanners, de vos ambassades et de vos **espions** : un « Réseau d\'espions », dans la file d\'une planète, renforce votre réseau chez un empire précis.',
          'Le dossier de chaque empire (onglet **Rapports**, Score) montre ce que vous en savez vraiment, avec la date du dernier relevé.',
        ],
      },
      {
        id: 'borders', title: 'Les frontières', target: '[data-tut=tab-map]',
        body: [
          'Chaque planète rayonne une **culture** qui dessine des frontières (case Frontières, au-dessus de la carte). On ne peut pas coloniser dans le territoire d\'un autre empire : les meilleurs emplacements se prennent tôt.',
        ],
      },
    ];
  },
};

const MYSTERIES: Chapter = {
  id: 'mysteries', core: false, title: 'Découvertes et mystères', blurb: 'Anomalies, gardiens, étoiles cachées, marchand.',
  steps: () => [
    {
      id: 'anomalies', title: 'Anomalies et sites anciens', target: '#discoveries',
      enter: () => store.goTab('empire'),
      body: [
        'La galaxie cache des **anomalies** et des **sites archéologiques**. Vos scanners les repèrent (un rapport, et un symbole sur la carte). Pour les étudier, garez dessus un vaisseau muni d\'un scanner, sans autre destination : l\'étude avance un peu chaque année. Plusieurs vaisseaux, ou une colonie sur place, l\'accélèrent.',
        'Le résultat : une technologie, des minerais, une relique... ou un choix. Un bouton **Décision à prendre** apparaît alors en haut de l\'écran. Cette section de l\'onglet Empire fait le point.',
      ],
    },
    {
      id: 'guardians', title: 'Les gardiens', target: '[data-tut=tab-planner]',
      body: [
        'Certains des mondes les plus riches sont gardés par de très anciens vaisseaux. Tout vaisseau qui s\'y arrête est attaqué : il faut une vraie flotte de guerre pour en venir à bout, et le butin en vaut la peine.',
        'Le planificateur de colonies signale ces mondes par l\'étiquette « gardé », et le jeu demande confirmation avant d\'y envoyer un vaisseau.',
      ],
    },
    {
      id: 'hidden', title: 'Les étoiles cachées', target: null,
      body: [
        'Quelques étoiles ne figurent sur aucune carte : une naine brune que seul l\'infrarouge révèle, une étoile voilée dans un nuage, un amas caché derrière un trou de ver scellé... Des indices (rapports, découvertes) mettent sur leur piste.',
        'Les **trous de ver** relient deux points éloignés de la galaxie ; il faut une technologie pour les emprunter. Le **Guide** détaille tout cela.',
      ],
    },
    {
      id: 'trader', title: 'Le marchand nomade', target: null,
      body: [
        'Un **marchand nomade** traverse parfois la galaxie. Il cède des technologies introuvables autrement, contre des minerais. Sélectionnez-le sur la carte pour voir ses offres et lui donner rendez-vous avec une flotte.',
      ],
    },
  ],
};

const GOVERN: Chapter = {
  id: 'govern', core: false, title: 'Gouverner', blurb: 'Doctrines, mégaprojets, objectifs secrets, culture.',
  steps: () => [
    {
      id: 'empire-tab', title: 'La vue d\'ensemble', target: '[data-tut=tab-empire]',
      body: [`L'onglet **${L.empire}** rassemble ce qui concerne tout l'empire : découvertes, administration, culture, pirates, réseau logistique, mégaprojets, objectifs secrets et doctrines.`],
      todo: `Ouvrez l'onglet ${L.empire}.`,
      goal: () => store.tab === 'empire',
      doIt: () => store.goTab('empire'),
    },
    {
      id: 'doctrines', title: 'Les doctrines', target: '#doctrine-sum',
      enter: () => { if (store.tab !== 'empire') store.goTab('empire'); },
      body: [
        'À certains niveaux de recherche (5 ou 6 dans la plupart des domaines), il faut choisir entre deux **doctrines** : par exemple des boucliers plus solides, ou des rayons plus destructeurs. Le choix est définitif.',
        'Un bouton **Doctrine à choisir** apparaît en haut de l\'écran le moment venu ; les choix se font dans la page Recherche.',
      ],
    },
    {
      id: 'mega', title: 'Les mégaprojets', target: '#megaprojects',
      enter: () => { if (store.tab !== 'empire') store.goTab('empire'); },
      body: [
        'Les **mégaprojets** sont des chantiers de plusieurs années aux effets durables. Le plus grand, le **Portail de l\'Ascension**, donne la victoire à qui l\'achève : tous les empires suivent sa progression, et chercheront à l\'arrêter.',
      ],
    },
    {
      id: 'objectives', title: 'Les objectifs secrets', target: '#objectives',
      enter: () => { if (store.tab !== 'empire') store.goTab('empire'); },
      body: [`Chaque empire reçoit des **objectifs secrets** ; chacun accompli rapporte ${OBJECTIVE_POINTS} points de score. Ceux des rivaux ne sont révélés qu'en fin de partie.`],
    },
    {
      id: 'culture', title: 'La culture', target: '#culture',
      enter: () => { if (store.tab !== 'empire') store.goTab('empire'); },
      body: [
        'La **culture** de vos planètes vient de leur population, de leurs bâtiments culturels et du mécénat. Elle étend votre territoire et peut, à la longue, attirer à vous des planètes étrangères mal tenues.',
        'Les bâtiments culturels se construisent dans la file des colonies, quand la recherche les permet.',
      ],
    },
  ],
};

const THREATS: Chapter = {
  id: 'threats', core: false, title: 'Pirates et crise', blurb: 'Raids, repaires, menace de fin de partie.',
  steps: () => [
    {
      id: 'pirates', title: 'Les pirates', target: '#pirates',
      enter: () => store.goTab('empire'),
      body: [
        'Après une dizaine d\'années, des **pirates** s\'installent dans des repaires. Leurs raids visent les colonies riches et mal défendues ; une alerte annonce leur cible et leur arrivée.',
        'Une flotte armée en orbite, une station armée ou des défenses limitent les dégâts. Détruire un repaire rapporte son butin. On peut aussi payer les pirates (une prime, dans la file de production) pour qu\'ils visent un rival.',
      ],
    },
    {
      id: 'crisis', title: 'La crise de fin de partie', target: '#crisis',
      enter: () => store.goTab('empire'),
      body: [
        `Bien plus tard (pas avant ${OMEN_START[game().settings.size] ?? 2480} dans une galaxie de cette taille), des présages annoncent une **crise** : une brèche s'ouvre, et des vagues de Moissonneurs en sortent pour ravager tous les empires.`,
        'Face à elle, une trêve automatique empêche les empires de se combattre autour de la brèche, et la refermer est une victoire en soi. Mieux vaut avoir une flotte prête le moment venu.',
      ],
    },
  ],
};

const COMFORT: Chapter = {
  id: 'comfort', core: false, title: 'Raccourcis et confort', blurb: 'Clavier, souris, outils pratiques.',
  steps: () => [
    {
      id: 'keys', title: 'Le clavier', target: '[data-tut=actions]',
      body: [
        '• [[Entrée]] : tour suivant ; [[Maj+F9]] : dix années ;',
        '• [[N]] / [[P]] : planète ou flotte suivante, précédente ; [[I]] : flotte sans ordre suivante ; [[V]] : centrer la carte sur la sélection ;',
        '• [[Q]] : file de production ; [[C]] et [[X]] : planificateurs ; [[F5]] : recherche ; [[F7]] : diplomatie ;',
        '• [[1]] à [[8]] : modes de carte ; [[9]] : scanners ; [[0]] : noms ;',
        '• [[Ctrl+F]] : trouver un objet ; [[Ctrl+Z]] : annuler ; [[F1]] : guide ; [[F2]] : catalogue des technologies.',
        'La liste complète est dans le menu ⋯ (**Raccourcis clavier**).',
      ],
    },
    {
      id: 'mouse', title: 'La souris', target: '[data-tut=zoom]',
      enter: () => { if (store.tab !== 'map') store.goTab('map'); },
      body: [
        'Clic droit sur la carte : un menu des objets à cet endroit, et des ordres rapides. Plusieurs objets au même endroit ? Cliquez plusieurs fois pour passer de l\'un à l\'autre.',
        '[[Alt]]+[[Maj]] et glisser : une règle pour mesurer une distance. Une planète sélectionnée, [[Ctrl]]+clic sur une autre : les vaisseaux neufs construits sur la première s\'y rendront d\'eux-mêmes.',
        'Sur écran tactile : appui long pour le menu, bouton ✚ Étapes pour les itinéraires.',
      ],
    },
    {
      id: 'tools', title: 'Outils pratiques', target: '[data-tut=actions]',
      body: [
        'Le menu ⋯ offre aussi : les **sauvegardes de secours** (les 5 derniers tours de chaque partie, copiés dans un dossier de votre ordinateur, avec Chrome ou Edge), les paramètres de la partie, le score ([[F10]]), et la langue.',
        'Plusieurs joueurs peuvent partager un même écran : à la création d\'une partie, déclarez plusieurs empires humains. Chacun donne ses ordres à son tour, sans voir ceux des autres.',
      ],
    },
  ],
};

export const CORE: Chapter[] = [START, PRODUCE, RESEARCH, EXPLORE, COLONIZE, TURN, DEFEND, HABITS];
export const MORE: Chapter[] = [SHIPS, ORDERS, MINERALS, GROWTH, WAR, DIPLOMACY, MYSTERIES, GOVERN, THREATS, COMFORT];
const ALL = () => [...CORE, ...MORE];
const counts = new Map<string, number>();
const countOf = (c: Chapter) => { let n = counts.get(c.id); if (n === undefined) { n = c.steps().length; counts.set(c.id, n); } return n; };
const chapterOf = (id: string) => ALL().find(c => c.id === id);

// ------------------------------------------------------------------ progress

function save() { store.dirty = true; store.autosaveSoon(); store.bump(); }

/** Opens a step: its setup runs once. */
function goStep(chapter: string, step: number) {
  const t = tut(); if (!t) return;
  if (chapter === 'menu' && t.chapter !== 'menu') t.back = { chapter: t.chapter, step: t.step };
  t.chapter = chapter; t.step = step; t.folded = false;
  entered = '';
  save();
}

function finishChapter(id: string) {
  const t = tut()!;
  if (!t.done.includes(id)) t.done.push(id);
  const core = CORE.findIndex(c => c.id === id);
  if (core >= 0 && core < CORE.length - 1 && !t.done.includes(CORE[core + 1].id)) return goStep(CORE[core + 1].id, 0);
  goStep('menu', 0);
}

export function nextStep() {
  const t = tut(); if (!t) return;
  const ch = chapterOf(t.chapter); if (!ch) return goStep('menu', 0);
  if (t.step + 1 < ch.steps().length) goStep(ch.id, t.step + 1);
  else finishChapter(ch.id);
}
function prevStep() {
  const t = tut(); if (!t) return;
  if (t.step > 0) return goStep(t.chapter, t.step - 1);
  const i = CORE.findIndex(c => c.id === t.chapter);
  if (i > 0) goStep(CORE[i - 1].id, countOf(CORE[i - 1]) - 1);
}

/** Starts the tutorial: a new game on the tutorial map (one save slot only). */
export function startTutorial() {
  const g = tutorialGame();
  g.id = 'tutorial';
  entered = '';
  store.setGame(g);
}

/** Shows the card again (menu ⋯ of a tutorial game). */
export function resumeTutorial() { const t = tut(); if (t) { t.hidden = false; t.folded = false; entered = ''; save(); } }

/** The tutorial from anywhere: the card of this game, the tutorial game saved in this browser, or a new one. */
export async function openTutorial(restart = false) {
  const s = store;
  if (s.game?.tutorial && !restart) return resumeTutorial();
  if (s.game) s.save();
  // (read straight from the browser's storage: the list of saved games may still be loading)
  if (!restart) {
    const g = await s.readSlot('tutorial');
    if (g?.tutorial) { g.tutorial.hidden = false; g.tutorial.folded = false; entered = ''; s.setGame(g); return; }
  }
  startTutorial();
}

/** Enter during the tutorial: the next step (true), or the turn as usual (false). */
export function tutorialEnter(): boolean {
  const t = tut();
  if (!t || t.hidden || t.folded || t.chapter === 'menu') return false;
  const st = chapterOf(t.chapter)?.steps()[t.step];
  if (!st) return false;
  const ok = !st.goal || st.goal();
  if (st.turn && !ok) return false;
  if (ok) nextStep();
  else store.notify('Faites d\'abord ce que demande le tutoriel (ou « Le faire pour moi »).');
  return true;
}

let entered = '';

// ------------------------------------------------------------------ rendering

/** **bold** and [[key]] */
function rich(text: string): ComponentChildren {
  const out: ComponentChildren[] = [];
  const re = /\*\*(.+?)\*\*|\[\[(.+?)\]\]/g;
  let last = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(m[1] !== undefined ? <b>{m[1]}</b> : <kbd>{m[2]}</kbd>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Where a target is on the screen. */
function targetRect(t: Target | null | undefined): { x: number; y: number; w: number; h: number; round: boolean } | null {
  if (!t) return null;
  if (typeof t === 'string') {
    const el = document.querySelector(t) as HTMLElement | null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    return { x: r.left, y: r.top, w: r.width, h: r.height, round: false };
  }
  if (store.tab !== 'map') return null;
  const g = store.game; if (!g) return null;
  const o = 'planet' in t ? g.planets[t.planet] : g.fleets.find(f => f.id === t.fleet);
  const cv = document.querySelector('.map-wrap')?.querySelector('canvas') as HTMLElement | null;
  if (!o || !cv) return null;
  const r = cv.getBoundingClientRect(), c = store.camera, Z = uiZoom();
  const x = r.left + (o.x - c.x) * c.zoom * Z + r.width / 2, y = r.top + (o.y - c.y) * c.zoom * Z + r.height / 2;
  if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
  const rad = 20 * Z;
  return { x: x - rad, y: y - rad, w: rad * 2, h: rad * 2, round: true };
}

const overlap = (a: DOMRect | { left: number; top: number; right: number; bottom: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.left < b.x + b.w + 12 && a.right > b.x - 12 && a.top < b.y + b.h + 12 && a.bottom > b.y - 12;

/** The card stays where the player dragged it (until a double-click on its title). */
let dragged: { x: number; y: number } | null = null;

export function Tutorial() {
  const s = useStore();
  const t = s.game?.tutorial;
  const card = useRef<HTMLDivElement>(null);
  const spot = useRef<HTMLDivElement>(null);
  const [quitting, setQuitting] = useState(false);
  // panning and zooming do not redraw the interface: the card listens to the camera itself (the map step)
  const [, setCamTick] = useState(0);
  useEffect(() => { let raf = 0; const off = store.subscribeCamera(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setCamTick(x => x + 1)); }); return () => { off(); cancelAnimationFrame(raf); }; }, []);
  const key = t ? `${t.chapter}:${t.step}` : '';
  const ch = t && t.chapter !== 'menu' ? chapterOf(t.chapter) : undefined;
  const steps = ch ? ch.steps() : [];
  const st = ch ? steps[Math.min(t!.step, steps.length - 1)] : undefined;
  const done = !!st && (!st.goal || st.goal());
  const targetNow = useRef<Target | null | undefined>(null);
  targetNow.current = st?.target;
  // goals that the interface does not announce (a page's own state): checked twice a second
  useEffect(() => { if (!st?.goal) return; const id = setInterval(() => setCamTick(x => x + 1), 500); return () => clearInterval(id); }, [key]);
  // the setup of a step, once
  useEffect(() => {
    if (!t || t.hidden || !st || entered === key) return;
    entered = key;
    // a button clicked for the previous step keeps the focus, and Enter would click it again: Enter belongs to the tutorial
    const a = document.activeElement as HTMLElement | null;
    if (a && a.tagName === 'BUTTON' && !a.closest('.tut-card')) a.blur();
    st.enter?.();
    doneAtEnter = !!st.goal && st.goal();
    setQuitting(false);
    // a target inside a scrolled panel comes into view
    requestAnimationFrame(() => { if (typeof st.target === 'string') (document.querySelector(st.target) as HTMLElement | null)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); });
  }, [key, t?.hidden]);
  // an action just done: on to the next step
  useEffect(() => {
    if (!st?.goal || !done || doneAtEnter) return;
    const k = key;
    const timer = setTimeout(() => { const cur = tut(); if (cur && `${cur.chapter}:${cur.step}` === k && st.goal!()) nextStep(); }, 900);
    return () => clearTimeout(timer);
  }, [done, key]);
  // ring around the target, and the card out of its way
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const r = !t || t.hidden || t.folded ? null : targetRect(targetNow.current);
      const sp = spot.current, cd = card.current;
      // 0.3.9: measured in screen pixels, placed in the (possibly zoomed) interface's own
      const Z = uiZoom();
      if (sp) {
        if (r) { sp.style.display = 'block'; sp.style.left = (r.x - 4) / Z + 'px'; sp.style.top = (r.y - 4) / Z + 'px'; sp.style.width = (r.w + 8) / Z + 'px'; sp.style.height = (r.h + 8) / Z + 'px'; sp.style.borderRadius = r.round ? '50%' : '10px'; }
        else sp.style.display = 'none';
      }
      if (cd && !dragged && viewWidth() > 700) {
        const W = cd.offsetWidth * Z, H = cd.offsetHeight * Z, vw = window.innerWidth, vh = window.innerHeight;
        const side = (document.querySelector('aside.side') as HTMLElement | null)?.getBoundingClientRect();
        const insp = (document.querySelector('aside.insp') as HTMLElement | null)?.getBoundingClientRect();
        const left = side && side.width > 0 ? side.right + 12 : 12;
        const right = insp && insp.width > 0 ? vw - insp.left + 12 : 12;
        const top = 120;
        const cands = [
          { left, top: vh - H - 16 }, { left: vw - right - W, top: vh - H - 16 }, { left: vw - right - W, top }, { left, top },
          { left: 12, top: vh - H - 16 }, { left: vw - W - 12, top: vh - H - 16 },
        ];
        const pick = cands.find(c => !r || !overlap({ left: c.left, top: c.top, right: c.left + W, bottom: c.top + H }, r)) ?? cands[0];
        cd.style.left = Math.max(8, pick.left) / Z + 'px'; cd.style.top = Math.max(8, pick.top) / Z + 'px';
      } else if (cd && dragged && viewWidth() > 700) {
        cd.style.left = Math.max(0, Math.min(window.innerWidth - 80, dragged.x)) / Z + 'px'; cd.style.top = Math.max(0, Math.min(window.innerHeight - 40, dragged.y)) / Z + 'px';
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [key, t?.folded, t?.hidden]);
  if (!t || t.hidden) return null;
  const startDrag = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('button') || !card.current || viewWidth() <= 700) return;
    const r = card.current.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    const move = (ev: PointerEvent) => { dragged = { x: ev.clientX - dx, y: ev.clientY - dy }; };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  if (t.folded) return <button class="tut-pill" onClick={() => { t.folded = false; save(); }} title="Rouvrir le tutoriel">✦ Tutoriel{ch ? ` · ${ch.title} ${t.step + 1}/${steps.length}` : ''} ▴</button>;
  const coreSteps = CORE.reduce((a, c) => a + countOf(c), 0);
  const coreIdx = CORE.findIndex(c => c.id === t.chapter);
  const coreDone = coreIdx >= 0 ? CORE.slice(0, coreIdx).reduce((a, c) => a + countOf(c), 0) + t.step : CORE.every(c => t.done.includes(c.id)) ? coreSteps : 0;
  const head = <header class="tut-head" onPointerDown={startDrag} onDblClick={() => { dragged = null; }} title="Tirer pour déplacer · double-clic pour replacer">
    <span class="tut-kicker">✦ {ch ? ch.title : 'Tutoriel'}</span>
    {ch && <span class="tut-count">{t.step + 1} / {steps.length}</span>}
    <span class="sp" />
    {t.chapter !== 'menu' && <button class="icon" onClick={() => goStep('menu', 0)} title="Tous les chapitres" aria-label="Chapitres">☰</button>}
    <button class="icon" onClick={() => { t.folded = true; save(); }} title="Réduire" aria-label="Réduire">–</button>
    <button class="icon" onClick={() => setQuitting(true)} title="Fermer le tutoriel" aria-label="Fermer">✕</button>
  </header>;
  const quit = quitting && <div class="tut-quit">
    <p>Fermer le tutoriel ? La partie continue ; le menu ⋯ permet de le reprendre où vous en étiez.</p>
    <div class="btns"><button onClick={() => setQuitting(false)}>Rester</button><button class="primary" onClick={() => { t.hidden = true; setQuitting(false); save(); }}>Fermer</button></div>
  </div>;
  return <>
    <div class="tut-spot" ref={spot} aria-hidden="true" />
    <div class={'tut-card' + (t.chapter === 'menu' ? ' menu' : '')} ref={card} role="dialog" aria-label="Tutoriel">
      {head}
      {coreIdx >= 0 && <div class="tut-prog" title={`Essentiel : ${Math.round(coreDone / coreSteps * 100)} %`}><i style={{ width: coreDone / coreSteps * 100 + '%' }} /></div>}
      {quit || (t.chapter === 'menu' || !st ? <Menu t={t} /> : <>
        <h3>{st.title}</h3>
        <div class="tut-body">{st.body.map(p => p.startsWith('• ') ? <p class="tut-li">{rich(p.slice(2))}</p> : <p>{rich(p)}</p>)}</div>
        {st.todo && <div class={'tut-todo' + (done ? ' done' : '')}><span class="tut-check">{done ? '✓' : ''}</span><span>{rich(st.todo)}</span>{done && <b class="tut-ok">Fait !</b>}</div>}
        <footer class="tut-foot">
          <button onClick={prevStep} disabled={t.step === 0 && CORE.findIndex(c => c.id === t.chapter) <= 0} title="Étape précédente">◀</button>
          <span class="sp" />
          {st.doIt && !done && <button class="tut-doit" onClick={() => { st.doIt!(); }} title="Le tutoriel fait l'action à votre place">Le faire pour moi</button>}
          <button class={'primary' + (done && st.goal ? ' pulse' : '')} disabled={!done} onClick={nextStep}>{t.step + 1 >= steps.length ? (ch!.core && CORE[CORE.length - 1] !== ch ? 'Chapitre suivant ▶' : 'Terminer le chapitre') : 'Suivant ▶'}</button>
        </footer>
      </>)}
    </div>
  </>;
}

let doneAtEnter = false;

function Menu({ t }: { t: TutorialState }) {
  const coreDone = CORE.every(c => t.done.includes(c.id));
  const firstOpen = CORE.find(c => !t.done.includes(c.id));
  const row = (c: Chapter) => <li class={t.done.includes(c.id) ? 'done' : ''}>
    <button class="tut-ch" onClick={() => goStep(c.id, 0)}>
      <span class="tut-chk">{t.done.includes(c.id) ? '✓' : ''}</span>
      <span><b>{c.title}</b><small>{c.blurb}</small></span>
    </button>
  </li>;
  return <div class="tut-menu">
    {coreDone ? <>
      <h3>L'essentiel est acquis</h3>
      <div class="tut-body"><p>Vous savez produire, rechercher, explorer, coloniser et passer les tours : assez pour jouer une partie entière.</p>
        {MORE.length > 0 && <p>Les chapitres ci-dessous approfondissent le reste, dans l'ordre que vous voulez. Vous pouvez aussi continuer cette partie librement : le tutoriel reste dans le menu ⋯.</p>}</div>
    </> : <h3>Chapitres</h3>}
    {t.back && chapterOf(t.back.chapter) && !t.done.includes(t.back.chapter) ? <button class="primary tut-resume" onClick={() => goStep(t.back!.chapter, t.back!.step)}>Reprendre : {chapterOf(t.back.chapter)!.title}</button>
    : !coreDone && firstOpen && <button class="primary tut-resume" onClick={() => goStep(firstOpen.id, 0)}>Reprendre : {firstOpen.title}</button>}
    <h4>L'essentiel</h4>
    <ul class="tut-chs">{CORE.map(row)}</ul>
    {MORE.length > 0 && <><h4>Pour aller plus loin</h4><ul class="tut-chs">{MORE.map(row)}</ul></>}
    <footer class="tut-foot">
      <span class="sp" />
      <button onClick={() => { t.folded = true; save(); }}>Jouer librement</button>
    </footer>
  </div>;
}

export type { Chapter, Step };
export { chapterOf, ALL as allChapters };
export type { GameState, Player };
