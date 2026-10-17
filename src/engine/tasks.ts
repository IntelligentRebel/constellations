// Waypoint tasks: transport, colonize, scrap, merge, lay mines, patrol, route, transfer, refuel (see refuel.ts); invasions.
import { shareOf, people } from './words';
import { atWar, worldTaken } from './diplomacy';
import { seizeArchives } from './espionage';
import { refitOnArrival } from './refit';
import { fleetStrength } from './factions';
import type { Cargo, CargoKey, Fleet, GameState, Landing, Planet, Player, TransportKey, Waypoint } from './types';
import { CARGO_KEYS, MINERALS } from './types';
import { fleetSpec, cargoMass, estimateRoute, distance, fleetCost, canRefuelAt } from './fleet';
import { raceSpec } from './race';
import { planetSpec, colonistSetback } from './planet';
import { layMines } from './movement';
import { specOf, isScoutDesign } from './design';
import { applyTemplate } from './production';
import { addResearch } from './research';
import { Rng } from './rng';
import { FIELDS } from './types';
import { resetPlanetPolicies } from './empire';
import { hasDoctrine } from './doctrines';
import { hasMega } from './megaprojects';
import { FIELD_NAMES } from './tech';
import { colonyBlocker, plantBeacon, beaconToStation, miningBlocker } from './culture';
import { mergeExperience, splitExperience } from './veterans';
import { addChronicle } from './chronicle';
import { diasporaOn, refound } from './diaspora';

function planetHere(game: GameState, f: Fleet): Planet | undefined {
  return f.orbiting >= 0 ? game.planets[f.orbiting] : undefined;
}

export function fleetCargoSpace(game: GameState, f: Fleet): number {
  return fleetSpec(game, f).cargoCapacity - cargoMass(f.cargo);
}

/** Generic transfer between a fleet and a planet; positive amount = load into fleet. Returns amount actually moved. */
export function transferWithPlanet(game: GameState, f: Fleet, planet: Planet, key: TransportKey, amount: number): number {
  const owner = game.players[f.owner];
  if (key === 'fuel') {
    const cap = fleetSpec(game, f).fuelCapacity;
    if (amount > 0) { // only at an own/friend station (any station, an orbital fort included)
      if (!canRefuelAt(game, owner, planet)) return 0;
      const a = Math.min(amount, cap - f.fuel); f.fuel += a; return a;
    }
    const a = Math.min(-amount, f.fuel); f.fuel -= a; return -a;
  }
  if (amount > 0) {
    if (key === 'colonists' && planet.owner !== f.owner) return 0;
    if (planet.owner >= 0 && planet.owner !== f.owner && !fleetSpec(game, f).canStealPlanet) return 0;
    const space = fleetCargoSpace(game, f);
    const avail = key === 'colonists' ? Math.max(0, Math.trunc(planet.pop / 100) - 1) : planet.surface[key as typeof MINERALS[number]];
    const a = Math.max(0, Math.min(amount, space, avail));
    f.cargo[key as CargoKey] += a;
    if (key === 'colonists') planet.pop -= a * 100; else planet.surface[key as typeof MINERALS[number]] -= a;
    return a;
  }
  const want = Math.min(-amount, f.cargo[key as CargoKey]);
  if (want <= 0) return 0;
  if (key === 'colonists') {
    if (planet.owner === f.owner) { planet.pop += want * 100; f.cargo.colonists -= want; return -want; }
    // 0.3.9.16 (Stars!): a world emptied by bombs this year can still be taken by troops this year (it keeps its mines and
    // factories); an empty world otherwise has to be colonized
    const emptied = planet.owner < 0 ? game.emptied?.[planet.id] : undefined;
    if (planet.owner < 0 && (!emptied || emptied.year !== game.year)) return 0; // must colonize
    // invasion
    if (raceSpec(owner.race).livesOnStarbases) return 0;
    if (planet.starbase) { owner.messages.push({ year: game.year, kind: 'combat', text: `Impossible d'envahir ${planet.name} : la planète est protégée par une station orbitale.`, target: { kind: 'planet', id: planet.id } }); return 0; }
    if (planet.owner >= 0 && !atWar(game, owner.id, planet.owner)) { owner.messages.push({ year: game.year, kind: 'combat', text: `Impossible d'envahir ${planet.name} : vous n'êtes pas en guerre avec les ${game.players[planet.owner].name}.`, target: { kind: 'planet', id: planet.id } }); return 0; }
    // 0.3.9.16: the troops land now and fight with everyone else who lands there in the same phase (Stars!: "if more
    // than one player lands ground troops on the planet during the same year, everyone fights until only one side is
    // left"); the outcome is known once the turn is played, never while giving the order
    f.cargo.colonists -= want;
    (game.landings ??= []).push({ planetId: planet.id, owner: owner.id, kt: want, fleetId: f.id, fleetName: f.name });
    return -want;
  }
  planet.surface[key as typeof MINERALS[number]] += want;
  f.cargo[key as CargoKey] -= want;
  return -want;
}

export function transferBetweenFleets(game: GameState, from: Fleet, to: Fleet, key: TransportKey, amount: number, by = to.owner): number {
  // moves `amount` from `from` into `to` (amount >= 0); `by` is the empire giving the order
  if (amount <= 0) return 0;
  if (from.owner !== to.owner) {
    // 0.3.9.16 (Stars!): no colonists to or from another empire's fleet; taking its cargo needs a steal scanner (Pick
    // Pocket, Robber Baron) and never takes its fuel; a fleet accepts nothing from an empire it treats as an enemy
    if (key === 'colonists') return 0;
    if (by === to.owner) { if (key === 'fuel' || !fleetSpec(game, to).canStealFleet) return 0; }
    else if ((game.players[to.owner]?.relations[from.owner] ?? 'enemy') === 'enemy') return 0;
  }
  if (key === 'fuel') {
    const cap = fleetSpec(game, to).fuelCapacity;
    const a = Math.min(amount, from.fuel, cap - to.fuel);
    from.fuel -= a; to.fuel += a; return a;
  }
  if (key === 'colonists' && from.owner !== to.owner) return 0;
  const a = Math.min(amount, from.cargo[key], fleetCargoSpace(game, to));
  from.cargo[key] -= a; to.cargo[key] += a;
  return Math.max(0, a);
}

export function invade(game: GameState, attacker: Player, planet: Planet, colonists: number) {
  const defender = game.players[planet.owner];
  const spec = planetSpec(game, planet);
  const ars = raceSpec(attacker.race), drs = raceSpec(defender.race);
  const afterDef = Math.trunc(colonists * (1 - spec.defenseCoverage * 0.75));
  const defenders = planet.pop;
  // Constellations 3: assault doctrine, planetary shield megaproject
  const atk = ars.invasionAttack * (hasDoctrine(attacker, 'assault') ? 1.3 : 1), def = drs.invasionDefend * (hasMega(planet, 'shield') ? 2 : 1);
  if (afterDef * atk > defenders * def) {
    let remaining = Math.round((afterDef - defenders * def / atk) / 100) * 100;
    if (remaining <= 0) remaining = 100;
    takePlanet(game, attacker, defender, planet, remaining);
  } else {
    let rem = Math.round((defenders - afterDef * atk / def) / 100) * 100;
    if (rem <= 0) rem = 100;
    planet.pop = rem;
    attacker.messages.push({ year: game.year, kind: 'combat', text: `L'invasion de ${planet.name} a échoué : vos ${people(game, colonists)} colons ont tous péri. Il reste ${people(game, rem)} défenseurs.`, target: { kind: 'planet', id: planet.id } });
    defender.messages.push({ year: game.year, kind: 'combat', text: `Vos colons de ${planet.name} ont repoussé une invasion des ${attacker.name}.`, target: { kind: 'planet', id: planet.id } });
  }
}

/** A world taken by troops: from `defender`, or emptied by bombs this year (its last owner given, or none). */
function takePlanet(game: GameState, attacker: Player, defender: Player | undefined, planet: Planet, remaining: number) {
  const before = defender ?? (game.emptied?.[planet.id] ? game.players[game.emptied[planet.id].owner] : undefined);
  attacker.messages.push({ year: game.year, kind: 'combat', text: defender ? `Vos troupes ont conquis ${planet.name} ! ${people(game, remaining)} de vos colons survivent et peuplent désormais la planète.` : `Vos troupes ont pris pied sur ${planet.name}, vidée par les bombardements : ${people(game, remaining)} colons s'y installent, avec ses mines et ses usines.`, target: { kind: 'planet', id: planet.id } });
  if (before && before.id !== attacker.id) before.messages.push({ year: game.year, kind: 'combat', text: defender ? `${planet.name} a été envahie et conquise par les ${attacker.name}.` : `Les ${attacker.name} ont débarqué sur ${planet.name}, vidée par les bombardements : la planète est à eux.`, target: { kind: 'planet', id: planet.id } });
  if (before && before.id !== attacker.id) {
    if (planet.homeworld) attacker.stats.homeworldsTaken = [...(attacker.stats.homeworldsTaken ?? []), before.id];
    if (planet.homeworld || before.capital === planet.id) addChronicle(game, 'conquest', planet.homeworld ? `Les ${attacker.name} prennent ${planet.name}, monde natal des ${before.name}.` : `Les ${attacker.name} prennent ${planet.name}, capitale des ${before.name}.`, [attacker.id, before.id], planet);
    if (defender) seizeArchives(game, attacker.id, defender.id, planet);
  }
  planet.owner = attacker.id; planet.pop = remaining; planet.queue = []; planet.defenses = 0; planet.scanner = false; planet.starbase = null;
  planet.colonizedYear = game.year; planet.conqueredYear = before && before.id !== attacker.id ? game.year : undefined; resetPlanetPolicies(planet);
  if (game.emptied) delete game.emptied[planet.id];
  if (before && before.id !== attacker.id) {
    attacker.stats.planetsCaptured = (attacker.stats.planetsCaptured ?? 0) + 1;
    worldTaken(game, before.id, attacker.id, 'conquest');
    attacker.stats.capturedFrom = [...(attacker.stats.capturedFrom ?? []), before.id];
    if (defender) defender.stats.planetsLost = (defender.stats.planetsLost ?? 0) + 1;
  }
  if (attacker.defaultTemplate >= 0) applyTemplate(game, planet, attacker.defaultTemplate);
  if (before && raceSpec(before.race).instaform) { planet.hab = [...planet.baseHab] as typeof planet.hab; planet.terraformed = [0, 0, 0]; }
  if (defender) techTrade(game, attacker, defender, new Rng(game.rng));
}

/**
 * 0.3.9.16: the ground combat of a phase (Stars!: "if more than one player lands ground troops on the planet during the
 * same year, everyone will fight until only one side is left"). Each world's landings are settled together: one empire
 * against the defenders is the classic invasion; several fight it out, the strongest side wins with what it has over the
 * second (equal sides wipe each other out, and the world is left empty).
 */
export function resolveLandings(game: GameState) {
  const all = game.landings ?? [];
  game.landings = [];
  if (!all.length) return;
  const byPlanet = new Map<number, Landing[]>();
  for (const l of all) { const a = byPlanet.get(l.planetId) ?? []; a.push(l); byPlanet.set(l.planetId, a); }
  for (const [pid, list] of byPlanet) {
    const planet = game.planets[pid];
    // troops that can no longer land (a station built, peace signed, the world colonized meanwhile) go back aboard
    const valid: Landing[] = [];
    for (const l of list) {
      const p = game.players[l.owner];
      const emptiedNow = planet.owner < 0 && game.emptied?.[pid]?.year === game.year;
      const ok = planet.owner === l.owner || (!planet.starbase && (emptiedNow || (planet.owner >= 0 && atWar(game, l.owner, planet.owner))));
      if (ok) { valid.push(l); continue; }
      const f = game.fleets.find(x => x.id === l.fleetId && x.orbiting === pid);
      if (f) f.cargo.colonists += l.kt;
      p.messages.push({ year: game.year, kind: 'combat', text: `Les troupes de ${l.fleetName} n'ont pas pu débarquer sur ${planet.name}${f ? ' et sont remontées à bord' : ' et ont été perdues'}.`, target: { kind: 'planet', id: pid } });
    }
    // reinforcements of the owner simply land
    for (const l of valid.filter(x => x.owner === planet.owner)) planet.pop += l.kt * 100;
    const attackers = new Map<number, number>();
    for (const l of valid) if (l.owner !== planet.owner) attackers.set(l.owner, (attackers.get(l.owner) ?? 0) + l.kt * 100);
    if (!attackers.size) continue;
    const defender = planet.owner >= 0 && planet.pop > 0 ? game.players[planet.owner] : undefined;
    if (attackers.size === 1 && defender) { const [[a, n]] = [...attackers]; invade(game, game.players[a], planet, n); continue; }
    // several sides (or a world emptied this year): everyone fights
    const cov = defender ? planetSpec(game, planet).defenseCoverage : 0;
    const sides = [...attackers].map(([o, n]) => {
      const p = game.players[o];
      const f = raceSpec(p.race).invasionAttack * (hasDoctrine(p, 'assault') ? 1.3 : 1);
      return { owner: o, power: Math.trunc(n * (1 - cov * 0.75)) * f, factor: f, sent: n };
    });
    if (defender) { const f = raceSpec(defender.race).invasionDefend * (hasMega(planet, 'shield') ? 2 : 1); sides.push({ owner: defender.id, power: planet.pop * f, factor: f, sent: planet.pop }); }
    sides.sort((a, b) => b.power - a.power);
    const [w, second] = sides;
    const tie = !!second && Math.abs(w.power - second.power) < 1e-6;
    for (const sd of sides) {
      if (!tie && sd === w) continue;
      if (sd.owner === defender?.id) continue;
      const n = people(game, sd.sent);
      game.players[sd.owner].messages.push({ year: game.year, kind: 'combat', text: sides.length > 2 ? `Vos ${n} colons débarqués sur ${planet.name} ont tous péri dans les combats au sol contre plusieurs empires.` : `Vos ${n} colons débarqués sur ${planet.name} ont tous péri dans les combats au sol.`, target: { kind: 'planet', id: pid } });
    }
    if (tie) {
      // nobody is left: the world is empty
      if (defender) { defender.messages.push({ year: game.year, kind: 'combat', text: `Les combats au sol ont anéanti toute la population de ${planet.name}.`, target: { kind: 'planet', id: pid } }); emptyWorld(planet); }
      continue;
    }
    const left = Math.max(100, Math.round((w.power - (second?.power ?? 0)) / w.factor / 100) * 100);
    if (w.owner === defender?.id) {
      planet.pop = left;
      defender.messages.push({ year: game.year, kind: 'combat', text: `Vos colons de ${planet.name} ont repoussé ${attackers.size > 1 ? 'les invasions de plusieurs empires' : 'une invasion'}.`, target: { kind: 'planet', id: pid } });
    } else takePlanet(game, game.players[w.owner], defender, planet, left);
  }
}

function emptyWorld(planet: Planet) {
  planet.owner = -1; planet.pop = 0; planet.queue = []; planet.defenses = 0; planet.scanner = false; planet.starbase = null;
  planet.route = undefined; planet.packetTarget = undefined; planet.conqueredYear = undefined; resetPlanetPolicies(planet);
}

export function techTrade(game: GameState, gainer: Player, other: Player, rng: Rng) {
  for (const f of FIELDS) {
    const diff = other.tech[f] - gainer.tech[f];
    if (diff <= 0) continue;
    if (rng.chance(0.5 * (1 - Math.pow(0.5, diff)))) {
      gainer.tech[f] += 1;
      gainer.messages.push({ year: game.year, kind: 'research', text: `En étudiant la technologie des ${other.name}, vos scientifiques ont progressé en ${FIELD_NAMES[f]}.`, target: { kind: 'research', id: 0 } });
      return;
    }
  }
}

function amountFor(game: GameState, f: Fleet, key: TransportKey, o: { action: string; amount: number }, planet: Planet | undefined, other: Fleet | undefined): number {
  const spec = fleetSpec(game, f);
  const cap = key === 'fuel' ? spec.fuelCapacity : spec.cargoCapacity;
  const have = key === 'fuel' ? f.fuel : f.cargo[key];
  switch (o.action) {
    case 'loadAll': return 1e9;
    case 'unloadAll': return -have;
    case 'loadAmount': return o.amount;
    case 'unloadAmount': return -Math.min(o.amount, have);
    case 'fillPercent': case 'waitPercent': return Math.max(0, Math.trunc(cap * o.amount / 100) - have);
    case 'setAmount': return o.amount - have;
    case 'setWaypoint': {
      if (key === 'fuel' || !planet) return 0;
      const there = key === 'colonists' ? Math.trunc(planet.pop / 100) : planet.surface[key];
      return there - o.amount; // positive = load excess from planet
    }
    case 'loadOptimal': {
      if (key !== 'fuel') return 0;
      const legs = estimateRoute(game, f, f.waypoints.slice(0, 2), cap);
      const need = legs[0]?.fuel ?? 0;
      return need - have;
    }
    default: return 0;
  }
  void other;
}

/** Process transport orders of the fleet's current waypoint (index 0). Returns true if the fleet must wait. */
export function processTransport(game: GameState, f: Fleet, wp: Waypoint): boolean {
  if (!wp.transport) return false;
  const planet = wp.target === 'planet' ? planetHere(game, f) : undefined;
  const other = wp.target === 'fleet' ? game.fleets.find(x => x.id === wp.targetId && x.x === f.x && x.y === f.y) : undefined;
  if (!planet && !other) return false;
  let wait = false;
  const keys: TransportKey[] = ['fuel', 'ironium', 'boranium', 'germanium', 'colonists'];
  // unloads first
  for (const pass of ['unload', 'load', 'dunnage'] as const) {
    for (const key of keys) {
      const o = wp.transport[key];
      if (!o || o.action === 'none') continue;
      if (pass === 'dunnage' ? o.action !== 'loadDunnage' : o.action === 'loadDunnage') continue;
      let amt = pass === 'dunnage' ? 1e9 : amountFor(game, f, key, o, planet, other);
      if (pass === 'unload' && amt >= 0) continue;
      if (pass === 'load' && amt <= 0) {
        if ((o.action === 'setAmount' || o.action === 'waitPercent') && amt < 0 && pass === 'load') { /* handled in unload */ }
        continue;
      }
      let moved = 0;
      if (planet) {
        const owner = game.players[f.owner];
        // 0.3.6.6: an ark that sets its own world back by more than a year of growth is worth a warning (less than
        // that, the world makes the colonists up within the year: no message)
        const watch = key === 'colonists' && amt > 0 && planet.owner === f.owner && !owner.ai && fleetSpec(game, f).colonizer;
        const before = watch ? { ...planet } : planet;
        moved = transferWithPlanet(game, f, planet, key, amt);
        const years = watch && moved > 0 ? colonistSetback(game, owner, before, moved * 100) : null;
        if (years !== null && years > 1) {
          const share = Math.round(moved * 100 / before.pop * 100);
          const lost = years === Infinity ? 'toute sa population' : `environ ${Math.round(years)} an${Math.round(years) > 1 ? 's' : ''} de croissance`;
          owner.messages.push({ year: game.year, kind: 'warning', text: `${f.name} a embarqué ${people(game, moved * 100)} colons de ${planet.name} (${share} % de sa population) : ${planet.name} perd ${lost}. En dessous d'un quart de sa capacité, un monde croît en proportion de sa population ; pour l'épargner, chargez moins de colons (onglet Échanges de la flotte) ou partez d'un monde plus peuplé.`, target: { kind: 'planet', id: planet.id } });
        }
      } else if (other) moved = amt > 0 ? transferBetweenFleets(game, other, f, key, amt, f.owner) : -transferBetweenFleets(game, f, other, key, -amt, f.owner);
      if ((o.action === 'waitPercent' || o.action === 'setAmount') && Math.abs(moved) < Math.abs(amt) - 1e-6 && amt > 0) {
        const space = key === 'fuel' ? fleetSpec(game, f).fuelCapacity - f.fuel : fleetCargoSpace(game, f);
        if (space > 0) wait = true;
      }
    }
  }
  return wait;
}

export function colonize(game: GameState, f: Fleet, planet: Planet): boolean {
  const owner = game.players[f.owner];
  const spec = fleetSpec(game, f);
  if (!spec.colonizer && !spec.orbitalConstruction) { owner.messages.push({ year: game.year, kind: 'colony', text: `${f.name} ne possède pas de module de colonisation.`, target: { kind: 'fleet', id: f.id } }); return false; }
  if (planet.owner >= 0) { owner.messages.push({ year: game.year, kind: 'colony', text: `${f.name} ne peut pas coloniser ${planet.name} : la planète est déjà habitée.`, target: { kind: 'fleet', id: f.id } }); return false; }
  if (f.cargo.colonists <= 0) { owner.messages.push({ year: game.year, kind: 'colony', text: `${f.name} ne transporte aucun colon pour coloniser ${planet.name}.`, target: { kind: 'fleet', id: f.id } }); return false; }
  const terr = colonyBlocker(game, owner, planet);
  if (terr !== null) { owner.messages.push({ year: game.year, kind: 'colony', text: `${f.name} ne peut pas coloniser ${planet.name} : la planète est dans le territoire des ${game.players[terr].name}. Pour la prendre, il faut d'abord affaiblir leur influence (conquérir leurs mondes voisins) ou la conquérir une fois qu'ils l'auront colonisée.`, target: { kind: 'fleet', id: f.id } }); return false; }
  const rs = raceSpec(owner.race);
  planet.owner = owner.id;
  planet.conqueredYear = undefined; resetPlanetPolicies(planet);
  planet.pop = f.cargo.colonists * 100;
  planet.queue = [];
  planet.colonizedYear = game.year;
  planet.leftoverOnly = false;
  planet.packetWarp = 5;
  for (const m of MINERALS) planet.surface[m] += f.cargo[m];
  const cost = fleetCost(game, f);
  planet.surface.ironium += Math.trunc(cost.ironium * 0.75);
  planet.surface.boranium += Math.trunc(cost.boranium * 0.75);
  planet.surface.germanium += Math.trunc(cost.germanium * 0.75);
  if (rs.livesOnStarbases) {
    const fort = game.designs.find(d => d.owner === owner.id && d.starbase && d.hull === 'Orbital Fort' && !d.deleted && !d.alien);
    if (fort) planet.starbase = { designId: fort.id, damage: 0 };
  }
  if (owner.defaultTemplate >= 0) applyTemplate(game, planet, owner.defaultTemplate);
  owner.stats.planetsColonized++;
  owner.messages.push({ year: game.year, kind: 'colony', text: `${f.name} a fondé une colonie sur ${planet.name} avec ${people(game, planet.pop)} colons.`, target: { kind: 'planet', id: planet.id } });
  if (diasporaOn(game)) refound(game, owner, planet);
  if (planet.artifact) {
    planet.artifact = false;
    const amount = 120 + new Rng(game.rng).int(280);
    const field = FIELDS[new Rng(game.rng).int(6)];
    addResearch(game, owner, field, amount);
    owner.messages.push({ year: game.year, kind: 'research', text: `Vos colons ont découvert un artefact ancien sur ${planet.name}, qui vous rapporte ${amount} points de recherche.`, target: { kind: 'planet', id: planet.id } });
  }
  beaconToStation(game, planet);
  game.fleets.splice(game.fleets.indexOf(f), 1);
  return true;
}

export function scrapFleet(game: GameState, f: Fleet) {
  const owner = game.players[f.owner];
  const rs = raceSpec(owner.race);
  const here = planetHere(game, f);
  // minerals are only recovered where there is someone to take the ships apart: a colony or a station
  const planet = here && ((here.owner >= 0 && here.pop > 0) || here.starbase) ? here : undefined;
  const cost = fleetCost(game, f);
  let mf = 1 / 3, rf = 0;
  if (planet) {
    if (planet.starbase) { mf += rs.scrapMineralOffsetStarbase; rf = rs.scrapResourcesOffsetStarbase; } else { mf += rs.scrapMineralOffset; rf = rs.scrapResourcesOffset; }
  }
  const minerals = { ironium: Math.trunc(cost.ironium * mf), boranium: Math.trunc(cost.boranium * mf), germanium: Math.trunc(cost.germanium * mf) };
  if (planet) {
    for (const m of MINERALS) planet.surface[m] += minerals[m] + f.cargo[m];
    if (planet.owner === f.owner) planet.pop += f.cargo.colonists * 100;
    if (rf > 0 && planet.owner === f.owner) {
      const r = Math.trunc(cost.resources * rf + 0.5);
      const spec = planetSpec(game, planet);
      planet.bonusResources += Math.trunc(spec.resources * r / (spec.resources + r || 1));
    }
    owner.messages.push({ year: game.year, kind: 'fleet', text: `${f.name} a été démantelée sur ${planet.name} : ${minerals.ironium + minerals.boranium + minerals.germanium} kt de minerais déposés sur la planète.`, target: { kind: 'planet', id: planet.id } });
  } else {
    game.salvage.push({ id: game.nextId++, owner: f.owner, x: f.x, y: f.y, cargo: { ironium: minerals.ironium + f.cargo.ironium, boranium: minerals.boranium + f.cargo.boranium, germanium: minerals.germanium + f.cargo.germanium }, age: 0 });
    owner.messages.push({ year: game.year, kind: 'fleet', text: here
      ? `${f.name} a été démantelée en orbite de ${here.name}, sans colonie ni station pour récupérer ses matériaux : l'épave dérive sur place et se disperse peu à peu.`
      : `${f.name} a été démantelée dans l'espace ; une épave de minerais dérive à cet endroit.`, target: here ? { kind: 'planet', id: here.id } : undefined });
  }
  game.fleets.splice(game.fleets.indexOf(f), 1);
}

/** Tasks that stay active at the current waypoint year after year. */
const STANDING_TASKS = new Set(['remoteMine', 'patrol', 'layMines', 'refuel']);

/** Does this fleet have something to do (a route, a task under way, a standing order)? */
export function hasOrders(f: Fleet): boolean {
  const w0 = f.waypoints[0];
  return f.waypoints.length > 1 || !!f.auto || f.pursue !== undefined || f.refuelFor !== undefined || !!f.waiting
    || (f.repeat && !!f.route?.length)
    || (!!w0 && w0.task !== 'none' && w0.task !== 'merge' && (STANDING_TASKS.has(w0.task) || !w0.processed));
}

/**
 * Merges `from` into `into`. With inheritOrders (the player's merges), an idle `into` takes over the orders of
 * `from` when it has some; when both have orders, `into` keeps its own. Returns true when the orders were taken over.
 */
export function mergeFleets(game: GameState, into: Fleet, from: Fleet, inheritOrders = false): boolean {
  if (into.beaconOf !== undefined || from.beaconOf !== undefined) return false; // a beacon is a fort, not a ship
  const inherit = inheritOrders && !hasOrders(into) && hasOrders(from);
  if (inherit) {
    into.waypoints = JSON.parse(JSON.stringify(from.waypoints));
    into.waypoints[0] = { ...into.waypoints[0], x: into.x, y: into.y };
    into.repeat = from.repeat; into.route = from.route ? JSON.parse(JSON.stringify(from.route)) : undefined;
    into.waiting = from.waiting; into.auto = from.auto; into.job = from.job ? { ...from.job } : undefined;
    into.pursue = from.pursue; into.refuelFor = from.refuelFor; into.refuelYear = from.refuelYear;
    into.tankerPost = from.tankerPost ? { ...from.tankerPost } : undefined;
  }
  // whoever was heading for, following or refuelling the absorbed fleet now deals with the merged one
  for (const o of game.fleets) {
    if (o === from) continue;
    if (o.pursue === from.id) o.pursue = o === into ? undefined : into.id;
    if (o.refuelFor === from.id) { if (o === into) { o.refuelFor = undefined; o.refuelYear = undefined; } else o.refuelFor = into.id; }
    for (const w of o.waypoints) {
      if (w.target === 'fleet' && w.targetId === from.id) { if (o === into) { w.target = 'space'; w.targetId = undefined; } else w.targetId = into.id; }
      if (w.mergeWith === from.id) { if (o === into) { w.task = 'none'; w.mergeWith = undefined; } else w.mergeWith = into.id; }
    }
  }
  // orders taken over from a fleet that was following the absorbing one would now point at itself
  for (const w of into.waypoints) {
    if (w.target === 'fleet' && w.targetId === into.id) { w.target = 'space'; w.targetId = undefined; }
    if (w.mergeWith === into.id) { w.task = 'none'; w.mergeWith = undefined; }
  }
  // 0.3.9.11: caught inside closed borders, the merged fleet keeps the shorter delay
  if (from.borderExit && (!into.borderExit || from.borderExit.by < into.borderExit.by)) into.borderExit = { ...from.borderExit };
  if (into.pursue === into.id) into.pursue = undefined;
  if (into.refuelFor === into.id) { into.refuelFor = undefined; into.refuelYear = undefined; }
  mergeExperience(game, into, from);
  for (const t of from.tokens) {
    const ex = into.tokens.find(x => x.designId === t.designId);
    if (ex) {
      const totalDamage = ex.damage * ex.qtyDamaged + t.damage * t.qtyDamaged;
      ex.qty += t.qty; ex.qtyDamaged += t.qtyDamaged;
      ex.damage = ex.qtyDamaged > 0 ? totalDamage / ex.qtyDamaged : 0;
    } else into.tokens.push({ ...t });
  }
  for (const k of CARGO_KEYS) into.cargo[k] += from.cargo[k];
  into.fuel += from.fuel;
  // 0.3.8.9: the name. A name given by the player wins (the absorbing fleet's if both have one); two default names
  // give way to one that says what the merged fleet is
  if (!into.customName) {
    if (from.customName) { into.name = from.name; into.customName = true; }
    else into.name = compositionName(game, into);
  }
  game.fleets.splice(game.fleets.indexOf(from), 1);
  return inherit;
}

/** What a design is for, in a word (for fleet names). */
function shipRole(game: GameState, designId: number): 'war' | 'colony' | 'miner' | 'layer' | 'cargo' | 'tanker' | 'scout' | 'other' {
  const s = specOf(game, designId);
  if (s.bomber || (s.hasWeapons && s.powerRating > 0)) return 'war';
  if (s.colonyModule || s.orbitalConstruction) return 'colony';
  if (s.miningRate > 0) return 'miner';
  if (s.mineLaying.standard + s.mineLaying.heavy + s.mineLaying.speedBump > 0) return 'layer';
  if (s.cargoCapacity > 0) return 'cargo';
  if (s.fuelGeneration > 0 || s.hullType === 'FuelTransport') return 'tanker';
  const d = game.designs.find(x => x.id === designId);
  if (d && isScoutDesign(d, s)) return 'scout';
  return 'other';
}

/**
 * 0.3.8.9: a default name that says roughly what a fleet is: its design's name when it has only one, otherwise its
 * main role (by mass): a war fleet that carries a few support ships is still a war fleet; cargo ships with an
 * armed escort make an escorted convoy.
 */
export function compositionName(game: GameState, f: Fleet): string {
  const designs = [...new Set(f.tokens.map(t => t.designId))];
  if (designs.length === 1) return `${game.designs.find(d => d.id === designs[0])?.name ?? 'Flotte'} #${f.num}`;
  const mass = new Map<string, number>();
  for (const t of f.tokens) { const r = shipRole(game, t.designId); mass.set(r, (mass.get(r) ?? 0) + specOf(game, t.designId).mass * t.qty); }
  const total = [...mass.values()].reduce((a, b) => a + b, 0) || 1;
  const share = (r: string) => (mass.get(r) ?? 0) / total;
  const roles = [...mass.keys()];
  const LABEL: Record<string, string> = { war: 'Flotte de guerre', colony: 'Flotte de colonisation', miner: 'Flotte de minage', layer: 'Mouilleurs de mines', cargo: 'Convoi', tanker: 'Ravitailleurs', scout: 'Éclaireurs', other: 'Flotte' };
  let label: string;
  if (roles.length === 1) label = LABEL[roles[0]];
  else if (mass.has('war') && share('war') >= 0.5) label = LABEL.war;
  else if (mass.has('war') && (mass.has('cargo') || mass.has('colony'))) label = mass.has('colony') ? 'Colonisation escortée' : 'Convoi escorté';
  else label = 'Flotte mixte';
  return `${label} #${f.num}`;
}

/** Split one design (qty) out of a fleet into a new fleet at the same place. */
export function splitFleet(game: GameState, f: Fleet, parts: { designId: number; qty: number }[]): Fleet | null {
  const owner = game.players[f.owner];
  const total = f.tokens.reduce((a, t) => a + t.qty, 0);
  const moving = parts.reduce((a, p) => a + p.qty, 0);
  if (moving <= 0 || moving >= total) return null;
  const capBefore = fleetSpec(game, f).cargoCapacity, fuelCapBefore = fleetSpec(game, f).fuelCapacity;
  owner.fleetNum++;
  const nf: Fleet = {
    ...JSON.parse(JSON.stringify(f)), id: game.nextId++, num: owner.fleetNum, tokens: [], cargo: { ironium: 0, boranium: 0, germanium: 0, colonists: 0 }, fuel: 0, customName: false, route: undefined, repeat: false,
  };
  for (const p of parts) {
    const t = f.tokens.find(x => x.designId === p.designId);
    if (!t || p.qty <= 0) continue;
    const q = Math.min(p.qty, t.qty);
    const dmgQ = Math.min(t.qtyDamaged, q);
    nf.tokens.push({ designId: t.designId, qty: q, damage: t.damage, qtyDamaged: dmgQ });
    t.qty -= q; t.qtyDamaged -= dmgQ;
  }
  f.tokens = f.tokens.filter(t => t.qty > 0);
  nf.name = compositionName(game, nf);
  splitExperience(game, f, nf);
  // 0.3.8.9: a fleet with its default name gets one that fits what is left
  if (!f.customName) f.name = compositionName(game, f);
  game.fleets.push(nf);
  // split cargo & fuel proportionally to capacity
  const capNew = fleetSpec(game, nf).cargoCapacity, fuelNew = fleetSpec(game, nf).fuelCapacity;
  for (const k of CARGO_KEYS) {
    const share = capBefore > 0 ? Math.min(Math.round(f.cargo[k] * capNew / capBefore), f.cargo[k]) : 0;
    nf.cargo[k] = share; f.cargo[k] -= share;
  }
  const fuelShare = fuelCapBefore > 0 ? Math.round(f.fuel * fuelNew / fuelCapBefore) : 0;
  nf.fuel = fuelShare; f.fuel -= fuelShare;
  // the split fleet stays put
  nf.waypoints = [{ ...f.waypoints[0], task: 'none', transport: undefined, processed: true }];
  return nf;
}

/** One fleet per ship: the original keeps one ship (and its orders), every other ship becomes its own fleet. */
export function splitIntoSingles(game: GameState, f: Fleet): Fleet[] {
  const out: Fleet[] = [];
  for (let guard = 0; guard < 10_000; guard++) {
    const total = f.tokens.reduce((a, t) => a + t.qty, 0);
    if (total <= 1) break;
    const t = f.tokens[f.tokens.length - 1];
    const nf = splitFleet(game, f, [{ designId: t.designId, qty: 1 }]);
    if (!nf) break;
    out.push(nf);
  }
  return out;
}

export function transferFleet(game: GameState, f: Fleet, to: number) {
  const from = game.players[f.owner];
  const recipient = game.players[to];
  if (!recipient || recipient.dead) return;
  for (const t of f.tokens) {
    const d = game.designs.find(x => x.id === t.designId)!;
    let copy = game.designs.find(x => x.owner === to && x.alien && x.name === d.name && x.hull === d.hull && JSON.stringify(x.slots) === JSON.stringify(d.slots));
    if (!copy) { copy = { ...JSON.parse(JSON.stringify(d)), id: game.nextId++, owner: to, alien: true, built: 0 }; game.designs.push(copy!); }
    t.designId = copy!.id;
  }
  f.owner = to;
  f.borderExit = undefined;
  recipient.fleetNum++;
  f.num = recipient.fleetNum;
  f.waypoints = [{ x: f.x, y: f.y, target: f.orbiting >= 0 ? 'planet' : 'space', targetId: f.orbiting >= 0 ? f.orbiting : undefined, warp: 0, task: 'none', processed: true }];
  f.battlePlan = 0;
  if (f.cargo.colonists > 0) f.cargo.colonists = 0;
  from.messages.push({ year: game.year, kind: 'diplomacy', text: `Vous avez cédé ${f.name} aux ${recipient.name}.`, target: { kind: 'player', id: recipient.id } });
  recipient.messages.push({ year: game.year, kind: 'diplomacy', text: `Les ${from.name} vous ont cédé la flotte ${f.name}.`, target: { kind: 'fleet', id: f.id } });
}

/** Execute the task of waypoint 0 (the fleet's current location). */
export function processWaypointTask(game: GameState, f: Fleet, rng: Rng) {
  const wp = f.waypoints[0];
  if (!wp || wp.processed) return;
  const owner = game.players[f.owner];
  f.waiting = false;
  switch (wp.task) {
    case 'transport': {
      const wait = processTransport(game, f, wp);
      if (wait) { f.waiting = true; return; }
      break;
    }
    case 'colonize': {
      const planet = planetHere(game, f);
      if (planet) { if (colonize(game, f, planet)) return; }
      break;
    }
    case 'scrap': scrapFleet(game, f); return;
    case 'merge': {
      const target = game.fleets.find(x => x.id === wp.mergeWith && x.owner === f.owner && x.x === f.x && x.y === f.y && x !== f);
      if (target) {
        // the merge itself is done; what follows it on the fleet's route is handed over to an idle target
        wp.task = 'none'; wp.processed = true; wp.mergeWith = undefined;
        const took = mergeFleets(game, target, f, true);
        owner.messages.push({ year: game.year, kind: 'fleet', text: `${f.name} a fusionné avec ${target.name}${took ? ', qui reprend les ordres de la flotte absorbée' : ''}.`, target: { kind: 'fleet', id: target.id } });
        return;
      }
      break;
    }
    case 'route': {
      const planet = planetHere(game, f);
      if (planet && planet.route !== undefined && planet.owner === f.owner) {
        const dest = game.planets[planet.route];
        f.waypoints.push({ x: dest.x, y: dest.y, target: 'planet', targetId: dest.id, warp: fleetSpec(game, f).idealSpeed || 5, task: 'route' });
      }
      break;
    }
    case 'transfer': if (wp.transferTo !== undefined) transferFleet(game, f, wp.transferTo); break;
    case 'patrol': patrol(game, f); return; // patrol stays active
    case 'layMines': return; // handled every year at end of turn
    case 'remoteMine': return; // handled during mining phase
    case 'refuel': return; // standing order, see runTankers
    case 'stay': return; // a sentinel: stays on post (standing order)
    case 'refit': refitOnArrival(game, f, wp.refitTo); break;
    case 'beacon': {
      const planet = planetHere(game, f);
      if (planet) plantBeacon(game, f, planet);
      else if (!owner.ai) owner.messages.push({ year: game.year, kind: 'fleet', text: `${f.name} n'a pas pu poser sa balise : une balise de souveraineté ne se pose qu'en orbite d'une planète.`, target: { kind: 'fleet', id: f.id } });
      break;
    }
    default: break;
  }
  wp.processed = true;
  void rng;
}

/** Strength a fleet sees in a foreign one, from what its scanners identified (null: an unknown contact). */
export function seenStrength(game: GameState, me: Player, fleetId: number): number | null {
  const fi = me.intel.fleets.find(x => x.id === fleetId);
  if (!fi || !fi.tokens || fi.uncertain) return null;
  const real = game.fleets.find(x => x.id === fleetId);
  const probe: Fleet = { ...(real ?? { id: fleetId, owner: fi.owner, num: 0, name: '', x: fi.x, y: fi.y, orbiting: -1, cargo: { ironium: 0, boranium: 0, germanium: 0, colonists: 0 }, fuel: 0, waypoints: [], repeat: false, battlePlan: 0, heading: null, lastWarp: 0, age: 0 }), tokens: fi.tokens.map(t => ({ designId: t.designId, qty: t.qty, damage: 0, qtyDamaged: 0 })) } as Fleet;
  return fleetStrength(game, probe);
}
/** 3.6: an interception that would obviously end in a massacre: the target is this many times stronger. */
export const HOPELESS = 2.5;

function patrol(game: GameState, f: Fleet) {
  const owner = game.players[f.owner];
  const wp = f.waypoints[0];
  const range = wp.patrolRange ?? 50;
  const mine = fleetStrength(game, f);
  let best: { id: number; d: number; x: number; y: number } | null = null;
  for (const fi of owner.intel.fleets) {
    if (fi.owner < 0 || owner.relations[fi.owner] !== 'enemy') continue;
    const d = distance(fi, wp);
    if (d > range || (best && d >= best.d)) continue;
    // 3.6: never into an obvious massacre (an unknown contact is approached: the patrol finds out)
    const theirs = seenStrength(game, owner, fi.id);
    if (theirs !== null && fleetSpec(game, f).hasWeapons && theirs > HOPELESS * mine) {
      if (!(f.shunned ?? []).includes(fi.id)) {
        f.shunned = [...(f.shunned ?? []).slice(-9), fi.id];
        if (!owner.ai) owner.messages.push({ year: game.year, kind: 'fleet', text: `${f.name} ne poursuit pas ${fi.name ?? 'la flotte ennemie'} : cette flotte est bien trop forte pour elle (${shareOf(theirs / Math.max(1, mine))}). Pour l'attaquer malgré tout, donnez à ${f.name} un ordre d'interception manuel (déconseillé).`, target: { kind: 'fleet', id: f.id } });
      }
      continue;
    }
    best = { id: fi.id, d, x: fi.x, y: fi.y };
  }
  if (best && f.waypoints.length === 1) {
    f.waypoints.push({ x: best.x, y: best.y, target: 'fleet', targetId: best.id, warp: wp.patrolWarp ?? (fleetSpec(game, f).idealSpeed || 6), task: 'none', chase: true });
    f.waypoints.push({ x: wp.x, y: wp.y, target: wp.target, targetId: wp.targetId, warp: wp.patrolWarp ?? (fleetSpec(game, f).idealSpeed || 6), task: 'patrol', patrolRange: range, patrolWarp: wp.patrolWarp });
  }
}

/**
 * 3.6: a patrol fleet on its way back to its post (after a chase) that has not the fuel to get there first stops to
 * fill up at the nearest station it can reach, then goes back to its post.
 */
/** 3.6: a patrol chasing a contact that proves far too strong stops and goes back to its post. */
export function chaseChecks(game: GameState) {
  for (const f of game.fleets) {
    const w = f.waypoints[1];
    if (!w || !w.chase || w.target !== 'fleet' || w.targetId === undefined) continue;
    const owner = game.players[f.owner];
    const theirs = seenStrength(game, owner, w.targetId);
    const mine = fleetStrength(game, f);
    if (theirs === null || theirs <= HOPELESS * mine) continue;
    const post = f.waypoints.find((x, i) => i > 1 && x.task === 'patrol');
    const here: Waypoint = { ...f.waypoints[0], x: f.x, y: f.y, task: 'none', transport: undefined, processed: true };
    f.waypoints = post ? [here, post] : [here];
    f.shunned = [...(f.shunned ?? []).slice(-9), w.targetId];
    if (!owner.ai) owner.messages.push({ year: game.year, kind: 'fleet', text: `${f.name} renonce à intercepter ${owner.intel.fleets.find(x => x.id === w.targetId)?.name ?? 'la flotte ennemie'} : maintenant identifiée, elle est bien trop forte (${shareOf(theirs / Math.max(1, mine))})${post ? ' ; retour au poste de patrouille' : ''}. Pour l'attaquer malgré tout, donnez un ordre d'interception manuel (déconseillé).`, target: { kind: 'fleet', id: f.id } });
  }
}

export function patrolFuel(game: GameState) {
  for (const f of game.fleets) {
    const wps = f.waypoints;
    if (wps.length < 2 || wps[wps.length - 1].task !== 'patrol' || f.pursue !== undefined) continue;
    const owner = game.players[f.owner];
    const here = f.orbiting >= 0 ? game.planets[f.orbiting] : undefined;
    if (canRefuelAt(game, owner, here)) continue;
    const est = estimateRoute(game, f);
    if (est.every(l => l.ok)) continue;
    // already stopping at a station on the way
    if (wps.slice(1, -1).some(w => w.target === 'planet' && w.targetId !== undefined && canRefuelAt(game, owner, game.planets[w.targetId]))) continue;
    const post = wps[wps.length - 1];
    const hereWp: Waypoint = { ...wps[0], x: f.x, y: f.y, task: 'none', transport: undefined, processed: true };
    const warp = post.warp || fleetSpec(game, f).idealSpeed || 5;
    let best: { pl: Planet; d: number } | null = null;
    for (const pl of game.planets) {
      if (!canRefuelAt(game, owner, pl)) continue;
      const d = distance(f, pl) + distance(pl, post);
      if (best && d >= best.d) continue;
      const leg = estimateRoute(game, f, [hereWp, { x: pl.x, y: pl.y, target: 'planet', targetId: pl.id, warp, task: 'none' }])[0];
      if (leg && leg.ok) best = { pl, d };
    }
    if (!best) continue;
    f.waypoints = [hereWp, { x: best.pl.x, y: best.pl.y, target: 'planet', targetId: best.pl.id, warp, task: 'none' }, post];
    if (!owner.ai) owner.messages.push({ year: game.year, kind: 'fleet', text: `${f.name} n'a plus assez de carburant pour regagner son poste de patrouille : elle passe faire le plein à ${best.pl.name}, puis regagne son poste.`, target: { kind: 'fleet', id: f.id } });
  }
}

/**
 * 3.6: after the battles, unarmed ships (freighters, colonizers, bombers, scouts) left without an armed escort where
 * armed enemies still stand: they slipped away from the guns this time, but must be told to leave.
 */
export function escortWarnings(game: GameState) {
  for (const b of game.battles) {
    for (const pid of b.players) {
      const p = game.players[pid];
      if (!p || p.ai || p.monster) continue;
      const here = game.fleets.filter(f => Math.abs(f.x - b.x) < 0.5 && Math.abs(f.y - b.y) < 0.5);
      const mine = here.filter(f => f.owner === pid);
      if (!mine.length || mine.some(f => fleetSpec(game, f).hasWeapons)) continue;
      const hostile = (o: number) => o !== pid && (game.players[o]?.monster || p.relations[o] === 'enemy');
      const foes = here.filter(f => hostile(f.owner) && fleetSpec(game, f).hasWeapons);
      const pl = b.planetId !== undefined ? game.planets[b.planetId] : undefined;
      const fort = pl && pl.starbase && hostile(pl.owner) && specOf(game, pl.starbase.designId).hasWeapons;
      if (!foes.length && !fort) continue;
      const hadEscort = b.tokens.some(t => t.owner === pid && t.fleetId >= 0 && specOf(game, t.designId).hasWeapons);
      const where = pl ? pl.name : `(${Math.round(b.x)}, ${Math.round(b.y)})`;
      const names = mine.map(f => f.name);
      p.messages.push({ year: game.year, kind: 'warning', text: names.length > 1
        ? `${names.join(', ')} sont sans escorte à ${where}${hadEscort ? ' : vos vaisseaux de guerre y ont été détruits' : ''}, et des ennemis armés sont toujours sur place. Ils ont échappé aux tirs cette fois-ci : donnez-leur l'ordre de partir.`
        : `${names[0]} est sans escorte à ${where}${hadEscort ? ' : vos vaisseaux de guerre y ont été détruits' : ''}, et des ennemis armés sont toujours sur place. Il a échappé aux tirs cette fois-ci : donnez-lui l'ordre de partir.`, target: { kind: 'fleet', id: mine[0].id } });
    }
  }
}

/** Mine laying (every year while the task is active at the current waypoint, or while moving for SD). */
export function processMineLaying(game: GameState) {
  for (const f of game.fleets) {
    const wp = f.waypoints[0];
    const spec = fleetSpec(game, f);
    const total = spec.mineLaying.standard + spec.mineLaying.heavy + spec.mineLaying.speedBump;
    if (total <= 0) continue;
    if (wp?.task === 'layMines' && f.waypoints.length === 1) {
      layMines(game, f, false);
      if (wp.layYears && wp.layYears > 0) { wp.layYears--; if (wp.layYears === 0) { wp.task = 'none'; wp.processed = true; } }
    } else if (f.waypoints.length > 1 && f.waypoints[1].task === 'layMines' && raceSpec(game.players[f.owner].race).minefieldMoveFactor > 0) {
      layMines(game, f, true);
    }
  }
}

/**
 * 3.2.4: a mining fleet that arrives this year at a world one of its owner's fleets already mines joins it (one
 * fleet per mined world, its robots add up). Players' fleets only; the fleet already there keeps its orders.
 */
export function mergeArrivingMiners(game: GameState) {
  const mining = (f: Fleet) => f.waypoints.length === 1 && f.waypoints[0]?.task === 'remoteMine' && f.orbiting >= 0 && !f.auto && f.pursue === undefined && f.refuelFor === undefined;
  const arrived = (f: Fleet) => f.prevX !== undefined && (f.prevX !== f.x || f.prevY !== f.y);
  for (const f of [...game.fleets]) {
    if (!game.fleets.includes(f) || !mining(f) || !arrived(f)) continue;
    const owner = game.players[f.owner];
    if (owner.ai) continue;
    const others = game.fleets.filter(o => o !== f && o.owner === f.owner && o.orbiting === f.orbiting && mining(o));
    const into = others.find(o => !arrived(o)) ?? others[0];
    if (!into) continue;
    const name = f.name;
    mergeFleets(game, into, f);
    const planet = game.planets[into.orbiting];
    owner.messages.push({ year: game.year, kind: 'fleet', text: `${name} a rejoint ${into.name}, qui fore déjà ${planet.name} : ${fleetSpec(game, into).miningRate} robots en orbite.`, target: { kind: 'fleet', id: into.id } });
  }
}

export function remoteMining(game: GameState, ownPlanetsOnly: boolean) {
  for (const f of game.fleets) {
    const wp = f.waypoints[0];
    if (wp?.task !== 'remoteMine' || f.waypoints.length > 1) continue;
    const planet = planetHere(game, f);
    if (!planet) continue;
    const owner = game.players[f.owner];
    const rs = raceSpec(owner.race);
    const own = planet.owner === f.owner;
    if (ownPlanetsOnly !== own) continue;
    if (planet.owner >= 0 && !(own && rs.canRemoteMineOwn)) continue;
    // Constellations 3.3: not in the territory of an empire you call a friend
    const friendTerr = miningBlocker(game, owner, planet);
    if (friendTerr !== null) {
      if ((f.prevX !== f.x || f.prevY !== f.y) && !owner.ai) owner.messages.push({ year: game.year, kind: 'fleet', text: `${f.name} ne fore pas ${planet.name} : la planète est dans le territoire de vos amis les ${game.players[friendTerr].name}. Le forage n'y est permis qu'aux empires neutres ou en guerre avec eux.`, target: { kind: 'fleet', id: f.id } });
      continue;
    }
    if (f.prevX !== f.x || f.prevY !== f.y) continue; // arrived this year
    const spec = fleetSpec(game, f);
    if (spec.miningRate <= 0) continue;
    for (const m of MINERALS) {
      const out = Math.trunc(planet.conc[m] * spec.miningRate * 10 / 1000);
      planet.surface[m] += out;
      planet.mineYears[m] += spec.miningRate;
      const conc = Math.max(planet.conc[m], 1);
      const rollover = 1_500_000 / (conc * conc);
      if (planet.mineYears[m] > rollover) {
        planet.conc[m] = Math.max(1, conc - Math.trunc(planet.mineYears[m] / rollover));
        planet.mineYears[m] = planet.mineYears[m] % rollover;
      }
    }
    // remote miners learn the planet
    const intel = owner.intel.planets[planet.id];
    intel.surface = { ...planet.surface };
  }
}

export function cargoTotal(c: Cargo): number { return cargoMass(c); }
