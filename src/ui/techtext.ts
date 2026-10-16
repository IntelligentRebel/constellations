// What each component does, in words (Constellations 3.3.4): the short line of the tables ("Caractéristiques") and
// the secondary effects of multi-purpose parts. Pure functions, checked by scripts/tech-text-check.ts: every effect
// of every component must be said somewhere.
import type { TechData, TechStats } from '../data/types';

const pc = (x: number) => `${Math.round(x * 100)} %`;
const INF = 1e9;

/** Effects the tooltip of each category explains in its own paragraph. */
export const PRIMARY: Record<string, (keyof TechStats)[]> = {
  Engine: ['cloakUnits', 'radiating'],
  BeamWeapon: ['power', 'range', 'initiative', 'gatling', 'hitsAllTargets', 'damageShieldsOnly'],
  Torpedo: ['power', 'range', 'accuracy', 'initiative', 'capitalShipMissile'],
  Bomb: ['smart', 'killRate', 'minKillRate', 'structureDestroyRate', 'unterraformRate'],
  Armor: ['armor', 'shield', 'cloakUnits'],
  Shield: ['shield', 'armor'],
  Scanner: ['scanRange', 'scanRangePen', 'canStealFleetCargo', 'canStealPlanetCargo'],
  PlanetaryScanner: ['scanRange', 'scanRangePen'],
  PlanetaryDefense: ['defenseCoverage'],
  Terraforming: ['ability', 'habType'],
  MineRobot: ['miningRate', 'terraformRate'],
  MineLayer: ['mineLayingRate', 'minefieldType'],
  Orbital: ['safeHullMass', 'safeRange', 'packetSpeed'],
  Electrical: ['colonizationModule', 'orbitalConstructionModule', 'cargoBonus', 'fuelBonus', 'fuelGeneration', 'movementBonus', 'cloakUnits', 'cloakUnarmedOnly', 'torpedoBonus', 'initiativeBonus', 'torpedoJamming', 'beamBonus', 'beamDefense', 'reduceMovement', 'reduceCloaking', 'canJump', 'armor', 'decoyMass', 'beaconKit'],
  Planetary: ['resetPlanet'],
};
PRIMARY.Mechanical = PRIMARY.Electrical;

/** Data without any effect in the game (kept from the original tables). */
const INERT: Partial<Record<string, (keyof TechStats)[]>> = {
  Orbital: ['maxHullMass', 'maxRange'],
  Mechanical: ['minKillRate'],
};

const on = (v: unknown) => v !== undefined && v !== null && v !== false && v !== 0 && v !== '';

/** Sentences for the effects a part has besides its main role (alien multi-purpose parts, shields that also scan…). */
export function secondaryLines(t: TechData): string[] {
  const st = t.stats ?? {};
  const done = new Set<string>([...(PRIMARY[t.cat] ?? []), ...(INERT[t.cat] ?? [])]);
  const has = (k: keyof TechStats) => on(st[k]) && !done.has(k);
  const out: string[] = [];
  if (has('scanRange') || has('scanRangePen')) out.push(`Scanner intégré : repère les flottes jusqu'à ${st.scanRange ?? 0} al${st.scanRangePen ? `, et analyse planètes et flottes en orbite jusqu'à ${st.scanRangePen} al (pénétrant)` : ''}.`);
  if (has('killRate') || has('structureDestroyRate')) out.push(`Bombardement : en orbite d'une planète ennemie, il tue ${st.killRate ?? 0} % de la population et détruit ${st.structureDestroyRate ?? 0} installations par an, comme une bombe (les défenses en arrêtent une partie).`);
  if (has('mineLayingRate')) out.push(`Pose ${st.mineLayingRate} mines par an autour de la flotte (champ standard).`);
  if (has('armor')) out.push(`Ajoute ${st.armor} points de structure.`);
  if (has('shield')) out.push(`Bouclier intégré : absorbe ${st.shield} points de dégâts par vaisseau avant le blindage.`);
  if (has('cloakUnits')) out.push(`Camouflage : ${st.cloakUnits} unités. Un vaisseau camouflé n'est repéré qu'à une fraction de la portée des scanners ennemis.`);
  if (has('torpedoJamming')) out.push(`Brouillage : ${pc(st.torpedoJamming!)} de chances de dévier chaque torpille ennemie.`);
  if (has('torpedoBonus')) out.push(`+${pc(st.torpedoBonus!)} de précision pour les torpilles du vaisseau.`);
  if (has('initiativeBonus')) out.push(`+${st.initiativeBonus} d'initiative : le vaisseau tire plus tôt.`);
  if (has('movementBonus')) out.push(`Manœuvre : +${String(st.movementBonus).replace('.', ',')} case${st.movementBonus! > 1 ? 's' : ''} de déplacement par round de combat${st.movementBonus! < 1 ? ' (en moyenne)' : ''}.`);
  if (has('fuelBonus')) out.push(`Réservoir : +${st.fuelBonus} mg de carburant.`);
  if (has('cargoBonus')) out.push(`Soute : +${st.cargoBonus} kt de cargaison.`);
  if (has('miningRate')) out.push(`Foreuse : taux de minage ${st.miningRate} sur un monde libre.`);
  if (has('terraformRate')) out.push(`Terraforme la planète où il se trouve de ${st.terraformRate} point(s) par an.`);
  if (has('beamBonus')) out.push(`+${pc(st.beamBonus!)} de dégâts pour les armes à faisceau du vaisseau.`);
  if (has('beamDefense')) out.push(`−${pc(st.beamDefense!)} de dégâts reçus des armes à faisceau.`);
  if (has('fuelGeneration')) out.push(`Produit ${st.fuelGeneration} mg de carburant par an.`);
  return out;
}

const SECONDARY = new Set<keyof TechStats>(['scanRange', 'scanRangePen', 'killRate', 'structureDestroyRate', 'mineLayingRate', 'armor', 'shield', 'cloakUnits', 'torpedoJamming', 'torpedoBonus', 'initiativeBonus', 'movementBonus', 'fuelBonus', 'cargoBonus', 'miningRate', 'terraformRate', 'beamBonus', 'beamDefense', 'fuelGeneration']);

/** Effects of a part that no sentence explains (for the check script: must be empty). */
export function unexplainedStats(t: TechData): string[] {
  const st = t.stats ?? {};
  const known = new Set<string>([...(PRIMARY[t.cat] ?? []), ...(INERT[t.cat] ?? []), ...SECONDARY]);
  return Object.entries(st).filter(([k, v]) => on(v) && !known.has(k)).map(([k]) => k);
}

const MINE_SHORT: Record<string, string> = { Heavy: 'mines lourdes', SpeedBump: 'mines ralentisseuses' };
const HAB_SHORT: Record<string, string> = { Grav: 'gravité', Temp: 'température', Rad: 'radiations', All: 'tout l\'environnement' };

/** The short line of the tables: what the part does, in a few words. */
export function partBrief(t: TechData, long = false): string {
  const st = t.stats ?? {};
  const bits: string[] = [];
  if (t.engine) bits.push(`Warp ${t.engine.ideal} idéal${t.engine.scoop ? ', récupère du carburant' : ''}${long ? ' · conso ' + t.engine.fuel.slice(1).join('/') : ''}`);
  if (st.power) bits.push(`${st.damageShieldsOnly ? 'sape' : t.cat === 'BeamWeapon' || t.cat === 'Torpedo' ? 'dégâts' : 'puissance'} ${st.power}`);
  if (st.range !== undefined && (t.cat === 'BeamWeapon' || t.cat === 'Torpedo')) bits.push(`portée ${st.range}`);
  if (st.initiative) bits.push(`init. ${st.initiative}`);
  if (st.accuracy) bits.push(`précision ${st.accuracy} %`);
  if (st.gatling || st.hitsAllTargets) bits.push('touche toute la case');
  if (st.damageShieldsOnly) bits.push('boucliers seulement');
  if (st.capitalShipMissile) bits.push('×2 sans bouclier');
  if (st.armor) bits.push(`blindage ${st.armor}`);
  if (st.shield) bits.push(`bouclier ${st.shield}`);
  if (st.scanRange !== undefined || t.cat === 'Scanner') bits.push(st.scanRange || st.scanRangePen ? `scan ${st.scanRange ?? 0}${st.scanRangePen ? '/' + st.scanRangePen : ''} al` : 'scan sur place seulement');
  if (st.canStealFleetCargo || st.canStealPlanetCargo) bits.push(`vole la cargaison ${st.canStealFleetCargo && st.canStealPlanetCargo ? 'des flottes et planètes' : st.canStealFleetCargo ? 'des flottes' : 'des planètes'}`);
  if (st.cloakUnits) bits.push(`camouflage ${st.cloakUnits}${st.cloakUnarmedOnly ? ' (sans armes)' : ''}`);
  if (st.cargoBonus) bits.push(`+${st.cargoBonus} kt de soute`);
  if (st.fuelBonus) bits.push(`+${st.fuelBonus} mg`);
  if (st.smart) bits.push('bombe intelligente');
  if (st.killRate) bits.push(`tue ${st.killRate} %`);
  if (st.structureDestroyRate) bits.push(`${st.structureDestroyRate} installations`);
  if (st.unterraformRate) bits.push(`dégrade l'environnement de ${st.unterraformRate}/an`);
  if (st.miningRate) bits.push(`minage ${st.miningRate}`);
  if (st.mineLayingRate) bits.push(`${st.mineLayingRate} ${MINE_SHORT[st.minefieldType ?? ''] ?? 'mines'}/an`);
  if (st.torpedoBonus) bits.push(`+${Math.round(st.torpedoBonus * 100)} % précision`);
  if (st.torpedoJamming) bits.push(`brouillage ${Math.round(st.torpedoJamming * 100)} %`);
  if (st.beamBonus) bits.push(`+${Math.round(st.beamBonus * 100)} % faisceaux`);
  if (st.beamDefense) bits.push(`déflecteur ${Math.round(st.beamDefense * 100)} %`);
  if (st.initiativeBonus) bits.push(`+${st.initiativeBonus} initiative`);
  if (st.movementBonus) bits.push(`+${String(st.movementBonus).replace('.', ',')} mouvement`);
  if (st.safeHullMass !== undefined) bits.push(`porte ${st.safeHullMass >= INF ? '∞' : st.safeHullMass} kt / ${st.safeRange! >= INF ? '∞' : st.safeRange} al`);
  if (st.packetSpeed) bits.push(`accélérateur Warp ${st.packetSpeed}`);
  if (st.colonizationModule) bits.push('module de colonisation');
  if (st.orbitalConstructionModule) bits.push('déploie une station');
  if (st.terraformRate) bits.push(`terraforme ${st.terraformRate}/an`);
  if (st.ability) bits.push(`${HAB_SHORT[st.habType ?? 'All'] ?? 'environnement'} ±${st.ability}`);
  if (st.defenseCoverage) bits.push(`${(st.defenseCoverage).toFixed(2).replace('.', ',')} % par défense`);
  if (st.reduceCloaking) bits.push('réduit le camouflage ennemi');
  if (st.reduceMovement) bits.push('ralentit tous les vaisseaux');
  if (st.fuelGeneration) bits.push(`génère ${st.fuelGeneration} mg/an`);
  if (st.canJump) bits.push('saut comme un portail');
  if (st.resetPlanet) bits.push('refait entièrement une planète');
  if (st.decoyMass) bits.push(`leurre : +1 vaisseau fantôme de ${st.decoyMass} kt`);
  if (st.beaconKit) bits.push('devient un fort qui revendique un monde libre');
  return bits.join(' · ');
}
