// Hover explanations for technologies (Research page, catalogue): what the item does, in plain words.
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { createPortal } from 'preact/compat';
import { uiZoom } from './prefs';
import { fmt, fmtPeople } from './store';
import type { GameState, Player, Field } from '../engine/types';
import { FIELDS } from '../engine/types';
import type { HullData, TechData } from '../data/types';
import { TECHS, HULLS, hasTech, mainField, playerCost, FIELD_NAMES, CATEGORY_NAMES, slotLabel, canLearn } from '../engine/tech';
import { techOdds, TECH_HORIZON } from '../engine/research';
import { miningYield } from '../engine/missions';
import { tl } from '../data/labels';
import { EngineChart } from './enginechart';
import type { SpecialTech } from '../engine/specials';
import { specialReqText, specialLevelText, AUTO_EXPLORE, WORMHOLE_NAV, INFRARED, LENSING, specialsOf } from '../engine/specials';
import { levelsReq } from '../engine/goals';
import { secondaryLines } from './techtext';

type Item = TechData | HullData;
const isHull = (t: Item): t is HullData => 'slots' in t;
const pc = (x: number) => `${Math.round(x * 100)} %`;
const INF = 1e9;

export interface TechInfo { title: string; kind: string; lines: ComponentChildren[]; stats: [string, string][]; compare?: string; when?: string; cost?: string; chart?: ComponentChildren }

/** Best item of a category the player already has, by a metric. */
function bestOwned(me: Player, cat: string, metric: (t: TechData) => number, filter?: (t: TechData) => boolean): TechData | undefined {
  let best: TechData | undefined, v = -Infinity;
  for (const t of TECHS.values()) {
    if (t.cat !== cat || (filter && !filter(t)) || !hasTech(me, t)) continue;
    const m = metric(t);
    if (m > v) { v = m; best = t; }
  }
  return best;
}

const HAB_FR: Record<string, string> = { Grav: 'la gravité', Temp: 'la température', Rad: 'les radiations', All: 'la gravité, la température et les radiations' };
const MINES_FR: Record<string, string> = { Standard: 'standard (endommage les vaisseaux trop rapides)', Heavy: 'lourdes (dégâts importants, même aux petites flottes)', SpeedBump: 'ralentisseuses (freinent sans détruire)' };

function componentInfo(me: Player, t: TechData): Omit<TechInfo, 'title' | 'when' | 'cost'> {
  const st = t.stats ?? {};
  const lines: ComponentChildren[] = [];
  const stats: [string, string][] = [];
  let compare: string | undefined;
  let chart: ComponentChildren | undefined;
  const cmp = (b: TechData | undefined, txt: (b: TechData) => string) => { if (b) compare = `Votre meilleur équipement de ce type : ${tl(b.name)} (${txt(b)}).`; };
  switch (t.cat) {
    case 'Engine': {
      const e = t.engine!;
      lines.push(`Moteur : il fixe la vitesse de vos vaisseaux. Sa vitesse idéale, Warp ${e.ideal}, est la plus rapide avant que la consommation ne s'envole.`);
      if (e.scoop) lines.push(`Statoréacteur : jusqu'à Warp ${e.free}, il ne consomme rien et récupère même du carburant. Un vaisseau peut voyager indéfiniment à cette vitesse.`);
      if (e.radiating) lines.push('Rayonnant : il tue une partie des colons transportés, sauf chez les races qui tolèrent les fortes radiations.');
      if (e.maxSafe < 10) lines.push(`Au-delà de Warp ${e.maxSafe}, chaque année, un vaisseau sur dix risque d'exploser.`);
      if (st.cloakUnits) lines.push(`Il camoufle aussi le vaisseau (${st.cloakUnits} unités).`);
      stats.push(['Vitesse idéale', `Warp ${e.ideal}`]);
      if (e.scoop) stats.push(['Sans carburant jusqu\'à', `Warp ${e.free}`]);
      stats.push(['Vitesse sûre', `jusqu'à Warp ${e.maxSafe}`]);
      const best = bestOwned(me, 'Engine', x => (x.engine?.ideal ?? 0) * 1000 - (x.engine?.fuel[x.engine.ideal] ?? 0));
      cmp(best, b => `Warp ${b.engine!.ideal}`);
      chart = <EngineChart engine={t} compare={best && best.name !== t.name ? best : undefined} />;
      break;
    }
    case 'BeamWeapon': {
      lines.push(`Arme à faisceau : ${st.power} points de dégâts par tir, à ${st.range === 0 ? 'bout portant (même case)' : `${st.range} case${(st.range ?? 0) > 1 ? 's' : ''} de distance`}. Les dégâts baissent d'environ 10 % à portée maximale, et les boucliers encaissent en premier.`);
      if (st.damageShieldsOnly) lines.push('Arme de sape : elle n\'abîme que les boucliers.');
      if (st.gatling || st.hitsAllTargets) lines.push('Elle touche toutes les cibles de la case à chaque tir.');
      lines.push('Les faisceaux balaient aussi les champs de mines ennemis.');
      stats.push(['Dégâts', `${st.power}`], ['Portée', `${st.range}`], ['Initiative', `${st.initiative ?? 0}`]);
      cmp(bestOwned(me, 'BeamWeapon', x => (x.stats?.power ?? 0) * (1 + (x.stats?.range ?? 0))), b => `${b.stats?.power} dégâts, portée ${b.stats?.range}`);
      break;
    }
    case 'Torpedo': {
      lines.push(`Torpille : ${st.power} points de dégâts à ${st.range} cases, avec ${st.accuracy} % de précision de base (les ordinateurs de combat l'améliorent, les brouilleurs la réduisent).`);
      if (st.capitalShipMissile) lines.push('Missile lourd : dégâts doublés contre une cible qui n\'a plus de bouclier.');
      stats.push(['Dégâts', `${st.power}`], ['Portée', `${st.range}`], ['Précision', `${st.accuracy} %`], ['Initiative', `${st.initiative ?? 0}`]);
      cmp(bestOwned(me, 'Torpedo', x => (x.stats?.power ?? 0) * (x.stats?.accuracy ?? 0)), b => `${b.stats?.power} dégâts, ${b.stats?.accuracy} %`);
      break;
    }
    case 'Bomb': {
      // 0.3.9.21: as the bombing does it (no effect of the planet's hostility; the retro bomb undoes terraforming)
      if (st.smart) lines.push(`Bombe intelligente : elle tue ${st.killRate} % de la population par an sans toucher aux installations. Les défenses planétaires l'arrêtent deux fois moins bien qu'une bombe ordinaire ; seules, les bombes intelligentes ne tuent jamais les 100 derniers colons.`);
      else if (st.unterraformRate) lines.push(`Bombe régressive : elle défait le terraformement de la planète, de ${st.unterraformRate} point(s) par an et par bombe, en ramenant son environnement vers ce qu'il était à l'origine. Elle ne tue personne et ne détruit rien.`);
      else lines.push(`Bombe orbitale : chaque année, elle tue ${st.killRate ?? 0} % de la population (au moins ${fmtPeople(st.minKillRate ?? 0)} colons) et détruit ${st.structureDestroyRate ?? 0} installations. Les défenses planétaires en arrêtent une partie.`);
      if (st.killRate) stats.push(['Population tuée', `${st.killRate} %/an`]);
      if (st.structureDestroyRate) stats.push(['Installations', `${st.structureDestroyRate}/an`]);
      break;
    }
    case 'Armor':
      lines.push(`Blindage : ${st.armor} points de structure de plus par module. Un vaisseau est détruit quand sa structure tombe à zéro.`);
      if (st.shield) lines.push(`Il protège aussi comme un bouclier (${st.shield}).`);
      if (st.cloakUnits) lines.push(`Il camoufle en partie le vaisseau (${st.cloakUnits} unités).`);
      stats.push(['Structure', `+${st.armor}`]);
      cmp(bestOwned(me, 'Armor', x => x.stats?.armor ?? 0), b => `+${b.stats?.armor}`);
      break;
    case 'Shield':
      lines.push(`Bouclier : il absorbe ${st.shield} points de dégâts par vaisseau avant le blindage, et se recharge entièrement entre deux batailles.`);
      if (st.armor) lines.push(`Il ajoute aussi ${st.armor} points de structure.`);
      stats.push(['Bouclier', `${st.shield}`]);
      cmp(bestOwned(me, 'Shield', x => x.stats?.shield ?? 0), b => `${b.stats?.shield}`);
      break;
    case 'Scanner': {
      if (!st.scanRange && !st.scanRangePen) lines.push('Scanner de vaisseau sans portée : il ne voit que ce qui se trouve au même endroit que le vaisseau (les flottes au même point, la planète où il est en orbite, qu\'il analyse). Léger et presque gratuit, il suffit pour explorer planète par planète.');
      else lines.push(`Scanner de vaisseau : il repère les flottes jusqu'à ${st.scanRange ?? 0} al.`);
      if (st.scanRangePen) lines.push(`Pénétrant jusqu'à ${st.scanRangePen} al : il analyse les planètes (environnement, minerais) et voit les flottes en orbite sans s'y rendre. Il balaie tout le trajet parcouru dans l'année, pas seulement le point d'arrivée.`);
      else if (st.scanRange) lines.push('Non pénétrant : pour analyser une planète, il faut se mettre en orbite (s\'y arrêter).');
      if (st.canStealFleetCargo || st.canStealPlanetCargo) lines.push(`Il permet de voler la cargaison ${st.canStealFleetCargo && st.canStealPlanetCargo ? 'des flottes et des planètes' : st.canStealFleetCargo ? 'des flottes' : 'des planètes'} ennemies.`);
      stats.push(['Portée', `${st.scanRange ?? 0} al`], ['Pénétrant', st.scanRangePen ? `${st.scanRangePen} al` : 'non']);
      cmp(bestOwned(me, 'Scanner', x => (x.stats?.scanRangePen ?? 0) * 2 + (x.stats?.scanRange ?? 0)), b => `${b.stats?.scanRange ?? 0} al${b.stats?.scanRangePen ? `, pénétrant ${b.stats.scanRangePen}` : ''}`);
      break;
    }
    case 'PlanetaryScanner':
      lines.push(`Scanner planétaire : une fois découvert, il équipe toutes vos colonies qui ont construit un scanner. Portée ${st.scanRange ?? 0} al${st.scanRangePen ? `, pénétrant ${st.scanRangePen} al (analyse des planètes voisines)` : ''}.`);
      stats.push(['Portée', `${st.scanRange ?? 0} al`], ['Pénétrant', st.scanRangePen ? `${st.scanRangePen} al` : 'non']);
      cmp(bestOwned(me, 'PlanetaryScanner', x => x.stats?.scanRange ?? 0), b => `${b.stats?.scanRange} al`);
      break;
    case 'PlanetaryDefense': {
      const c = (st.defenseCoverage ?? 0) / 100;
      lines.push(`Défenses planétaires : remplace le modèle de toutes vos défenses. Chaque défense arrête ${(c * 100).toFixed(2).replace('.', ',')} % des bombes et des dégâts de paquets ; 100 défenses en arrêtent ${pc(1 - Math.pow(1 - c, 100))}.`);
      stats.push(['Couverture de 100 défenses', pc(1 - Math.pow(1 - c, 100))]);
      cmp(bestOwned(me, 'PlanetaryDefense', x => x.stats?.defenseCoverage ?? 0), b => `${pc(1 - Math.pow(1 - (b.stats?.defenseCoverage ?? 0) / 100, 100))} pour 100 défenses`);
      break;
    }
    case 'Terraforming':
      lines.push(`Terraformation : permet de modifier ${HAB_FR[st.habType ?? 'All'] ?? 'l\'environnement'} de vos planètes jusqu'à ${st.ability} point${(st.ability ?? 0) > 1 ? 's' : ''} vers votre idéal. Les modifications s'achètent dans la file de production.`);
      stats.push(['Amplitude', `±${st.ability}`]);
      break;
    case 'MineRobot': {
      const y = miningYield({ ironium: 50, boranium: 50, germanium: 50 }, st.miningRate ?? 0).ironium;
      if (st.terraformRate) lines.push(`Robot terraformeur : il modifie l'environnement d'une planète de ${st.terraformRate} point(s) par an.`);
      else lines.push(`Robot foreur : monté sur une foreuse, il extrait les minerais d'un monde libre sans le coloniser (minage à distance). Environ ${y} kt par an de chaque minerai sur un gisement de concentration 50.`);
      if (st.miningRate) stats.push(['Taux de minage', `${st.miningRate}`]);
      cmp(bestOwned(me, 'MineRobot', x => x.stats?.miningRate ?? 0), b => `taux ${b.stats?.miningRate}`);
      break;
    }
    case 'MineLayer':
      lines.push(`Lance-mines : pose ${st.mineLayingRate} mines par an autour de la flotte, de type ${MINES_FR[st.minefieldType ?? 'Standard'] ?? st.minefieldType}. Les vaisseaux ennemis qui traversent le champ trop vite risquent une explosion.`);
      stats.push(['Mines par an', `${st.mineLayingRate}`]);
      break;
    case 'Orbital':
      if (st.safeHullMass !== undefined) {
        lines.push(`Portail stellaire (station) : envoie une flotte en un an vers un autre de vos portails, sans carburant. Sans risque jusqu'à ${st.safeHullMass >= INF ? 'n\'importe quelle masse' : `${st.safeHullMass} kt par vaisseau`} et ${st.safeRange! >= INF ? 'n\'importe quelle distance' : `${st.safeRange} al`} ; au-delà, des dégâts, voire des pertes. Un seul portail compte par station : en poser deux n'augmente ni la masse ni la portée.`);
        stats.push(['Masse sûre', st.safeHullMass >= INF ? 'illimitée' : `${st.safeHullMass} kt`], ['Portée sûre', st.safeRange! >= INF ? 'illimitée' : `${st.safeRange} al`]);
      } else if (st.packetSpeed) {
        lines.push(`Catapulte à minerais (station) : lance des paquets de minerais à Warp ${st.packetSpeed} vers une autre planète. La planète d'arrivée doit avoir une catapulte assez rapide pour les rattraper, sinon le paquet s'écrase. Deux catapultes identiques sur une station lancent sans risque un cran plus vite (Warp ${st.packetSpeed + 1}), trois deux crans, etc.`);
        stats.push(['Vitesse', `Warp ${st.packetSpeed}`]);
      }
      break;
    case 'Electrical':
    case 'Mechanical':
      if (st.colonizationModule) lines.push('Module de colonisation : le vaisseau peut fonder une colonie sur un monde libre, avec les colons qu\'il transporte.');
      if (st.orbitalConstructionModule) lines.push('Module de construction orbitale : déploie une station spatiale en orbite d\'un monde libre.');
      if (st.cargoBonus) lines.push(`Soute supplémentaire : +${st.cargoBonus} kt de cargaison (minerais ou colons).`);
      if (st.fuelBonus) lines.push(`Réservoir supplémentaire : +${st.fuelBonus} mg de carburant, donc plus d'autonomie.`);
      if (st.fuelGeneration) lines.push(`Produit ${st.fuelGeneration} mg de carburant par an.`);
      // 0.3.9.21: in points of battle speed (4 points make one more square a round), not squares: the text said 4× too much
      if (st.movementBonus) lines.push(`Propulseur de manœuvre : +${String(st.movementBonus).replace('.', ',')} point${st.movementBonus > 1 ? 's' : ''} de vitesse de combat (4 points font une case de plus par round ; 1 point, une case de plus un round sur quatre).`);
      if (st.cloakUnits) lines.push(`Camouflage : ${st.cloakUnits} unités${st.cloakUnarmedOnly ? ', seulement sur un vaisseau sans armes' : ''}. Un vaisseau camouflé n'est repéré qu'à une fraction de la portée des scanners ennemis.`);
      if (st.torpedoBonus || st.initiativeBonus) lines.push(`Ordinateur de combat : ${st.initiativeBonus ? `+${st.initiativeBonus} d'initiative (tire plus tôt)` : ''}${st.initiativeBonus && st.torpedoBonus ? ', ' : ''}${st.torpedoBonus ? `+${pc(st.torpedoBonus)} de précision des torpilles` : ''}.`);
      if (st.torpedoJamming) lines.push(`Brouilleur : ${pc(st.torpedoJamming)} de chances de dévier chaque torpille ennemie.`);
      if (st.beamBonus) lines.push(`Condensateur : +${pc(st.beamBonus)} de dégâts pour les armes à faisceau du vaisseau.`);
      if (st.beamDefense) lines.push(`Déflecteur : −${pc(st.beamDefense)} de dégâts reçus des armes à faisceau.`);
      if (st.reduceMovement) lines.push(`Amortisseur : ralentit de ${st.reduceMovement} tous les vaisseaux en combat, amis compris.`);
      if (st.reduceCloaking) lines.push('Détecteur à tachyons : réduit le camouflage des vaisseaux ennemis face à vos scanners.');
      if (st.canJump) lines.push('Portail de saut embarqué : le vaisseau peut sauter comme par un portail stellaire.');
      if (st.armor) lines.push(`Ajoute ${st.armor} points de structure.`);
      if (st.decoyMass) lines.push(`Leurre holographique : chaque leurre fait apparaître, aux yeux de l'ennemi, ${st.decoyMass} kt de masse et un vaisseau de plus dans la flotte. Un scanner ordinaire ne donne qu'une estimation (±30 %) et compte les fantômes ; les ordinateurs s'y laissent prendre et surestiment la flotte. Un scanner pénétrant, ou une flotte identifiée, voit la vraie composition. Les leurres ne se battent pas.`);
      if (st.beaconKit) lines.push('Kit de balise de souveraineté (règle « Culture et territoires ») : en orbite d\'un monde libre, la tâche « Poser une balise de souveraineté » (ou le bouton « Revendiquer » de la planète) transforme le vaisseau en fort orbital armé et immobile. Il revendique le monde et 25 al autour : aucun autre empire ne peut y coloniser tant qu\'il tient. Une seule balise par monde, et au total autant de balises que de colonies (au moins deux) ; impossible dans le territoire d\'un autre ou sur un monde gardé. Quand vous colonisez le monde, le fort devient sa station.');
      if (!lines.length) lines.push(partFallback(t));
      break;
    case 'Planetary':
      if (st.resetPlanet) lines.push('Créateur de mondes : transforme entièrement une planète (environnement et minerais tirés au hasard). Technologie extraterrestre, auprès du Marchand nomade.');
      else lines.push(partFallback(t));
      break;
    default:
      lines.push(partFallback(t));
  }
  // what multi-purpose parts also do (alien parts, shields that scan, engines that cloak…)
  lines.push(...secondaryLines(t));
  if (st.decoyMass) stats.push(['Masse fantôme', `+${st.decoyMass} kt`]);
  return { kind: CATEGORY_NAMES[t.cat] ?? t.cat, lines, stats, compare, chart };
}

function partFallback(t: TechData): string { return `${CATEGORY_NAMES[t.cat] ?? t.cat}.`; }

function hullInfo(h: HullData): Omit<TechInfo, 'title' | 'when' | 'cost'> {
  const lines: ComponentChildren[] = [];
  const stats: [string, string][] = [];
  const groups = new Map<string, number>();
  for (const s of h.slots) { const k = slotLabel(s.types); groups.set(k, (groups.get(k) ?? 0) + s.cap); }
  if (h.starbase) lines.push(`Coque de station : construite en orbite d'une de vos planètes. ${h.dock ? `Son chantier construit des vaisseaux jusqu'à ${h.dock >= INF || h.dock < 0 ? 'n\'importe quelle taille' : `${h.dock} kt`}.` : 'Elle n\'a pas de chantier.'}`);
  else lines.push(`Coque de vaisseau : ${h.slots.length} emplacements à équiper dans le concepteur.`);
  lines.push(`Emplacements : ${[...groups.entries()].map(([k, n]) => `${k} ×${n}`).join(', ')}.`);
  if (h.fuelGen) lines.push(`Produit ${h.fuelGen} mg de carburant par an.`);
  if (h.rangeBonus) lines.push(`Portée des armes +${h.rangeBonus}.`);
  if (h.repairBonus) lines.push(h.starbase ? `Atelier : les vaisseaux en orbite réparent ${Math.round(h.repairBonus * 100)} % de leur structure de plus par an.` : `Atelier embarqué : la flotte répare ${Math.round(h.repairBonus * 100)} % de sa structure de plus par an.`);
  if (h.mineLayingBonus) lines.push(`Ses lance-mines posent ${1 + h.mineLayingBonus} fois plus de mines.`);
  if (h.starbase && h.maxPop) lines.push(`Habitat : jusqu'à ${fmtPeople(h.maxPop)} habitants pour une race à vie orbitale, qui ne vit que dans ses stations.`);
  if (h.builtInScanner) lines.push('Scanner intégré.');
  if (h.orbitalConstruction) lines.push('Peut déployer une station.');
  stats.push(['Structure', `${h.armor}`]);
  if (!h.starbase) stats.push(['Carburant', `${h.fuel} mg`], ['Soute', `${h.cargo} kt`], ['Masse', `${h.mass} kt`]);
  stats.push(['Initiative', `${h.init}`]);
  return { kind: h.starbase ? 'Coque de station' : 'Coque de vaisseau', lines, stats };
}

export function techInfo(g: GameState, me: Player, t: Item, horizon = 5): TechInfo {
  const base = isHull(t) ? hullInfo(t) : componentInfo(me, t);
  const f = mainField(t.req);
  let when: string | undefined;
  if (hasTech(me, t)) when = 'Déjà disponible.';
  else if (t.req.acquirable) when = 'Technologie extraterrestre : seulement auprès du Marchand nomade.';
  else if (!canLearn(me.race, t.req)) when = 'Interdite à votre race.';
  else if (f) {
    const o = techOdds(g, me, t, me.tech[f] + horizon);
    if (o) when = `Débloquée en ${FIELD_NAMES[f]} ${o.min === o.max ? o.min : `${o.min} à ${o.max}`}${g.settings.fuzzyTechTree && o.min !== o.max ? ` (le plus probable : ${o.median})` : ''}${o.others.length ? `, avec ${o.others.map(x => `${FIELD_NAMES[x.field]} ${x.level}`).join(', ')}` : ''}.`;
  }
  const c = playerCost(me, t);
  const cost = `${c.ironium} Fe · ${c.boranium} Bo · ${c.germanium} Ge · ${c.resources} ressources${!isHull(t) && t.mass ? ` · ${t.mass} kt` : ''}`;
  return { title: tl(t.name), ...base, when, cost };
}

export function specialInfo(g: GameState, me: Player, sp: SpecialTech): TechInfo {
  if (sp.fuzzy && g.settings.fuzzyTechTree) {
    const o = techOdds(g, me, { name: sp.name, req: levelsReq(sp.req) }, me.tech[sp.field] + TECH_HORIZON);
    const when = o ? `Débloquée en ${FIELD_NAMES[sp.field]} ${o.min === o.max ? o.min : `${o.min} à ${o.max} (le plus probable : ${o.median})`} : comme pour un composant, le niveau exact varie selon la partie.` : `Débloquée vers ${specialLevelText(g, sp)}.`;
    return { title: sp.name, kind: 'Protocole', lines: [sp.explain], stats: [], when };
  }
  return { title: sp.name, kind: 'Protocole', lines: [sp.explain], stats: [], when: `Débloquée en ${specialReqText(sp)} (niveau fixe, sans hasard).` };
}

/** Which categories each research field unlocks (computed from the tables). */
export function fieldInfo(g: GameState, me: Player, f: Field): TechInfo {
  const cats = new Map<string, number>();
  for (const t of [...TECHS.values(), ...HULLS.values()]) {
    if (mainField(t.req) !== f || t.req.acquirable || !canLearn(me.race, t.req)) continue;
    const c = isHull(t) ? (t.starbase ? 'StarbaseHull' : 'ShipHull') : t.cat;
    cats.set(c, (cats.get(c) ?? 0) + 1);
  }
  const top = [...cats.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${(CATEGORY_NAMES[c] ?? c).toLowerCase()} (${n})`);
  const hidden = specialsOf(g).includes(INFRARED) ? ` Et, pour trouver les étoiles cachées, le relevé infrarouge profond (${specialReqText(INFRARED)}) et l'interférométrie gravitationnelle (${specialReqText(LENSING)}).` : '';
  const extra = f === 'electronics' ? ` Débloque aussi l'exploration automatique (${specialLevelText(g, AUTO_EXPLORE)}) ; avec la propulsion, la traversée des trous de ver (${specialReqText(WORMHOLE_NAV)}).${hidden}` : f === 'propulsion' ? ` Avec l'électronique, la traversée des trous de ver (${specialReqText(WORMHOLE_NAV)}).` : '';
  return { title: FIELD_NAMES[f], kind: 'Domaine de recherche', lines: [`Chaque niveau rend aussi moins chers les équipements déjà connus de ce domaine (miniaturisation).${extra}`, `Débloque surtout : ${top.join(', ')}.`], stats: [] };
}

function TipCard({ info }: { info: TechInfo }) {
  return <>
    <div class="htip-kind">{info.kind}</div>
    <div class="htip-title">{info.title}</div>
    {info.lines.map(l => <p>{l}</p>)}
    {info.chart}
    {info.stats.length > 0 && <dl>{info.stats.map(([k, v]) => <><dt>{k}</dt><dd>{v}</dd></>)}</dl>}
    {info.compare && <p class="htip-cmp">{info.compare}</p>}
    {info.when && <p class="htip-when">{info.when}</p>}
    {info.cost && <p class="htip-cost">Coût : {info.cost}</p>}
  </>;
}

/** Wraps an element: after a short hover (or a tap), shows the explanation card next to it. */
export function TechTip({ info, children }: { info: () => TechInfo; children: ComponentChildren }) {
  const ref = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; anchorTop: number; anchorBottom: number } | null>(null);
  const show = () => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.min(360 * uiZoom(), window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    setPos({ left, top: r.bottom + 6, width, anchorTop: r.top, anchorBottom: r.bottom });
  };
  // once rendered, place the card where it fits: below, above, or pinned inside the window
  useLayoutEffect(() => {
    const t = tip.current; if (!t || !pos) return;
    const h = t.offsetHeight * uiZoom(), vh = window.innerHeight;
    let top = pos.anchorBottom + 6;
    if (top + h > vh - 8) top = pos.anchorTop - h - 6;
    if (top < 8) top = Math.max(8, vh - h - 8);
    t.style.top = top / uiZoom() + 'px';
  });
  const hide = () => { clearTimeout(timer.current); setPos(null); };
  // leaving the name toward the card crosses a small gap: wait a moment before closing
  const leave = () => { clearTimeout(timer.current); timer.current = window.setTimeout(() => setPos(null), 220); };
  return <span ref={ref} class="htip-anchor" onMouseEnter={() => { clearTimeout(timer.current); if (!pos) timer.current = window.setTimeout(show, 280); }} onMouseLeave={leave}
    onClick={e => { if (pos) hide(); else { e.stopPropagation(); show(); } }}>
    {children}
    {/* the card lives outside the row: a dimmed row (technology not yet found) must not dim it */}
    {pos && createPortal(<div ref={tip} class="htip" style={{ zoom: uiZoom(), left: pos.left / uiZoom() + 'px', top: pos.top / uiZoom() + 'px', width: pos.width / uiZoom() + 'px' }} onMouseEnter={() => clearTimeout(timer.current)} onMouseLeave={leave} onClick={e => { e.stopPropagation(); hide(); }}><TipCard info={info()} /></div>, document.body)}
  </span>;
}

export { FIELDS };
