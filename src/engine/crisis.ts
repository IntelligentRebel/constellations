// The endgame crisis (Constellations 3.4): the Harvesters. Around 2480-2510 (later in bigger galaxies; 2465-2472 until
// 3.5) every observatory picks up a signal near a remote world; ten years later a Breach opens there, guarded by the Nexus, an immobile fleet stronger than any
// navy of the galaxy. Every few years a wave of warships and bombers comes out of it and harvests the nearest worlds
// of the strongest empires. At the Breach the empires never fight each other. Destroying the Nexus closes the Breach,
// scatters the waves, and wins the game for the empire that holds the field.
import { people } from './words';
import type { Fleet, GameState, Planet, Player, ShipDesign } from './types';
import type { TechData } from '../data/types';
import { MINERALS, FIELDS } from './types';
import { Rng, seedFromString } from './rng';
import { distance, fleetSpec } from './fleet';
import { planetSpec } from './planet';
import { researchCost } from './research';
import { researchStory } from './tales';
import { giveRelic, missingRelic, RELICS } from './relics';
import { ensureFaction, factionDesign, topTech, spawnFleet, sendTo, empires, fleetStrength, raidOrder, mendFaction } from './factions';
import { availableParts, type Purpose } from './design';
import { TECHS, HULLS, partFitsSlot } from './tech';
import { addChronicle } from './chronicle';
import { resetPlanetPolicies } from './empire';

export const crisisOn = (game: GameState) => !!game.settings.crisis;
export const crisisActive = (game: GameState) => crisisOn(game) && game.crisis?.phase === 'active';
const rngOf = (game: GameState, tag: string) => new Rng(seedFromString(`${game.settings.seed}|crisis|${tag}|${game.year}`));
export const isHarvester = (game: GameState, owner: number) => game.players[owner]?.faction === 'crisis';
export const nexusFleet = (game: GameState): Fleet | undefined => game.crisis?.nexusFleetId !== undefined ? game.fleets.find(f => f.id === game.crisis!.nexusFleetId && f.tokens.length > 0) : undefined;
export const breachPlanet = (game: GameState): Planet | undefined => game.crisis?.planetId !== undefined ? game.planets[game.crisis.planetId] : undefined;
export const waves = (game: GameState) => game.fleets.filter(f => f.raid?.kind === 'crisis' && f.tokens.length > 0);
/** Years between the omens and the opening of the Breach. */
export const OMEN_YEARS = 10;
/** 3.6: first year of the omens, by galaxy size (+0 to 7 years): the crisis is an end-of-game event. */
export const OMEN_START: Record<string, number> = { Tiny: 2480, Small: 2480, Medium: 2488, Large: 2496, Huge: 2504 };
/** A runaway leader calls the Harvesters early, but not before this year. */
export const RUNAWAY_YEAR = 2460;
/** Around the Breach (al), the empires never fight each other: fleets gather there before striking together. */
export const TRUCE_RADIUS = 80;
/** Technology of the Nexus and of the waves, above the most advanced empire's. */
export const NEXUS_TECH = 1, WAVE_TECH = 0;
/**
 * Size of the Nexus, as a share of the strongest navy (strength as hit points × firepower). Its technology, its
 * initiative and the concentration of its fire make it worth about three times that in battle (simulated games).
 */
export const NEXUS_SIZE = 0.4;
/** What the computers gather before striking, in multiples of the Nexus' strength. */
export const STRIKE = 3;
/** Waves out at the same time, at most (beyond, the Nexus grows instead). */
export const MAX_WAVES = 8;

/** Prepares the crisis (omens from OMEN_START by galaxy size, or ten years after the rule is switched on). */
export function initCrisis(game: GameState) {
  if (game.crisis) return;
  const rng = new Rng(seedFromString(game.settings.seed + '|crisis'));
  const omenYear = Math.max(game.year + 10, scheduled(game, rng));
  game.crisis = { id: -1, phase: 'dormant', omenYear, openYear: omenYear + OMEN_YEARS, wave: 0, nextWave: 0, sched: 1 };
}
function scheduled(game: GameState, rng = new Rng(seedFromString(game.settings.seed + '|crisis'))): number {
  return (OMEN_START[game.settings.size] ?? 2488) + rng.int(8);
}

/** Rule switched off: the Breach closes for good. */
export function removeCrisis(game: GameState) {
  game.fleets = game.fleets.filter(f => !isHarvester(game, f.owner));
  for (const p of game.players) {
    for (const pi of p.intel.planets) if (pi.lair === 'crisis') pi.lair = undefined;
    p.intel.fleets = p.intel.fleets.filter(fi => !isHarvester(game, fi.owner));
  }
  game.crisis = undefined;
}

/** Lanchester strength of an empire's armed fleets: (all hit points) × (all firepower). */
export function navyStrength(game: GameState, empire: number): number {
  let hp = 0, pow = 0;
  for (const f of game.fleets) {
    if (f.owner !== empire || !f.tokens.length) continue;
    const sp = fleetSpec(game, f);
    if (!sp.hasWeapons) continue;
    hp += sp.armor + sp.shields; pow += sp.powerRating;
  }
  return hp * pow;
}

/** Strength of one warship and two bulwarks together. */
function nexusUnit(game: GameState, owner: Player, war: number, bulwark: number): number {
  const probe: Fleet = { id: -1, owner: owner.id, num: 0, name: '', x: 0, y: 0, orbiting: -1, tokens: [{ designId: war, qty: 1, damage: 0, qtyDamaged: 0 }, { designId: bulwark, qty: 2, damage: 0, qtyDamaged: 0 }], cargo: { ironium: 0, boranium: 0, germanium: 0, colonists: 0 }, fuel: 0, waypoints: [], repeat: false, battlePlan: 0, heading: null, lastWarp: 0, age: 0 };
  return Math.max(1, fleetStrength(game, probe));
}

/** Ships of a design needed to reach a strength (strength grows with the square of the number of ships). */
function shipsFor(game: GameState, owner: Player, designId: number, strength: number, min: number, max: number): number {
  const probe: Fleet = { id: -1, owner: owner.id, num: 0, name: '', x: 0, y: 0, orbiting: -1, tokens: [{ designId, qty: 1, damage: 0, qtyDamaged: 0 }], cargo: { ironium: 0, boranium: 0, germanium: 0, colonists: 0 }, fuel: 0, waypoints: [], repeat: false, battlePlan: 0, heading: null, lastWarp: 0, age: 0 };
  const one = Math.max(1, fleetStrength(game, probe));
  return Math.max(min, Math.min(max, Math.ceil(Math.sqrt(strength / one))));
}

function design(game: GameState, owner: Player, tech: number, hulls: string[], purpose: Purpose, names: Record<string, string>) {
  for (const h of hulls) { const d = factionDesign(game, owner, tech, h, purpose, names[h] ?? 'Moissonneur'); if (d) return d; }
  return null;
}
const warDesign = (game: GameState, owner: Player, tech: number) => design(game, owner, tech, ['Dreadnought', 'Battleship', 'Cruiser', 'Destroyer'], 'beamWarship', { Dreadnought: 'Faucheur', Battleship: 'Glaneur', Cruiser: 'Glaneur', Destroyer: 'Éclat' });
/**
 * The bulk of the Nexus: the warship's hull with armour (or shields) wherever a weapon or a beam capacitor could go.
 * A Nexus of pure warships would wipe out a fleet a round before it fires: this one holds, and must be worn down.
 */
function bulwarkDesign(game: GameState, owner: Player, tech: number): ShipDesign | null {
  const base = warDesign(game, owner, tech);
  if (!base) return null;
  const t = Math.max(1, Math.min(26, Math.round(tech)));
  const key = `crisis:bulwark:${base.hull}:${t}`;
  const found = game.designs.find(d => d.owner === owner.id && d.purpose === key);
  if (found) return found;
  const h = HULLS.get(base.hull);
  if (!h) return null;
  const fake: Player = { ...owner, tech: { energy: t, weapons: t, propulsion: t, construction: t, electronics: t, biotechnology: t }, techShift: undefined, acquiredTechs: [] };
  const parts = availableParts(fake);
  const bestOf = (types: string[], cat: string, score: (x: TechData) => number) => {
    let b: TechData | null = null;
    for (const x of parts) if (x.cat === cat && partFitsSlot(x, types, h.name) && (!b || score(x) > score(b))) b = x;
    return b;
  };
  // weapons and beam capacitors give way to armour or shields; where they cannot, a single weapon stays
  let first = true;
  const slots = base.slots.flatMap(s => {
    const part = TECHS.get(s.part);
    const types = h.slots[s.slot - 1]?.types ?? [];
    const weapon = !!part && (part.cat === 'BeamWeapon' || part.cat === 'Torpedo');
    if (!part || !(weapon || part.tags.includes('BeamCapacitor'))) return [{ ...s }];
    if (weapon && first) { first = false; return [{ ...s }]; }
    const repl = bestOf(types, 'Armor', x => (x.stats?.armor ?? 0) - (x.mass ?? 0) * 0.5) ?? bestOf(types, 'Shield', x => x.stats?.shield ?? 0);
    if (repl) return [{ slot: s.slot, part: repl.name, qty: h.slots[s.slot - 1].cap }];
    return weapon ? [{ ...s, qty: 1 }] : [];
  });
  const d: ShipDesign = { ...JSON.parse(JSON.stringify(base)), id: game.nextId++, name: 'Rempart', slots, purpose: key, alien: true, built: 0 };
  game.designs.push(d);
  return d;
}
const bombDesign = (game: GameState, owner: Player, tech: number) => design(game, owner, tech, ['B-52 Bomber', 'B-17 Bomber', 'Mini Bomber'], 'bomber', { 'B-52 Bomber': 'Moisson', 'B-17 Bomber': 'Moisson', 'Mini Bomber': 'Semeur' });

/** The remotest free world (the Breach opens there). */
function pickBreach(game: GameState, rng: Rng): Planet | undefined {
  const owned = game.planets.filter(pl => pl.owner >= 0 && !game.players[pl.owner].monster);
  const lairs = new Set((game.pirates?.lairs ?? []).filter(l => l.alive).map(l => l.planetId));
  const cands = game.planets.filter(pl => pl.owner < 0 && !pl.hidden && !lairs.has(pl.id) && !game.fleets.some(f => f.orbiting === pl.id && game.players[f.owner]?.monster))
    .map(pl => ({ pl, d: (owned.length ? Math.min(...owned.map(o => distance(o, pl))) : 0) * (0.9 + 0.2 * rng.random()) }))
    .sort((a, b) => b.d - a.d);
  return cands[0]?.pl;
}

function omens(game: GameState) {
  const C = game.crisis!;
  const rng = rngOf(game, 'omen');
  const pl = pickBreach(game, rng);
  if (!pl) { C.phase = 'ended'; C.endedYear = game.year; return; }
  C.phase = 'omen'; C.planetId = pl.id; C.omenYear = game.year; C.openYear = game.year + OMEN_YEARS;
  addChronicle(game, 'crisis', `Un signal venu d'ailleurs annonce l'ouverture d'une Brèche près de ${pl.name}.`, [], pl);
  for (const p of empires(game)) {
    const pi = p.intel.planets[pl.id];
    if (pi) pi.lair = 'crisis';
    p.messages.push({ year: game.year, kind: 'event', text: `Les observatoires de toute la galaxie captent un signal qui ne vient d'aucune étoile, près de ${pl.name}. Il se répète, de plus en plus fort. Vos savants y voient une Brèche qui s'ouvrirait vers ${C.openYear} : ce qui en sortira n'aura rien d'amical.`, target: { kind: 'planet', id: pl.id } });
  }
}

function openBreach(game: GameState) {
  const C = game.crisis!;
  const pl = game.planets[C.planetId!];
  const owner = ensureFaction(game, 'crisis');
  C.id = owner.id;
  // a free world, or the colony that settled there meanwhile is swallowed
  if (pl.owner >= 0) {
    const victim = game.players[pl.owner];
    victim.messages.push({ year: game.year, kind: 'population', text: `La Brèche s'ouvre sur ${pl.name} : la colonie est anéantie.`, target: { kind: 'planet', id: pl.id } });
    pl.owner = -1; pl.pop = 0; pl.queue = []; pl.starbase = null; pl.defenses = 0;
    // 0.3.9.21: everything a colony leaves on its world goes with it (its scanner, where its ships went...)
    pl.scanner = false; pl.route = undefined; pl.packetTarget = undefined; pl.conqueredYear = undefined; resetPlanetPolicies(pl);
    victim.stats.planetsLost = (victim.stats.planetsLost ?? 0) + 1;
  }
  const tech = Math.min(26, Math.round(topTech(game) + NEXUS_TECH));
  const d = warDesign(game, owner, tech), b = bulwarkDesign(game, owner, tech);
  if (!d || !b) { C.phase = 'ended'; C.endedYear = game.year; return; }
  // one warship for two bulwarks, as many as it takes to match the strongest navy of the galaxy
  const strongest = Math.max(1, ...empires(game).map(p => navyStrength(game, p.id)));
  const unit = nexusUnit(game, owner, d.id, b.id);
  const k = Math.max(2, Math.min(15, Math.ceil(Math.sqrt(strongest * NEXUS_SIZE / unit))));
  const f = spawnFleet(game, owner, [{ designId: d.id, qty: k }, { designId: b.id, qty: 2 * k }], pl, 'Le Nexus', { immobile: true, purpose: 'nexus' });
  const n = 3 * k;
  C.nexusFleetId = f.id; C.phase = 'active'; C.wave = 0; C.nextWave = game.year + 2;
  addChronicle(game, 'crisis', `La Brèche s'ouvre sur ${pl.name} : le Nexus et les Moissonneurs envahissent la galaxie.`, [], pl);
  for (const p of empires(game)) {
    const pi = p.intel.planets[pl.id];
    if (pi) pi.lair = 'crisis';
    p.messages.push({ year: game.year, kind: 'warning', text: `La Brèche s'est ouverte à ${pl.name}. Une structure colossale, le Nexus (${n} vaisseaux), en garde l'entrée : les Moissonneurs arrivent. Leurs vagues frapperont les mondes les plus proches et les empires les plus puissants. Détruire le Nexus referme la Brèche, et l'empire qui l'abat remporte la partie. À la Brèche, les empires ne se combattent pas entre eux.`, target: { kind: 'planet', id: pl.id } });
  }
}

/** The empire a wave goes for: the leader most of the time, else the one nearest the Breach. */
function waveTarget(game: GameState, from: Planet, rng: Rng): Planet | undefined {
  const es = empires(game).filter(p => game.planets.some(pl => pl.owner === p.id));
  if (!es.length) return undefined;
  const score = (p: Player) => p.scores[p.scores.length - 1]?.score ?? 0;
  const leader = [...es].sort((a, b) => score(b) - score(a))[0];
  const nearestOf = (id: number) => game.planets.filter(pl => pl.owner === id).sort((a, b) => distance(a, from) - distance(b, from))[0];
  // 0.3.9: the heirs of the threshold are remembered behind the Breach
  const heirs = es.find(p => p.origin === 'heirs');
  if (heirs && rng.chance(0.5)) return nearestOf(heirs.id);
  if (rng.chance(0.6)) return nearestOf(leader.id);
  let best: Planet | undefined;
  for (const p of es) { const pl = nearestOf(p.id); if (pl && (!best || distance(pl, from) < distance(best, from))) best = pl; }
  return best;
}

function launchWave(game: GameState) {
  const C = game.crisis!;
  const owner = game.players[C.id];
  const rng = rngOf(game, 'wave');
  const from = game.planets[C.planetId!];
  const target = waveTarget(game, from, rng);
  C.nextWave = game.year + 4 + rng.int(2);
  if (!target) return;
  // too many waves out already: the Breach widens instead, the Nexus grows
  if (waves(game).length >= MAX_WAVES) {
    const nx = nexusFleet(game);
    const nd = bulwarkDesign(game, owner, Math.min(26, Math.round(topTech(game) + NEXUS_TECH)));
    if (nx && nd) {
      const t = nx.tokens.find(x => x.designId === nd.id);
      if (t) t.qty += 1; else nx.tokens.push({ designId: nd.id, qty: 1, damage: 0, qtyDamaged: 0 });
      for (const p of empires(game)) p.messages.push({ year: game.year, kind: 'event', text: `La Brèche de ${from.name} s'élargit : le Nexus se renforce d'un vaisseau.`, target: { kind: 'planet', id: from.id } });
    }
    return;
  }
  C.wave++;
  const tech = Math.min(26, Math.round(topTech(game) + WAVE_TECH));
  const wd = warDesign(game, owner, tech), bd = bombDesign(game, owner, tech);
  if (!wd) return;
  const ref = Math.max(navyStrength(game, target.owner), Math.max(1, ...empires(game).map(p => navyStrength(game, p.id))) * 0.25);
  const n = shipsFor(game, owner, wd.id, ref * 0.35 * Math.pow(1.3, C.wave - 1), 3, 25);
  const b = bd ? Math.min(6, 1 + Math.floor(C.wave / 2)) : 0;
  const f = spawnFleet(game, owner, [{ designId: wd.id, qty: n }, ...(bd ? [{ designId: bd.id, qty: b }] : [])], from, `Vague ${C.wave}`, { purpose: 'wave', raid: raidOrder(game, 'crisis', target.owner, target.id) });
  sendTo(game, f, target);
  const w = Math.max(4, Math.min(10, fleetSpec(game, f).idealSpeed || 6));
  const eta = game.year + Math.max(1, Math.ceil(distance(from, target) / (w * w)));
  f.raid!.eta = eta;
  const victim = game.players[target.owner];
  for (const p of empires(game)) p.messages.push({
    year: game.year, kind: p.id === victim.id ? 'warning' : 'event',
    text: p.id === victim.id ? `Une vague de Moissonneurs (${n} vaisseaux${b ? `, dont ${b} bombardier${b > 1 ? 's' : ''}` : ''}) sort de la Brèche et fond sur ${target.name} (arrivée vers ${eta}).`
      : `Une vague de Moissonneurs (${n} vaisseaux${b ? `, dont ${b} bombardier${b > 1 ? 's' : ''}` : ''}) sort de la Brèche, en direction des ${victim.name}.`,
    target: { kind: 'planet', id: p.id === victim.id ? target.id : from.id },
  });
}

/** A wave in orbit of an undefended world harvests it: colonists taken, installations torn down, until it is empty. */
function harvest(game: GameState, f: Fleet, pl: Planet) {
  const victim = game.players[pl.owner];
  const cov = planetSpec(game, pl, victim).defenseCoverage ?? 0;
  const ships = f.tokens.reduce((a, t) => a + t.qty, 0);
  const k = Math.min(0.5, 0.04 * Math.sqrt(ships)) * (1 - cov * 0.5);
  const killed = Math.min(pl.pop, Math.max(1000, Math.round(pl.pop * k / 100) * 100));
  const frac = k / 2;
  const mines = Math.ceil(pl.mines * frac), facts = Math.ceil(pl.factories * frac);
  pl.pop -= killed; pl.mines -= mines; pl.factories -= facts;
  if (pl.pop <= 0) {
    victim.messages.push({ year: game.year, kind: 'combat', text: `${pl.name} a été moissonnée par la ${f.name} : il n'y reste personne.`, target: { kind: 'planet', id: pl.id } });
    victim.stats.planetsLost = (victim.stats.planetsLost ?? 0) + 1;
    pl.owner = -1; pl.pop = 0; pl.queue = []; pl.defenses = 0; pl.scanner = false; pl.starbase = null; pl.route = undefined; pl.packetTarget = undefined;
    pl.conqueredYear = undefined; resetPlanetPolicies(pl); // (0.3.9.21: a harvested regional capital stayed one, with no owner)
    return;
  }
  victim.messages.push({ year: game.year, kind: 'combat', text: `La ${f.name} moissonne ${pl.name} : ${people(game, killed)} colons enlevés${facts + mines ? `, ${facts} usine${facts > 1 ? 's' : ''} et ${mines} mine${mines > 1 ? 's' : ''} détruite${facts + mines > 1 ? 's' : ''}` : ''}.`, target: { kind: 'planet', id: pl.id } });
}

/** Waves go from world to world: when one is harvested (or lost, or holds out too long), the nearest world of the same empire, else of any. */
function steerWaves(game: GameState) {
  for (const f of waves(game)) {
    const r = f.raid!;
    const t = game.planets[r.target];
    const there = f.x === t.x && f.y === t.y;
    if (t.owner === r.empire && t.pop > 0) {
      if (!there) { if (f.waypoints.length < 2) sendTo(game, f, t); r.since = game.year; continue; }
      const defended = !!t.starbase || game.fleets.some(o => o.x === t.x && o.y === t.y && o.tokens.length > 0 && !game.players[o.owner].monster && fleetSpec(game, o).hasWeapons);
      if (!defended) { harvest(game, f, t); if (t.owner === r.empire) continue; }
      else if (game.year - r.since < 6) continue;
    }
    // the next world: of the same empire first, not one this wave could not break
    const same = game.planets.filter(pl => pl.owner === r.empire && pl.pop > 0 && pl.id !== t.id);
    const pool = same.length ? same : game.planets.filter(pl => pl.owner >= 0 && !game.players[pl.owner].monster && pl.pop > 0 && pl.id !== t.id);
    const next = pool.sort((a, b) => distance(a, f) - distance(b, f))[0];
    if (!next) continue;
    r.empire = next.owner; r.target = next.id; r.since = game.year;
    sendTo(game, f, next);
    // 0.3.9.21: the new victim is warned as the first was (the pages showed the new target without a word)
    const w = Math.max(4, Math.min(10, fleetSpec(game, f).idealSpeed || 6));
    r.eta = game.year + Math.max(1, Math.ceil(distance(f, next) / (w * w)));
    game.players[next.owner].messages.push({ year: game.year, kind: 'warning', text: `La ${f.name} des Moissonneurs se tourne vers ${next.name} (arrivée vers ${r.eta}).`, target: { kind: 'planet', id: next.id } });
  }
}

/** The Nexus destroyed: the Breach closes, the waves fall apart, the empire holding the field wins. */
function checkNexus(game: GameState) {
  const C = game.crisis!;
  if (nexusFleet(game)) return;
  const rng = rngOf(game, 'nexus');
  const pl = game.planets[C.planetId!];
  const battle = game.battles.find(b => b.planetId === pl.id || (Math.round(b.x) === pl.x && Math.round(b.y) === pl.y));
  const fighters = (battle?.players ?? []).filter(id => !game.players[id].monster && !game.players[id].dead);
  const held = fighters.map(id => ({ id, n: game.fleets.filter(f => f.owner === id && f.x === pl.x && f.y === pl.y).reduce((a, f) => a + f.tokens.reduce((s, t) => s + t.qty, 0), 0) })).sort((a, b) => b.n - a.n || a.id - b.id);
  C.phase = 'ended'; C.endedYear = game.year; C.endedBy = held[0]?.id;
  addChronicle(game, 'crisis', C.endedBy !== undefined ? `Les ${game.players[C.endedBy].name} abattent le Nexus : la Brèche de ${pl.name} se referme.` : `Le Nexus tombe : la Brèche de ${pl.name} se referme.`, C.endedBy !== undefined ? [C.endedBy] : [], pl);
  for (const f of [...game.fleets]) if (isHarvester(game, f.owner)) { f.tokens = []; }
  game.fleets = game.fleets.filter(f => f.tokens.length > 0);
  for (const m of MINERALS) pl.surface[m] += 2000;
  for (const id of fighters) {
    const p = game.players[id];
    const stories: string[] = [];
    for (const field of rng.shuffle([...FIELDS]).slice(0, 2)) stories.push(researchStory(game, p, field, Math.round(researchCost(game, p, field)), 'nexus', rng));
    let text = `Le Nexus est détruit : la Brèche de ${pl.name} se referme et les vagues des Moissonneurs se désagrègent. Vos équipes fouillent les débris : ${stories.join(' ; ')}.`;
    if (id === C.endedBy) { const relic = missingRelic(p, rng.int(100), []); if (relic && giveRelic(p, relic)) text += ` Au cœur du Nexus, une relique : ${RELICS[relic].name} (${RELICS[relic].effect}).`; }
    p.messages.push({ year: game.year, kind: 'event', text, target: { kind: 'planet', id: pl.id } });
  }
  for (const p of empires(game)) {
    const pi = p.intel.planets[pl.id];
    if (pi) pi.lair = undefined;
    if (!fighters.includes(p.id)) p.messages.push({ year: game.year, kind: 'event', text: `Le Nexus a été détruit${C.endedBy !== undefined ? ` par les ${game.players[C.endedBy].name}` : ''} : la Brèche de ${pl.name} se referme et les Moissonneurs disparaissent.`, target: { kind: 'planet', id: pl.id } });
  }
  if (C.endedBy !== undefined && game.victor === null) {
    const w = game.players[C.endedBy];
    game.victor = w.id; game.victoryKind = 'crisis';
    for (const p of game.players) p.messages.unshift({ year: game.year, kind: 'victory', text: p.id === w.id ? `Victoire ! Les ${w.name} ont abattu le Nexus et sauvé la galaxie.` : `Les ${w.name} ont abattu le Nexus : ils remportent la partie. Elle peut continuer.`, target: { kind: 'score', id: 0 } });
  }
}

/** Yearly, after the battles. */
export function runCrisis(game: GameState) {
  if (!crisisOn(game)) return;
  if (!game.crisis) initCrisis(game);
  const C = game.crisis!;
  if (C.phase === 'ended') return;
  if (C.phase === 'dormant' && !C.sched) {
    // a save from before 3.6: the crisis is postponed to the new schedule (the omens have not started yet)
    C.omenYear = Math.max(C.omenYear, scheduled(game)); C.openYear = C.omenYear + OMEN_YEARS; C.sched = 1;
  }
  if (C.phase === 'dormant') {
    // a runaway leader calls the Harvesters early
    if (game.year >= RUNAWAY_YEAR && game.year < C.omenYear) {
      const sc = empires(game).map(p => p.scores[p.scores.length - 1]?.score ?? 0).sort((a, b) => b - a);
      if (sc.length > 1 && sc[0] >= 2.2 * Math.max(1, sc[1])) C.omenYear = game.year;
    }
    if (game.year >= C.omenYear) omens(game);
    return;
  }
  if (C.phase === 'omen') {
    if (game.year === C.openYear - 3) {
      const pl = game.planets[C.planetId!];
      for (const p of empires(game)) p.messages.push({ year: game.year, kind: 'warning', text: `Le signal de ${pl.name} s'intensifie : la Brèche s'ouvrira dans environ trois ans. Rassemblez vos flottes.`, target: { kind: 'planet', id: pl.id } });
    }
    if (game.year >= C.openYear) openBreach(game);
    return;
  }
  checkNexus(game);
  if (C.phase !== 'active') return;
  mendFaction(game, 'crisis', 0.3);
  steerWaves(game);
  if (game.year >= C.nextWave) launchWave(game);
}

/** Strength of the Nexus (as the AI counts it). */
export function nexusStrength(game: GameState): number {
  const f = nexusFleet(game);
  return f ? fleetStrength(game, f) : 0;
}
