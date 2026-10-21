// Battle engine: 10x10 board, initiative order, beam & torpedo fire, tactics, battle recordings for the VCR.
import { people } from './words';
import { diplomacyOn, statusOf } from './diplomacy';
import { TRUCE_RADIUS } from './crisis';
import { MINERALS } from './types';
import type { BattleAction, BattlePlan, BattleRecord, BattleTokenRecord, Fleet, GameState, Planet, Player, ShipDesign, ShipRole, TargetClass } from './types';
import { Rng, seedFromString } from './rng';
import { specOf, autoRole, battleSpeed, type DesignSpec, type WeaponSpec } from './design';
import { raceSpec } from './race';
import { RULES_RAW } from '../data/rules-raw';
import { learnDesign, meet } from './scan';
import { cargoMass, clampFleetHold, distance, estimateRoute, fleetSpec } from './fleet';
import { shieldFactorAt } from './terrain';
import { resetPlanetPolicies } from './empire';
import { veteransOn, rankOf, rankBonus, battleExperience, logFleet } from './veterans';
import { battleGrudges } from './nemesis';
import { foughtWith } from './techtrade';

// 0.3.9.15: the starting squares depend on how many empires take part (one formation per count, as in Stars!; more than
// the largest formation share its squares)
const FORMATIONS: ({ x: number; y: number }[] | null)[] = RULES_RAW.battleStart;
const MOVES: Record<string, number[]> = RULES_RAW.movesPerRound;

export interface Token {
  rec: BattleTokenRecord;
  owner: number;
  fleet: Fleet | null;
  planet: Planet | null;
  designId: number;
  spec: DesignSpec;
  qty: number;
  armor: number;
  shieldsPerShip: number;
  stackShields: number;
  /**
   * 0.3.9.16 (Stars!): armour damage of each damaged ship (dp), and how many ships of the stack are damaged. A hit kills
   * the damaged ships first (at what armour they have left), then whole ones; what is left of it is spread over the whole
   * stack, every ship then damaged alike.
   */
  damage: number;
  qtyDamaged: number;
  x: number;
  y: number;
  movement: number;
  plan: BattlePlan;
  ranAway: boolean;
  movesMade: number;
  /** 0.3.9.16: moves spent trying to leave the board (seven squares of movement and it is gone, as in Stars!) */
  fleeMoves: number;
  tookDamage: boolean;
  mass: number;
  dead: boolean;
  cost: { boranium: number; resources: number };
  /** Constellations 3 */
  role: ShipRole;
  threat: number;
  retreating: boolean;
  /** 0.3.9: rank of the crews (veterans) */
  vet: number;
  /** 0.3.9.16: the order in which tokens of the same initiative fire, drawn once for the whole battle (Stars!) */
  prio: number;
}

/** Armour left on a stack (dp). */
const armorLeft = (t: { armor: number; qty: number; damage: number; qtyDamaged: number }) => Math.max(0, t.armor * t.qty - t.damage * t.qtyDamaged);
/** Armour left on its most damaged ship. */
const weakest = (t: { armor: number; damage: number; qtyDamaged: number }) => t.qtyDamaged > 0 ? t.armor - t.damage : t.armor;

/**
 * 0.3.9.16, armour damage as in Stars! (help, "Armor, Shields and Damage"): the damage kills the damaged ships first, each
 * at the armour it has left, then whole ships (no more than `limit`); what is left is spread equally over the whole
 * stack. Returns the ships killed. Before, the damage of a stack was pooled and every ship's worth of it killed a ship:
 * a stack lost its ships (and its firepower) far too early, and one already damaged lost half of them to a scratch.
 */
export function armorHit(t: { armor: number; qty: number; damage: number; qtyDamaged: number }, dmg: number, limit = Infinity): number {
  let d = Math.max(0, dmg), killed = 0;
  if (t.qtyDamaged > 0 && t.damage > 0) {
    const left = t.armor - t.damage;
    const k = Math.min(t.qtyDamaged, limit, Math.floor(d / left + 1e-9));
    killed += k; t.qty -= k; t.qtyDamaged -= k; d -= k * left;
  }
  if (killed < limit && d >= t.armor - 1e-9) {
    const k = Math.min(t.qty - t.qtyDamaged, limit - killed, Math.floor(d / t.armor + 1e-9));
    killed += k; t.qty -= k; d -= k * t.armor;
  }
  if (t.qty <= 0) { t.qty = 0; t.qtyDamaged = 0; t.damage = 0; return killed; }
  if (d > 1e-9) {
    // a hit that kills nobody (or what is left once the killed ships are counted) is spread over the whole stack
    const total = (t.qtyDamaged > 0 ? t.damage * t.qtyDamaged : 0) + Math.min(d, t.armor * t.qty);
    t.damage = Math.min(t.armor - 1e-6, total / t.qty);
    t.qtyDamaged = t.qty;
  } else if (t.qtyDamaged <= 0) t.damage = 0;
  return killed;
}

interface Slot { token: Token; weapon: WeaponSpec; initiative: number; rnd: number }

const cheb = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

export function willAttack(game: GameState, attacker: Player, plan: BattlePlan, defender: number): boolean {
  if (attacker.id === defender) return false;
  // 3.4: monsters (guardians, pirates, the crisis) leave each other alone
  if (attacker.monster && game.players[defender]?.monster) return false;
  // 3.4: with diplomacy, empires fight only the empires they are at war with
  if (diplomacyOn(game) && !attacker.monster && game.players[defender] && !game.players[defender].monster) {
    if (plan.attackWho === 'nobody' || statusOf(game, attacker.id, defender) !== 'war') return false;
    return plan.attackWho.startsWith('player:') ? plan.attackWho === `player:${defender}` : true;
  }
  const rel = attacker.relations[defender] ?? 'enemy';
  switch (plan.attackWho) {
    case 'nobody': return false;
    case 'enemies': return rel === 'enemy';
    case 'enemiesAndNeutrals': return rel !== 'friend';
    case 'everyone': return true;
    default: return plan.attackWho === `player:${defender}`;
  }
}

function planFor(game: GameState, owner: number, id: number): BattlePlan {
  const p = game.players[owner];
  return p.battlePlans.find(b => b.id === id) ?? p.battlePlans[0];
}

function matchesClass(t: Token, cls: TargetClass): boolean {
  const s = t.spec;
  switch (cls) {
    case 'none': return false;
    case 'any': return true;
    case 'starbase': return s.starbase;
    case 'armed': return s.hasWeapons;
    // 0.3.9.16 (help, Battle Plans): "unarmed" means without weapons or bombs; the bomber, freighter and fuel transport
    // classes are unarmed ships
    case 'bomberFreighter': return !s.hasWeapons && (s.bomber || s.cargoCapacity > 0);
    case 'unarmed': return !s.hasWeapons && !s.bomber;
    case 'fuelTransport': return !s.hasWeapons && s.hullType === 'FuelTransport';
    case 'freighter': return s.cargoCapacity > 0 && !s.hasWeapons;
  }
}

function accuracy(w: WeaponSpec, attacker: Token, target: Token): number {
  const bonus = attacker.spec.torpedoBonus, jam = target.spec.torpedoJamming;
  const base = w.accuracy;
  if (jam >= bonus) return base * (1 - (jam - bonus));
  return base + (1 - base) * (bonus - jam);
}

/** Damage a ship can deal (power rating), bombs and a little of its cost: what killing it is worth. */
function threatOf(spec: DesignSpec, cost: { boranium: number; resources: number }): number {
  const bombs = spec.bombs.reduce((a, b) => a + (b.killRate * 10 + b.structure) * b.qty, 0);
  return spec.powerRating + bombs + 0.05 * (cost.boranium + cost.resources) + 1;
}

/**
 * Constellations 3 targeting: fire goes first to the stacks that deal the most damage (threat of the whole stack),
 * a little toward those easier to kill. Cheap decoys ("chaff") no longer soak up the fire: they threaten nothing.
 * Screens draw fire, artillery is shot last.
 */
function threatAttractiveness(w: WeaponSpec, a: Token, t: Token): number {
  const shield = t.qty > 0 ? t.stackShields / t.qty : t.shieldsPerShip;
  const armor = t.qty > 0 ? armorLeft(t) / t.qty : t.armor;
  const hp = Math.max(1, armor + shield);
  let effort: number;
  if (!w.torpedo) effort = hp * (t.spec.beamDefense < 1 ? 2 - t.spec.beamDefense : 1);
  else {
    const acc = Math.max(0.01, accuracy(w, a, t));
    const perShot = Math.max(1, w.power * (w.capital && shield <= 0 ? 2 : 1));
    effort = Math.ceil(hp / perShot) * w.power / acc;
  }
  let v = t.threat * Math.max(1, t.qty) / Math.pow(Math.max(1, effort), 0.25);
  if (t.role === 'screen') v *= 4; else if (t.role === 'artillery') v *= 0.5;
  return v;
}

export function attractiveness(w: WeaponSpec, attacker: Token, t: Token, roles = false): number {
  if (roles) return threatAttractiveness(w, attacker, t);
  const armor = armorLeft(t), shields = t.stackShields;
  let defense: number;
  if (!w.torpedo) defense = (armor + shields) * (t.spec.beamDefense < 1 ? 2 - t.spec.beamDefense : 1);
  else {
    const acc = Math.max(0.01, accuracy(w, attacker, t));
    defense = shields >= armor ? armor * 2 / acc : shields * 2 / acc + (armor - shields) / (acc * (w.capital ? 2 : 1));
  }
  if (defense <= 0) defense = 1;
  // 0.3.9.16: the cost of the whole stack against the defence of the whole stack (the cost of one ship over the defence of
  // the stack made a stack of ten ships ten times less worth shooting than one ship alone)
  return (t.cost.boranium + t.cost.resources) * Math.max(1, t.qty) / defense;
}

export function resolveBattles(game: GameState, rng: Rng): BattleRecord[] {
  const records: BattleRecord[] = [];
  // group by location
  const groups = new Map<string, { fleets: Fleet[]; planet: Planet | null; x: number; y: number }>();
  for (const f of game.fleets) {
    if (f.tokens.length === 0) continue;
    const key = `${Math.round(f.x)},${Math.round(f.y)}`;
    let g = groups.get(key);
    if (!g) { g = { fleets: [], planet: null, x: f.x, y: f.y }; groups.set(key, g); }
    g.fleets.push(f);
  }
  for (const p of game.planets) {
    if (!p.starbase || p.owner < 0) continue;
    const key = `${p.x},${p.y}`;
    const g = groups.get(key);
    if (g) g.planet = p;
  }
  for (const g of groups.values()) {
    if (!g.planet) {
      const p = game.planets.find(pl => pl.x === Math.round(g.x) && pl.y === Math.round(g.y));
      if (p && p.starbase && p.owner >= 0) g.planet = p;
    }
    const owners = new Set(g.fleets.map(f => f.owner));
    if (g.planet?.starbase) owners.add(g.planet.owner);
    if (owners.size < 2) continue;
    const rec = fight(game, rng, g.fleets, g.planet, g.x, g.y);
    if (rec) records.push(rec);
  }
  return records;
}

function fight(game: GameState, rng: Rng, fleets: Fleet[], planet: Planet | null, x: number, y: number): BattleRecord | null {
  const roles = !!game.settings.combatRoles;
  // who will attack whom
  const owners = [...new Set([...fleets.map(f => f.owner), ...(planet?.starbase ? [planet.owner] : [])])].sort((a, b) => a - b);
  // 3.4: at the Breach of the crisis, the empires never fight each other
  const breach = game.crisis?.phase === 'active' && game.crisis.planetId !== undefined ? game.planets[game.crisis.planetId] : undefined;
  const truce = !!breach && Math.hypot(x - breach.x, y - breach.y) <= TRUCE_RADIUS;
  // a plan whose primary target is None looks for no target at all (help, Battle Plans)
  const hostile = (a: number, b: number, plan: BattlePlan) => plan.primary !== 'none' && !(truce && !game.players[a].monster && !game.players[b].monster) && willAttack(game, game.players[a], plan, b);
  // 0.3.9.16 (Stars!, "Guts of the battle engine"): an empire with ships (armed or not) under orders to attack another one
  // present makes itself a legitimate target of that one, which fires back whatever its own orders say
  const orders = new Set<string>();
  // 0.3.9.21: the station fights with the plan it has in the battle (armed first), also when deciding whether to open fire
  const stationPlan = (owner: number): BattlePlan => ({ ...game.players[owner].battlePlans[0], primary: 'armed' as TargetClass, secondary: 'any' as TargetClass, tactic: 'maximizeDamage' as const });
  for (const f of fleets) {
    const plan = planFor(game, f.owner, f.battlePlan);
    for (const o of owners) if (o !== f.owner && hostile(f.owner, o, plan)) orders.add(`${f.owner}>${o}`);
  }
  if (planet?.starbase && specOf(game, planet.starbase.designId).hasWeapons) for (const o of owners) if (o !== planet.owner && hostile(planet.owner, o, stationPlan(planet.owner))) orders.add(`${planet.owner}>${o}`);
  const enemyOf = (a: number, b: number, plan: BattlePlan) => hostile(a, b, plan) || (plan.primary !== 'none' && orders.has(`${b}>${a}`));
  let anyAttack = false;
  for (const f of fleets) {
    const spec = f.tokens.some(t => specOf(game, t.designId).hasWeapons);
    if (!spec) continue;
    const plan = planFor(game, f.owner, f.battlePlan);
    // a fleet told to disengage starts no battle (it would not fire in it)
    if (plan.tactic === 'disengage') continue;
    if (owners.some(o => hostile(f.owner, o, plan))) { anyAttack = true; break; }
  }
  // an armed station can open fire on enemies in orbit (help, Starbases)
  if (!anyAttack && planet?.starbase) {
    const sbSpec = specOf(game, planet.starbase.designId);
    const plan = stationPlan(planet.owner);
    if (sbSpec.hasWeapons && owners.some(o => hostile(planet.owner, o, plan))) anyAttack = true;
  }
  if (!anyAttack) return null;

  const tokens: Token[] = [];
  let nextTokenId = 1;
  const startPos = new Map<number, { x: number; y: number }>();
  const formation = FORMATIONS[Math.max(1, Math.min(FORMATIONS.length - 1, owners.length))]!;
  owners.forEach((o, i) => startPos.set(o, formation[i % formation.length]));
  // Constellations 3 roles: screens one square forward, artillery one square back
  const placed = (o: number, role: ShipRole) => {
    const p = startPos.get(o)!;
    if (!roles || role === 'line') return p;
    const k = role === 'screen' ? 1 : -1;
    const dx = Math.sign(4.5 - p.x) * k, dy = Math.sign(4.5 - p.y) * k;
    return { x: Math.max(0, Math.min(9, p.x + dx)), y: Math.max(0, Math.min(9, p.y + dy)) };
  };
  // 3.6: no role chosen: from the weapons (torpedoes and missiles: artillery; beams: line)
  const roleOf = (d: ShipDesign | undefined, hasWeapons: boolean, spec?: DesignSpec): ShipRole => roles && hasWeapons ? (d?.role ?? (spec ? autoRole(spec) : 'line')) : 'line';
  const vets = veteransOn(game);
  for (const f of fleets) {
    const plan = planFor(game, f.owner, f.battlePlan);
    const totalCap = f.tokens.reduce((a, t) => a + specOf(game, t.designId).cargoCapacity * t.qty, 0);
    const cm = cargoMass(f.cargo);
    for (const t of f.tokens) {
      const spec = specOf(game, t.designId);
      const share = totalCap > 0 ? Math.trunc(cm * spec.cargoCapacity * t.qty / totalCap / Math.max(1, t.qty)) : 0;
      const mass = spec.mass + share;
      // 0.3.9.16: a ship moves on the board as heavy as it is (its share of the cargo), not as if its hold were full
      const movement = share > 0 ? battleSpeed(spec.idealSpeed, spec.movementBonus ?? 0, spec.mass + share, spec.numEngines) : spec.movement;
      const d = game.designs.find(x => x.id === t.designId)!;
      const role = roleOf(d, spec.hasWeapons, spec);
      const pos = placed(f.owner, role);
      const tok: Token = {
        rec: {
          id: nextTokenId++, owner: f.owner, fleetId: f.id, designId: t.designId, designName: d.name, hull: d.hull, qty: t.qty, armor: spec.armor,
          shields: spec.shields, damage: t.damage, qtyDamaged: t.qtyDamaged, x: pos.x, y: pos.y, initiative: spec.initiative, movement: spec.movement, starbase: false,
        },
        owner: f.owner, fleet: f, planet: null, designId: t.designId, spec, qty: t.qty, armor: spec.armor, shieldsPerShip: spec.shields,
        stackShields: spec.shields * t.qty, damage: t.qtyDamaged > 0 ? Math.min(t.damage, spec.armor - 1) : 0, qtyDamaged: t.damage > 0 ? Math.min(t.qty, t.qtyDamaged) : 0, x: pos.x, y: pos.y,
        movement, plan, ranAway: false, movesMade: 0, fleeMoves: 0, tookDamage: false, mass, dead: false,
        cost: { boranium: spec.cost.boranium, resources: spec.cost.resources },
        role, threat: threatOf(spec, spec.cost), retreating: false, vet: vets ? rankOf(f) : 0, prio: rng.random(),
      };
      tokens.push(tok);
    }
  }
  if (planet?.starbase) {
    const spec = specOf(game, planet.starbase.designId);
    const d = game.designs.find(x => x.id === planet.starbase!.designId)!;
    const pos = startPos.get(planet.owner)!;
    const plan = stationPlan(planet.owner);
    tokens.push({
      rec: { id: nextTokenId++, owner: planet.owner, fleetId: -1, planetId: planet.id, designId: d.id, designName: d.name, hull: d.hull, qty: 1, armor: spec.armor, shields: spec.shields, damage: planet.starbase.damage, qtyDamaged: planet.starbase.damage > 0 ? 1 : 0, x: pos.x, y: pos.y, initiative: spec.initiative, movement: 0, starbase: true },
      owner: planet.owner, fleet: null, planet, designId: d.id, spec, qty: 1, armor: spec.armor, shieldsPerShip: spec.shields, stackShields: spec.shields,
      damage: Math.min(planet.starbase.damage, spec.armor - 1), qtyDamaged: planet.starbase.damage > 0 ? 1 : 0, x: pos.x, y: pos.y, movement: 0, plan, ranAway: false, movesMade: 0, fleeMoves: 0, tookDamage: false, mass: 0, dead: false,
      cost: { boranium: spec.cost.boranium, resources: spec.cost.resources },
      role: 'line', threat: threatOf(spec, spec.cost), retreating: false, vet: 0, prio: rng.random(),
    });
  }
  // ion storm: shields at half strength
  const sf = shieldFactorAt(game, { x, y });
  if (sf < 1) for (const t of tokens) { t.shieldsPerShip = Math.trunc(t.shieldsPerShip * sf); t.stackShields = Math.trunc(t.stackShields * sf); t.rec.shields = t.shieldsPerShip; }
  // energy dampener
  const damp = Math.max(0, ...tokens.map(t => t.spec.reduceMovement));
  if (damp > 0) for (const t of tokens) if (t.movement > 0) t.movement = Math.max(2, t.movement - damp);
  for (const t of tokens) t.rec.movement = t.movement;

  const actions: BattleAction[] = [];
  const record: BattleRecord = {
    id: game.nextId++, year: game.year, x, y, planetId: planet?.id, players: owners, tokens: tokens.map(t => ({ ...t.rec })), actions, losses: {}, rounds: 0,
  };
  const alive = (t: Token) => !t.dead && !t.ranAway && t.qty > 0;
  // 0.3.9: ships destroyed by each fleet, and by each empire of each other one
  const killsOf = new Map<Fleet, number>();
  const killsBy: Record<number, Record<number, number>> = {};
  const credit = (a: Token, b: Token, k: number) => {
    if (!k) return;
    if (a.fleet) killsOf.set(a.fleet, (killsOf.get(a.fleet) ?? 0) + k);
    const r = killsBy[a.owner] ?? (killsBy[a.owner] = {});
    r[b.owner] = (r[b.owner] ?? 0) + k;
  };
  const accVet = (w: WeaponSpec, a: Token, b: Token) => Math.min(1, accuracy(w, a, b) + (a.vet ? rankBonus(a.vet).accuracy : 0));
  const attacks = (a: Token, b: Token) => a.owner !== b.owner && enemyOf(a.owner, b.owner, a.plan) && a.spec.hasWeapons && a.plan.tactic !== 'disengage';
  const targetsOf = (a: Token, w: WeaponSpec): Token[] => {
    const enemies = tokens.filter(b => alive(b) && attacks(a, b));
    const prim = enemies.filter(b => matchesClass(b, a.plan.primary) && !(w.sapper && b.stackShields <= 0));
    const sec = enemies.filter(b => !prim.includes(b) && matchesClass(b, a.plan.secondary) && !(w.sapper && b.stackShields <= 0));
    prim.sort((p, q) => attractiveness(w, a, q, roles) - attractiveness(w, a, p, roles));
    sec.sort((p, q) => attractiveness(w, a, q, roles) - attractiveness(w, a, p, roles));
    return [...prim, ...sec];
  };
  const estDamage = (a: Token, w: WeaponSpec, from: { x: number; y: number }, b: Token): number => {
    const dist = cheb(from, b);
    if (dist > w.range) return 0;
    if (w.torpedo) return w.power * w.qty * a.qty * accuracy(w, a, b) + w.power * w.qty * a.qty * (1 - accuracy(w, a, b)) / 8;
    return w.power * w.qty * a.qty * (w.range === 0 ? 1 : 1 - dist / w.range * 0.1) * b.spec.beamDefense;
  };
  const damageTakenAt = (t: Token, pos: { x: number; y: number }) => {
    let sum = 0;
    for (const e of tokens) {
      if (!alive(e) || !attacks(e, t)) continue;
      for (const w of e.spec.weapons) sum += estDamage(e, w, e, { ...t, x: pos.x, y: pos.y } as Token) * (matchesClass(t, e.plan.primary) || matchesClass(t, e.plan.secondary) ? 1 : 0);
    }
    return sum;
  };
  const damageDoneAt = (t: Token, pos: { x: number; y: number }) => {
    let sum = 0;
    for (const w of t.spec.weapons) {
      const tg = targetsOf(t, w);
      for (const b of tg) { const d = estDamage(t, w, pos, b); if (d > 0) { sum += d; break; } }
    }
    return sum;
  };

  const moveToken = (t: Token) => {
    if (t.movement <= 0 || !alive(t)) return;
    let tactic = t.plan.tactic;
    const hasTargets = t.spec.weapons.some(w => targetsOf(t, w).length > 0);
    if (tactic === 'disengageIfChallenged' && t.tookDamage) tactic = 'disengage';
    // Constellations 3: artillery keeps its distance, screens close in, a beaten fleet withdraws
    if (roles && tactic !== 'disengage') { if (t.role === 'artillery') tactic = 'maximizeDamageRatio'; else if (t.role === 'screen') tactic = 'maximizeDamage'; }
    if (t.retreating) tactic = 'disengage';
    if (!t.spec.hasWeapons || !hasTargets) {
      // unarmed or nothing to shoot: run away if threatened
      const threatened = tokens.some(e => alive(e) && attacks(e, t));
      if (!threatened) return;
      tactic = 'disengage';
    }
    const cands: { x: number; y: number }[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const nx = t.x + dx, ny = t.y + dy;
      if (nx >= 0 && nx < 10 && ny >= 0 && ny < 10) cands.push({ x: nx, y: ny });
    }
    let best: { x: number; y: number }[] = [];
    if (tactic === 'disengage') {
      // 0.3.9.16 (help, Battle Plans: "seven squares of movement"): every move spent trying to leave counts, even when the
      // token is cornered and stays where it is; it is then gone from the board
      if (t.fleeMoves >= 7) { t.ranAway = true; actions.push({ t: 'leave', id: t.rec.id }); return; }
      t.fleeMoves++;
      let bv = Infinity;
      for (const c of cands) { const v = damageTakenAt(t, c) - (c.x === t.x && c.y === t.y ? -0.001 : 0); if (v < bv - 1e-9) { bv = v; best = [c]; } else if (Math.abs(v - bv) < 1e-9) best.push(c); }
      // prefer moving away from the centre of enemies
      const enemies = tokens.filter(e => alive(e) && e.owner !== t.owner);
      if (enemies.length) {
        const cx = enemies.reduce((a, e) => a + e.x, 0) / enemies.length, cy = enemies.reduce((a, e) => a + e.y, 0) / enemies.length;
        best.sort((a, b) => Math.hypot(b.x - cx, b.y - cy) - Math.hypot(a.x - cx, a.y - cy));
        best = [best[0]];
      }
    } else {
      const scored = cands.map(c => ({ c, done: damageDoneAt(t, c), taken: damageTakenAt(t, c) }));
      const anyDone = scored.some(s => s.done > 0);
      if (!anyDone) {
        // move toward the most attractive target
        let target: Token | null = null, ta = -Infinity;
        for (const w of t.spec.weapons) { const tg = targetsOf(t, w); if (tg.length) { const a = attractiveness(w, t, tg[0], roles); if (a > ta) { ta = a; target = tg[0]; } } }
        if (!target) return;
        let bd = Infinity;
        for (const c of cands) { const d = cheb(c, target); if (d < bd) { bd = d; best = [c]; } else if (d === bd) best.push(c); }
      } else {
        let bv = -Infinity;
        for (const s of scored) {
          let v: number;
          switch (tactic) {
            case 'maximizeDamageRatio': v = s.done <= 0 ? -Infinity : s.taken <= 0 ? 1e9 + s.done : s.done / s.taken; break;
            case 'maximizeNetDamage': v = s.done <= 0 ? -Infinity : s.done - s.taken; break;
            case 'minimizeDamage': v = -s.taken * 1e6 + s.done; break;
            default: v = s.done;
          }
          if (v > bv + 1e-9) { bv = v; best = [s.c]; } else if (Math.abs(v - bv) <= 1e-9) best.push(s.c);
        }
      }
    }
    if (!best.length) return;
    // centre preference then random
    const cd = (c: { x: number; y: number }) => Math.hypot(c.x - 4.5, c.y - 4.5);
    best.sort((a, b) => cd(a) - cd(b));
    let top = best.filter(b => Math.abs(cd(b) - cd(best[0])) < 1e-9);
    // 0.3.9.16: at equal value, a straight move rather than a diagonal one (the replay of a battle of the original, a
    // probe charging a station along its row, goes straight); then at random
    const turns = (c: { x: number; y: number }) => (c.x !== t.x ? 1 : 0) + (c.y !== t.y ? 1 : 0);
    const fewest = Math.min(...top.map(turns));
    top = top.filter(c => turns(c) === fewest);
    const choice = top[rng.int(top.length)];
    if (choice.x !== t.x || choice.y !== t.y) {
      t.x = choice.x; t.y = choice.y; t.movesMade++;
      actions.push({ t: 'move', id: t.rec.id, x: t.x, y: t.y });
    }
  };

  const applyArmor = (target: Token, dmg: number, limit = Infinity): number => {
    // returns ships killed; dmg is armor damage applied to the stack
    const killed = armorHit(target, dmg, limit);
    if (target.qty <= 0) { target.qty = 0; target.dead = true; target.stackShields = 0; }
    else target.stackShields = Math.min(target.stackShields, target.shieldsPerShip * target.qty);
    if (dmg > 0) target.tookDamage = true;
    return killed;
  };

  const fire = (s: Slot) => {
    const a = s.token, w = s.weapon;
    if (!alive(a)) return;
    const tg = targetsOf(a, w).filter(b => cheb(a, b) <= w.range);
    if (!tg.length) return;
    if (!w.torpedo) {
      const vm = a.vet ? rankBonus(a.vet).damage : 1;
      let damage = w.power * w.qty * a.qty * vm;
      for (const b of tg) {
        if (!alive(b)) continue;
        const dist = cheb(a, b);
        const full = w.gatling || w.hitsAll ? w.power * w.qty * a.qty * vm : damage;
        let d = Math.round(full * (w.range === 0 || w.gatling || w.hitsAll ? 1 : 1 - dist / w.range * 0.1) * b.spec.beamDefense);
        let shieldDmg = 0, armorDmg = 0, killed = 0;
        if (w.sapper) { shieldDmg = Math.min(b.stackShields, d); b.stackShields -= shieldDmg; d -= shieldDmg; }
        else if (d <= b.stackShields) { shieldDmg = d; b.stackShields -= d; d = 0; }
        else {
          shieldDmg = b.stackShields; d -= b.stackShields; b.stackShields = 0;
          const remainingArmor = armorLeft(b);
          armorDmg = Math.min(d, remainingArmor);
          killed = applyArmor(b, armorDmg);
          d -= armorDmg;
        }
        b.tookDamage = b.tookDamage || shieldDmg + armorDmg > 0;
        actions.push({ t: 'fire', id: a.rec.id, target: b.rec.id, weapon: w.part, torpedo: false, shieldDmg, armorDmg, killed, fromX: a.x, fromY: a.y });
        if (killed) { record.losses[b.owner] = (record.losses[b.owner] ?? 0) + killed; credit(a, b, killed); }
        if (w.gatling || w.hitsAll) continue;
        damage = d;
        if (damage <= 0) break;
      }
    } else {
      const n = w.qty * a.qty;
      let idx = 0;
      let hits = 0, misses = 0;
      const per = new Map<Token, { shield: number; armor: number; killed: number; hits: number; misses: number }>();
      for (let i = 0; i < n; i++) {
        while (idx < tg.length && !alive(tg[idx])) idx++;
        if (idx >= tg.length) break;
        const b = tg[idx];
        const e = per.get(b) ?? { shield: 0, armor: 0, killed: 0, hits: 0, misses: 0 };
        per.set(b, e);
        if (rng.random() < accVet(w, a, b)) {
          hits++; e.hits++;
          let toShield = Math.min(b.stackShields, Math.trunc(w.power / 2));
          let toArmor = w.power - toShield;
          b.stackShields -= toShield;
          if (w.capital && b.stackShields <= 0) toArmor *= 2;
          // a single torpedo hits one ship and kills one at most (help: no more ships destroyed than torpedoes that hit):
          // damage beyond the armour left on the most damaged ship is lost
          toArmor = Math.min(toArmor, Math.max(1, Math.ceil(weakest(b))));
          const k = applyArmor(b, toArmor, 1);
          e.shield += toShield; e.armor += toArmor; e.killed += k;
          if (toShield > 0) b.tookDamage = true;
        } else {
          misses++; e.misses++;
          const sd = Math.min(b.stackShields, Math.round(w.power / 8));
          b.stackShields -= sd; e.shield += sd;
          // 0.3.9.16: a miss that does no damage does not count as being challenged (Disengage if challenged)
          if (sd > 0) b.tookDamage = true;
        }
      }
      for (const [b, e] of per) {
        actions.push({ t: 'fire', id: a.rec.id, target: b.rec.id, weapon: w.part, torpedo: true, hits: e.hits, misses: e.misses, shieldDmg: e.shield, armorDmg: e.armor, killed: e.killed, fromX: a.x, fromY: a.y });
        if (e.killed) { record.losses[b.owner] = (record.losses[b.owner] ?? 0) + e.killed; credit(a, b, e.killed); }
      }
      void hits; void misses;
    }
  };

  const ROUNDS = 16;
  let round = 0;
  const retreated = new Set<Fleet>();
  const strength0 = new Map<Fleet, number>();
  for (const t of tokens) if (t.fleet) strength0.set(t.fleet, (strength0.get(t.fleet) ?? 0) + armorLeft(t));
  for (round = 1; round <= ROUNDS; round++) {
    const anyTargets = tokens.some(t => alive(t) && t.spec.weapons.some(w => targetsOf(t, w).length > 0));
    if (!anyTargets) break;
    actions.push({ t: 'round', round });
    // movement: phases 3,2,1 (tokens with that many moves this round), heaviest first; 0.3.9.16 (help, About the Battle
    // Board): each weight is varied at random by up to 15 % every round, so that ships of about the same weight take turns
    const weight = new Map(tokens.filter(alive).map(t => [t, t.mass * (0.85 + 0.3 * rng.random())]));
    const order = tokens.filter(alive).sort((a, b) => weight.get(b)! - weight.get(a)!);
    const movesThisRound = new Map<Token, number>();
    for (const t of order) {
      const tbl = MOVES[String(Math.max(2, Math.min(10, t.movement)))] ?? [1, 1, 1, 1];
      movesThisRound.set(t, t.movement > 0 ? tbl[(round - 1) % 4] : 0);
    }
    for (const phase of [3, 2, 1]) {
      for (const t of order) if ((movesThisRound.get(t) ?? 0) >= phase) moveToken(t);
    }
    // fire in initiative order
    const slots: Slot[] = [];
    for (const t of tokens) if (alive(t)) for (const w of t.spec.weapons) slots.push({ token: t, weapon: w, initiative: t.spec.initiative + w.initiative, rnd: t.prio });
    // 0.3.9.16 (Stars!): at equal initiative the shortest range fires first, then an order drawn for the whole battle
    slots.sort((p, q) => q.initiative - p.initiative || p.weapon.range - q.weapon.range || p.rnd - q.rnd);
    for (const s of slots) fire(s);
    // regenerating shields
    for (const t of tokens) {
      if (!alive(t)) continue;
      const regen = raceSpec(game.players[t.owner].race).shieldRegen;
      if (regen > 0 && t.stackShields > 0) t.stackShields = Math.min(t.shieldsPerShip * t.qty, t.stackShields + Math.round(t.shieldsPerShip * t.qty * regen));
    }
    for (const t of tokens) actions.push({ t: 'state', id: t.rec.id, qty: t.qty, shields: t.stackShields, damage: t.qty > 0 && t.qtyDamaged > 0 ? Math.floor(t.damage) : 0, qtyDamaged: t.qty > 0 ? t.qtyDamaged : 0 });
    // Constellations 3: retreat threshold (share of the fleet's armour lost)
    if (roles) for (const f of fleets) {
      const plan = planFor(game, f.owner, f.battlePlan);
      if (!plan.retreatAt || retreated.has(f)) continue;
      const mine = tokens.filter(t => t.fleet === f);
      const start = strength0.get(f) ?? 0;
      const now = mine.reduce((a, t) => a + armorLeft(t), 0);
      if (start > 0 && 1 - now / start >= plan.retreatAt / 100 && mine.some(alive)) {
        retreated.add(f);
        for (const t of mine) t.retreating = true;
      }
    }
  }
  record.rounds = actions.filter(a => a.t === 'round').length;

  // apply results
  const freighters = new Set(fleets.filter(f => f.tokens.length > 0 && f.tokens.every(t => { const sp = specOf(game, t.designId); return !sp.hasWeapons && sp.cargoCapacity > 0; })));
  const destroyedMinerals = { ironium: 0, boranium: 0, germanium: 0 };
  for (const t of tokens) {
    const lost = t.rec.qty - t.qty;
    if (lost > 0) {
      destroyedMinerals.ironium += t.spec.cost.ironium * lost; destroyedMinerals.boranium += t.spec.cost.boranium * lost; destroyedMinerals.germanium += t.spec.cost.germanium * lost;
      game.players[t.owner].stats.shipsLost += lost;
      for (const o of owners) if (o !== t.owner) game.players[o].stats.shipsDestroyed += 0;
    }
    if (t.fleet) {
      const tk = t.fleet.tokens.find(x => x.designId === t.designId)!;
      tk.qty = t.qty;
      // the damage is kept in whole points (rounded down, as in Stars!)
      const dmg = t.qty > 0 && t.qtyDamaged > 0 ? Math.floor(t.damage) : 0;
      tk.damage = dmg; tk.qtyDamaged = dmg > 0 ? t.qtyDamaged : 0;
    } else if (t.planet && t.planet.starbase) {
      if (t.qty <= 0) {
        const owner = game.players[t.planet.owner];
        t.planet.starbase = null;
        if (raceSpec(owner.race).livesOnStarbases) {
          owner.messages.push({ year: game.year, kind: 'battle', text: `La destruction de la station de ${t.planet.name} a tué toute sa population.`, target: { kind: 'planet', id: t.planet.id } });
          t.planet.pop = 0; t.planet.owner = -1; t.planet.queue = []; resetPlanetPolicies(t.planet);
        }
      } else t.planet.starbase.damage = t.qtyDamaged > 0 ? Math.floor(t.damage) : 0;
    }
  }
  // 0.3.9.16 (help, Salvage from Space Battles): the ships destroyed lose their share of the fleet's cargo (by hold) and
  // of its fuel: the minerals are dumped (on the planet in orbit, as salvage in space), their colonists die with them
  const dumped = { ironium: 0, boranium: 0, germanium: 0 };
  for (const f of fleets) {
    const mine = tokens.filter(t => t.fleet === f);
    const cap0 = mine.reduce((a, t) => a + t.spec.cargoCapacity * t.rec.qty, 0), cap1 = mine.reduce((a, t) => a + t.spec.cargoCapacity * t.qty, 0);
    if (cap0 > 0 && cap1 < cap0) {
      const share = (cap0 - cap1) / cap0;
      for (const m of MINERALS) {
        const lost = cap1 > 0 ? Math.ceil(f.cargo[m] * share - 1e-9) : f.cargo[m];
        dumped[m] += lost;
        if (cap1 > 0) f.cargo[m] -= lost;
      }
      if (cap1 > 0) f.cargo.colonists -= Math.ceil(f.cargo.colonists * share - 1e-9);
    }
    const fuel0 = mine.reduce((a, t) => a + t.spec.fuelCapacity * t.rec.qty, 0), fuel1 = mine.reduce((a, t) => a + t.spec.fuelCapacity * t.qty, 0);
    if (fuel0 > 0 && fuel1 > 0 && fuel1 < fuel0) f.fuel = Math.floor(f.fuel * fuel1 / fuel0);
  }
  for (const f of fleets) {
    f.tokens = f.tokens.filter(t => t.qty > 0);
    if (f.tokens.length) clampFleetHold(game, f);
  }
  // Constellations 3: convoys of the logistics network lost to raiders (any freighter counts for the raiders)
  // 0.3.9.21: the raiders are those that destroyed ships of that empire here, not every armed empire present
  const killersOf = (victim: number) => owners.filter(r => r !== victim && (killsBy[r]?.[victim] ?? 0) > 0);
  for (const f of fleets) {
    if (f.tokens.length || !freighters.has(f)) continue;
    if (f.auto !== 'logistics') {
      for (const r of killersOf(f.owner)) game.players[r].stats.convoysDestroyed = (game.players[r].stats.convoysDestroyed ?? 0) + 1;
      continue;
    }
    const o = game.players[f.owner];
    const st = o.logStats ?? (o.logStats = { colonists: 0, minerals: 0, lostColonists: 0, lostMinerals: 0, convoysLost: 0, trips: 0 });
    st.convoysLost++; st.lostColonists += f.cargo.colonists * 100; st.lostMinerals += f.cargo.ironium + f.cargo.boranium + f.cargo.germanium;
    const raiders = killersOf(f.owner);
    for (const r of raiders) game.players[r].stats.convoysDestroyed = (game.players[r].stats.convoysDestroyed ?? 0) + 1;
    const lostTxt = f.cargo.colonists ? `${people(game, f.cargo.colonists * 100)} colons perdus` : f.cargo.ironium + f.cargo.boranium + f.cargo.germanium ? `${f.cargo.ironium + f.cargo.boranium + f.cargo.germanium} kt de minerais perdus` : 'il voyageait à vide';
    o.messages.push({ year: game.year, kind: 'combat', text: `Convoi intercepté : ${f.name} a été détruit${raiders.length ? ` par les ${game.players[raiders[0]].name}` : ''} (${lostTxt}).`, target: { kind: 'battle', id: record.id } });
  }
  game.fleets = game.fleets.filter(f => f.tokens.length > 0);
  // Constellations 3: a fleet that reached its retreat threshold withdraws to the nearest friendly world
  for (const f of retreated) {
    if (!f.tokens.length) continue;
    const own = game.planets.filter(p => p.owner === f.owner);
    let dest: { x: number; y: number; id?: number } | null = null, best = Infinity;
    for (const p of own) { const d = distance(p, f); if (d > 1 && d < best) { best = d; dest = p; } }
    if (!dest && f.prevX !== undefined && f.prevY !== undefined && (f.prevX !== f.x || f.prevY !== f.y)) dest = { x: f.prevX, y: f.prevY };
    const o = game.players[f.owner];
    if (dest) {
      const sp = fleetSpec(game, f);
      const wps = [{ ...f.waypoints[0], x: f.x, y: f.y, task: 'none' as const, transport: undefined, processed: true }, { x: dest.x, y: dest.y, target: (dest.id !== undefined ? 'planet' : 'space') as 'planet' | 'space', targetId: dest.id, warp: sp.idealSpeed || 5, task: 'none' as const }];
      if (estimateRoute(game, f, wps).every(l => l.ok)) { f.waypoints = wps; f.repeat = false; }
    }
    o.messages.push({ year: game.year, kind: 'combat', text: `${f.name} a atteint son seuil de retraite et rompt le combat${dest ? ` : repli vers ${'name' in dest ? (dest as Planet).name : 'sa position précédente'}` : ''}.`, target: { kind: 'fleet', id: f.id } });
  }
  // salvage: a third of the minerals of the ships destroyed (Stars!), and the cargo they carried
  const salv = { ironium: Math.trunc(destroyedMinerals.ironium / 3) + dumped.ironium, boranium: Math.trunc(destroyedMinerals.boranium / 3) + dumped.boranium, germanium: Math.trunc(destroyedMinerals.germanium / 3) + dumped.germanium };
  // 3.4: a pirate raid destroyed also drops half of the loot it had sold on (its cargo is dumped like any other)
  for (const f of fleets) {
    if (f.tokens.length || f.raid?.kind !== 'pirates') continue;
    const extra = Math.trunc(Math.trunc(f.raid.loot / 3) * 0.5);
    salv.ironium += extra; salv.boranium += extra; salv.germanium += extra;
  }
  if (salv.ironium + salv.boranium + salv.germanium > 0) {
    const pl = game.planets.find(p => p.x === Math.round(x) && p.y === Math.round(y));
    if (pl) { pl.surface.ironium += salv.ironium; pl.surface.boranium += salv.boranium; pl.surface.germanium += salv.germanium; }
    else game.salvage.push({ id: game.nextId++, owner: -1, x, y, cargo: salv, age: 0 });
  }
  // knowledge & messages
  const where = planet ? planet.name : `l'espace profond (${Math.round(x)}, ${Math.round(y)})`;
  // 0.3.9: the crews that survived learn; the unarmed ones remember
  // 0.3.9.21: a fleet that neither fired nor was fired at (a bystander at peace with everyone) was not in the battle
  const engaged = new Set<number>();
  for (const a of actions) if (a.t === 'fire') { engaged.add(a.id); engaged.add(a.target); }
  if (vets) for (const f of fleets) {
    if (!f.tokens.length) continue;
    const mine = tokens.filter(t => t.fleet === f);
    if (!mine.some(t => engaged.has(t.rec.id))) continue;
    const lost = mine.reduce((a, t) => a + t.rec.qty - t.qty, 0);
    if (f.tokens.some(t => specOf(game, t.designId).hasWeapons)) battleExperience(game, f, killsOf.get(f) ?? 0, lost, where);
    else logFleet(game, f, lost ? `Prise dans la bataille de ${where} : ${lost} vaisseau${lost > 1 ? 'x' : ''} perdu${lost > 1 ? 's' : ''}.` : `Prise dans la bataille de ${where}, sans perte.`);
  }
  battleGrudges(game, killsBy);
  for (const o of owners) {
    const p = game.players[o];
    for (const other of owners) if (other !== o) meet(game, p, other, { target: planet ? { kind: 'planet', id: planet.id } : { kind: 'space', id: 0, x: Math.round(x), y: Math.round(y) }, how: `au combat, à ${where}` });
    for (const t of tokens) if (t.owner !== o) learnDesign(p, game, t.designId, true);
    const ours = tokens.filter(t => t.owner === o);
    const lostOurs = ours.reduce((a, t) => a + (t.rec.qty - t.qty), 0);
    // 0.3.9.21: the losses of those it fought, and the ships it destroyed itself (not an ally's losses, nor its kills)
    const foes = foughtWith(record, o);
    const lostTheirs = tokens.filter(t => foes.has(t.owner)).reduce((a, t) => a + (t.rec.qty - t.qty), 0);
    p.messages.push({ year: game.year, kind: 'battle', text: `Bataille à ${where} : ${lostOurs} de vos vaisseaux détruits, ${lostTheirs} vaisseaux adverses détruits.`, target: { kind: 'battle', id: record.id } });
    p.stats.shipsDestroyed += Object.values(killsBy[o] ?? {}).reduce((a, k) => a + k, 0);
  }
  return record;
}

export interface SimSide { design: ShipDesign; qty: number }
export interface SimResult { runs: number; winA: number; winB: number; draws: number; lostA: number; lostB: number; costLostA: number; costLostB: number; rounds: number; /** share of the station's armour destroyed, on average (1 = destroyed) */ stationDamage?: number }

/**
 * Combat simulator (designer): side A (the player's designs) against side B (any known or own design), on an
 * empty patch of space, `runs` times with different random draws. Uses the real battle engine on a throwaway state.
 */
export function simulateBattle(game: GameState, me: number, sideA: SimSide[], sideB: SimSide[], runs = 30, planB?: Partial<BattlePlan>, planA?: Partial<BattlePlan>, seed = 'sim', station?: { side: 0 | 1; design: ShipDesign }): SimResult {
  const res: SimResult = { runs, winA: 0, winB: 0, draws: 0, lostA: 0, lostB: 0, costLostA: 0, costLostB: 0, rounds: 0 };
  const src = game.players[me];
  const mk = (id: number, plan: Partial<BattlePlan> | undefined, tech: Player): Player => {
    const p: Player = JSON.parse(JSON.stringify({ ...tech, intel: { planets: [], fleets: [], tracks: {}, designs: {}, met: [], wormholes: {}, minefields: {}, packets: [], salvage: [], traders: [] }, messages: [], scores: [] }));
    p.id = id; p.relations = ['enemy', 'enemy']; p.relations[id] = 'friend'; p.ai = null; p.dead = false;
    p.battlePlans = [{ id: 0, name: 'Simulation', primary: 'armed', secondary: 'any', tactic: 'maximizeDamageRatio', attackWho: 'enemies', dumpCargo: false, ...(plan ?? {}) }];
    return p;
  };
  // both sides use our technology levels (we do not know the rival's): "at equal technology"
  const pa = mk(0, planA, src), pb = mk(1, planB, src);
  const rng = new Rng(seedFromString(seed));
  for (let r = 0; r < runs; r++) {
    let nextId = 1;
    const designs: ShipDesign[] = [];
    const fleetOf = (owner: number, side: SimSide[]): Fleet => ({
      id: 9_000_000 + owner, owner, num: owner + 1, name: owner ? 'Adversaire' : 'Vos vaisseaux', x: 0, y: 0, orbiting: -1,
      tokens: side.filter(s => s.qty > 0).map(s => { const d = { ...JSON.parse(JSON.stringify(s.design)), id: nextId++, owner }; designs.push(d); return { designId: d.id, qty: s.qty, damage: 0, qtyDamaged: 0 }; }),
      cargo: { ironium: 0, boranium: 0, germanium: 0, colonists: 0 }, fuel: 0, waypoints: [{ x: 0, y: 0, target: 'space', warp: 0, task: 'none' }],
      repeat: false, battlePlan: 0, heading: null, lastWarp: 0, age: 0,
    });
    const fa = fleetOf(0, sideA), fb = fleetOf(1, sideB);
    // 3.3.6: a station (yours or theirs) fights from the orbit of a world; it does not move and has its hull's range bonus
    let planet: Planet | null = null, stationCost = 0;
    if (station) {
      const d: ShipDesign = { ...JSON.parse(JSON.stringify(station.design)), id: nextId++, owner: station.side, starbase: true };
      designs.push(d);
      planet = { ...JSON.parse(JSON.stringify(game.planets[0])), id: 0, name: 'la station', owner: station.side, x: 0, y: 0, starbase: { designId: d.id, damage: 0 }, pop: 0, queue: [], defenses: 0, megaprojects: [] } as Planet;
    }
    const g: GameState = {
      // (0.3.9.21: a chronicle and secrets of its own: the real game's chronicle got a "first contact" per run, and a
      // pulsar near the origin halved the shields of the simulation)
      ...game, settings: { ...game.settings, terrain: false }, terrain: [], year: game.year, diplomacy: undefined, crisis: undefined, pirates: undefined, chronicle: undefined, secrets: undefined, guardians: [], nemeses: [], players: [JSON.parse(JSON.stringify(pa)), JSON.parse(JSON.stringify(pb))],
      fleets: [fa, fb].filter(f => f.tokens.length), designs, planets: planet ? [planet] : [], battles: [], salvage: [], nextId: 10_000_000,
    };
    if (planet) stationCost = specOf(g, planet.starbase!.designId).cost.resources;
    const before = (f: Fleet) => f.tokens.map(t => ({ id: t.designId, qty: t.qty }));
    const a0 = before(fa), b0 = before(fb);
    const rec = fight(g, rng, g.fleets, planet, 0, 0);
    const stationLost = !!planet && !planet.starbase;
    if (planet) res.stationDamage = (res.stationDamage ?? 0) + (stationLost ? 1 : Math.min(1, planet.starbase!.damage / Math.max(1, specOf(g, planet.starbase!.designId).armor)));
    const left = (f: Fleet, start: { id: number; qty: number }[]) => start.map(s => ({ s, now: f.tokens.find(t => t.designId === s.id)?.qty ?? 0 }));
    const la = left(fa, a0), lb = left(fb, b0);
    const lost = (l: typeof la) => l.reduce((a, x) => a + x.s.qty - x.now, 0);
    const costLost = (l: typeof la) => l.reduce((a, x) => a + (x.s.qty - x.now) * specOf(g, x.s.id).cost.resources, 0);
    res.lostA += lost(la) + (stationLost && station!.side === 0 ? 1 : 0); res.lostB += lost(lb) + (stationLost && station!.side === 1 ? 1 : 0);
    res.costLostA += costLost(la) + (stationLost && station!.side === 0 ? stationCost : 0); res.costLostB += costLost(lb) + (stationLost && station!.side === 1 ? stationCost : 0);
    res.rounds += rec?.rounds ?? 0;
    // a standing station counts as a ship of its side
    const sA = !!planet && station!.side === 0 && !stationLost, sB = !!planet && station!.side === 1 && !stationLost;
    const armedLeft = (f: Fleet, st: boolean) => f.tokens.some(t => t.qty > 0 && specOf(g, t.designId).hasWeapons) || (st && specOf(g, planet!.starbase!.designId).hasWeapons);
    const anyLeft = (f: Fleet, st: boolean) => f.tokens.some(t => t.qty > 0) || st;
    const wipedA = !anyLeft(fa, sA), wipedB = !anyLeft(fb, sB);
    const aliveA = armedLeft(fa, sA) || (!wipedA && wipedB);
    const aliveB = armedLeft(fb, sB) || (!wipedB && wipedA);
    if (wipedB && !wipedA) res.winA++;
    else if (wipedA && !wipedB) res.winB++;
    else if (aliveA && !aliveB) res.winA++;
    else if (aliveB && !aliveA) res.winB++;
    else res.draws++;
  }
  res.lostA /= runs; res.lostB /= runs; res.costLostA /= runs; res.costLostB /= runs; res.rounds /= runs;
  if (res.stationDamage !== undefined) res.stationDamage /= runs;
  return res;
}
