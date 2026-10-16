// Scanning & intelligence: what each player knows about planets, fleets, minefields, wormholes...
import type { Fleet, FleetIntel, GameState, MessageTarget, Planet, Player } from './types';
import { hailingWorld } from './trader';
import { fleetSpec } from './fleet';
import { planetSpec } from './planet';
import { raceSpec } from './race';
import { designSpec, specOf } from './design';
import { scanFactorAt } from './terrain';
import { hasWalls, routePoints } from './walls';
import { addChronicle } from './chronicle';

interface Scanner { x: number; y: number; range: number; pen: number; tachyons: number; fleetId?: number; planetId?: number }

export function scannersOf(game: GameState, player: Player): Scanner[] {
  const res: Scanner[] = [];
  for (const p of game.planets) {
    if (p.owner !== player.id) continue;
    const s = planetSpec(game, p, player);
    let range = Math.max(0, s.scanRange), pen = s.scanRangePen;
    let tach = 0;
    if (p.starbase) {
      const sb = specOf(game, p.starbase.designId);
      range = Math.max(range, sb.scanRange); pen = Math.max(pen, sb.scanRangePen); tach = sb.tachyons;
    }
    // a scanner inside a nebula sees half as far
    const k = scanFactorAt(game, p);
    res.push({ x: p.x, y: p.y, range: range * k, pen: pen > 0 ? pen * k : pen, tachyons: tach, planetId: p.id });
  }
  for (const f of game.fleets) {
    if (f.owner !== player.id) continue;
    const s = fleetSpec(game, f);
    const k = scanFactorAt(game, f);
    res.push({ x: f.x, y: f.y, range: Math.max(0, s.scanRange) * k, pen: s.scanRangePen > 0 ? s.scanRangePen * k : s.scanRangePen, tachyons: s.tachyons, fleetId: f.id });
  }
  const rs = raceSpec(player.race);
  if (rs.minefieldsAreScanners) for (const m of game.minefields) if (m.owner === player.id) res.push({ x: m.x, y: m.y, range: Math.sqrt(m.mines), pen: -1, tachyons: 0 });
  if (rs.packetScanner) for (const k of game.packets) if (k.owner === player.id) res.push({ x: k.x, y: k.y, range: 0, pen: k.warp * k.warp, tachyons: 0 });
  return res;
}

const d2 = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

type Pt = { x: number; y: number };
function segDist2(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2;
}
/** Is a planet within penetrating range of the path flown this year? (Analysing a planet without such a scanner needs orbit.) */
export function sweptBy(trail: Pt[], pen: number, p: Pt): boolean {
  if (pen <= 0) return false;
  for (let k = 1; k < trail.length; k++) if (segDist2(p, trail[k - 1], trail[k]) <= pen * pen) return true;
  return false;
}

function cloakFactor(cloak: number, tachyons: number): number {
  const red = tachyons > 0 ? Math.max(0.19, Math.pow(0.95, Math.sqrt(tachyons))) : 1;
  return 1 - (cloak / 100) * red;
}

export function revealPlanet(game: GameState, player: Player, planet: Planet, fullOwnerInfo = true) {
  const intel = player.intel.planets[planet.id];
  const wasOwner = intel.owner;
  intel.year = game.year;
  intel.owner = planet.owner;
  intel.hab = [...planet.hab];
  intel.baseHab = [...planet.baseHab];
  intel.conc = { ...planet.conc };
  intel.surface = { ...planet.surface };
  intel.explored = true;
  intel.homeworld = planet.homeworld && planet.owner >= 0;
  // Constellations 3.2: a guardian in orbit is part of what an analysis reveals
  const guard = game.monsterId !== undefined ? game.fleets.find(f => f.owner === game.monsterId && f.orbiting === planet.id) : undefined;
  if (guard) { intel.guardian = guard.purpose?.slice(9); intel.guardianYear = game.year; } else intel.guardian = undefined;
  // Constellations 3.4: a pirate lair (or the Breach of the crisis)
  const lair = game.fleets.find(f => f.immobile && f.orbiting === planet.id && f.tokens.length > 0 && game.players[f.owner]?.faction);
  intel.lair = lair ? game.players[lair.owner].faction : undefined;
  if (planet.owner >= 0) {
    intel.pop = planet.owner === player.id ? planet.pop : Math.round(planet.pop / 1000) * 1000;
    intel.defenses = fullOwnerInfo ? planet.defenses : undefined;
    if (planet.starbase) {
      const d = game.designs.find(x => x.id === planet.starbase!.designId);
      intel.starbaseDesign = d?.id; intel.starbaseName = d?.name;
      if (d && planet.owner !== player.id) learnDesign(player, game, d.id, false);
    } else { intel.starbaseDesign = undefined; intel.starbaseName = undefined; }
  } else { intel.pop = 0; intel.defenses = 0; intel.starbaseDesign = undefined; intel.starbaseName = undefined; }
  if (planet.owner >= 0 && planet.owner !== player.id) {
    meet(game, player, planet.owner, { target: { kind: 'planet', id: planet.id }, how: `qui occupent ${planet.name}` });
    if (wasOwner !== planet.owner) {
      const owner = game.players[planet.owner];
      const who = owner.race.pluralName === owner.name ? `des ${owner.name}` : `de l'empire ${owner.name}`;
      // 3.6: a colony founded (or taken) where we were watching says so, louder near our worlds
      const near = game.planets.some(o => o.owner === player.id && Math.hypot(o.x - planet.x, o.y - planet.y) <= 150);
      if (wasOwner === -1) player.messages.push({ year: game.year, kind: near ? 'warning' : 'scan', text: `Nouvelle colonie ${who} sur ${planet.name}, sous vos scanners${near ? ', non loin de vos mondes' : ''}.`, target: { kind: 'planet', id: planet.id } });
      else if (wasOwner !== undefined && wasOwner >= 0 && wasOwner !== player.id) player.messages.push({ year: game.year, kind: near ? 'warning' : 'scan', text: `${planet.name} a changé de mains : c'est désormais une colonie ${who} (elle appartenait aux ${game.players[wasOwner]?.name ?? '?'}).`, target: { kind: 'planet', id: planet.id } });
      else if (wasOwner === undefined) player.messages.push({ year: game.year, kind: 'scan', text: `Vos capteurs ont découvert une colonie ${who} sur ${planet.name}.`, target: { kind: 'planet', id: planet.id } });
    }
  }
}

export function learnDesign(player: Player, game: GameState, designId: number, full: boolean) {
  const d = game.designs.find(x => x.id === designId);
  if (!d || d.owner === player.id) return;
  const known = player.intel.designs[designId];
  player.intel.designs[designId] = { id: d.id, owner: d.owner, name: d.name, hull: d.hull, starbase: d.starbase, slots: full || raceSpec(player.race).discoverDesignOnScan ? d.slots.map(s => ({ ...s })) : known?.slots };
}

/** First contact with another empire; `where` says how and where (the report leads there). */
export function meet(game: GameState, player: Player, other: number, where?: { target: MessageTarget; how: string }) {
  if (other === player.id || other < 0 || game.players[other]?.monster) return;
  if (player.intel.met.includes(other)) return;
  player.intel.met.push(other);
  const o = game.players[other];
  // 0.3.9: the first contact between two empires, once (whoever meets the other first)
  if (game.year > 2400 && !o.intel.met.includes(player.id)) addChronicle(game, 'contact', `Premier contact entre les ${player.name} et les ${o.name}.`, [player.id, other]);
  player.messages.push({ year: game.year, kind: 'diplomacy', text: `Premier contact : vous avez rencontré les ${o.name}${o.race.pluralName !== o.name ? ` (${o.race.pluralName})` : ''}${where ? `, ${where.how}` : ''}.${game.settings.diplomacy && game.diplomacy ? ` Vous êtes ${game.diplomacy.pairs[player.id < other ? `${player.id}-${other}` : `${other}-${player.id}`]?.status === 'war' ? 'en guerre' : 'en paix'} avec eux (page Diplomatie).` : ''}`, target: where?.target ?? { kind: 'player', id: other } });
}

/** Recompute every player's knowledge for the current year. */
export function updateIntel(game: GameState, initial = false) {
  for (const player of game.players) {
    if (player.dead) continue;
    const intel = player.intel;
    const scanners = scannersOf(game, player);
    // paths flown this year: penetrating scanners sweep them
    const sweeps = game.fleets.filter(f => f.owner === player.id && f.trail && f.trail.length > 1).map(f => ({ trail: f.trail!, pen: fleetSpec(game, f).scanRangePen }));
    // 0.3.7: the hidden cluster lies far beyond the edge of the map: nothing is seen across the void
    const far = !!game.secrets?.some(s => s.box);
    const apart = (a: { x: number }, b: { x: number }) => far && (a.x > game.width) !== (b.x > game.width);
    // planets
    for (const p of game.planets) {
      if (p.owner === player.id) { revealPlanet(game, player, p); continue; }
      // 0.3.7: a hidden star nobody told this empire about: found only by the ways of secrets.ts
      if (intel.planets[p.id]?.unknown) continue;
      let seen = false;
      // a planet inside a nebula can only be analysed from half the distance
      const tf = scanFactorAt(game, p);
      for (const s of scanners) {
        if (apart(s, p)) continue;
        const dd = d2(s, p);
        if ((s.pen >= 0 && dd <= (s.pen * tf) ** 2) || dd === 0) { seen = true; break; }
      }
      if (!seen) for (const sw of sweeps) if (sweptBy(sw.trail, sw.pen * tf, p)) { seen = true; break; }
      if (!seen && raceSpec(player.race).detectStargatePlanets) {
        // IT: own stargates scan other stargate planets within range (approximation)
      }
      if (seen) revealPlanet(game, player, p);
      else if (initial) { /* unknown */ }
    }
    // fleets
    const fleets: FleetIntel[] = [];
    // fog of war: contacts followed without a break since last year keep their last identification
    const followed = new Set(intel.fleets.map(x => x.id));
    const idents = intel.idents ?? (intel.idents = {});
    for (const f of game.fleets) {
      if (f.owner === player.id) continue;
      // 0.3.8.8: what orbits a hidden star this empire has not found stays hidden with it (a guardian's huge
      // signature gave away the veiled star, in the heart of its cloud, to any scanner in range)
      if (f.orbiting >= 0 && intel.planets[f.orbiting]?.unknown) continue;
      const fs = fleetSpec(game, f);
      let normal = false, pen = false, same = false;
      const tf = scanFactorAt(game, f);
      for (const s of scanners) {
        if (apart(s, f)) continue;
        const dd = d2(s, f);
        if (dd === 0) { same = true; pen = true; break; }
        const cf = cloakFactor(fs.cloakPercent, s.tachyons) * tf;
        if (s.pen >= 0 && dd <= (s.pen * cf) ** 2) pen = true;
        if (f.orbiting < 0 && dd <= (s.range * cf) ** 2) normal = true;
        if (f.orbiting >= 0 && game.planets[f.orbiting].owner === player.id && dd === 0) pen = true;
      }
      const friend = player.relations[f.owner] === 'friend' && game.players[f.owner].relations[player.id] === 'friend';
      // Constellations 3.2: a guardian has an enormous signature: any scanner in range sees it, even in orbit
      const guardian = game.monsterId !== undefined && f.owner === game.monsterId;
      // 3.4: so do a pirate lair and the Nexus
      const huge = guardian || (!!f.immobile && !!game.players[f.owner]?.faction);
      if (huge && !pen) for (const s of scanners) if (!apart(s, f) && d2(s, f) <= (s.range * tf) ** 2) { pen = true; break; }
      if (!normal && !pen && !friend) continue;
      if (guardian && f.orbiting >= 0) { const pi = intel.planets[f.orbiting]; if (!pi.unknown) { pi.guardian = f.purpose?.slice(9); pi.guardianYear = game.year; } }
      else if (huge && f.orbiting >= 0 && !intel.planets[f.orbiting].unknown) intel.planets[f.orbiting].lair = game.players[f.owner].faction;
      const deception = !!game.settings.deception;
      const exact = pen || same || friend;
      const full = exact || (!game.settings.anonymousContacts && !deception);
      const fi: FleetIntel = { id: f.id, owner: full ? f.owner : -1, x: f.x, y: f.y, detail: full ? 'full' : 'contact', orbiting: f.orbiting >= 0 && !intel.planets[f.orbiting]?.unknown ? f.orbiting : undefined };
      const ident = idents[f.id];
      if (full) {
        fi.name = f.name; fi.heading = f.heading; fi.warp = f.lastWarp; fi.mass = fs.mass; fi.count = fs.ships;
        fi.tokens = f.tokens.map(t => ({ designId: t.designId, qty: t.qty }));
        meet(game, player, f.owner, { target: { kind: 'fleet', id: f.id, x: Math.round(f.x), y: Math.round(f.y) }, how: fi.orbiting !== undefined ? `dont la flotte ${f.name} est en orbite de ${game.planets[f.orbiting].name}` : `dont la flotte ${f.name} croise en (${Math.round(f.x)}, ${Math.round(f.y)})` });
        for (const t of f.tokens) learnDesign(player, game, t.designId, false);
        if (exact) idents[f.id] = { owner: f.owner, name: f.name, tokens: fi.tokens.map(t => ({ ...t })), mass: fs.mass, count: fs.ships, year: game.year };
      } else if (ident && followed.has(f.id)) {
        // the echo is followed: what was seen at the last identification still stands, dated
        fi.owner = ident.owner; fi.detail = 'full'; fi.name = ident.name; fi.mass = ident.mass; fi.count = ident.count;
        fi.tokens = ident.tokens.map(t => ({ ...t })); fi.identYear = ident.year;
      } else if (deception) {
        // Constellations 3: an ordinary scanner only gets an estimate (±30 %), fooled by decoys
        const a = noise(game.settings.seed, f.id, player.id, game.year, 1), b = noise(game.settings.seed, f.id, player.id, game.year, 2);
        fi.mass = Math.max(1, Math.round((fs.mass + fs.decoyMass) * (0.7 + 0.6 * a)));
        fi.count = Math.max(1, Math.round((fs.ships + fs.decoys) * (0.7 + 0.6 * b)));
        fi.uncertain = true;
        if (!game.settings.anonymousContacts) { fi.owner = f.owner; meet(game, player, f.owner, { target: { kind: 'fleet', id: f.id, x: Math.round(f.x), y: Math.round(f.y) }, how: fi.orbiting !== undefined ? `dont une flotte est en orbite de ${game.planets[f.orbiting].name}` : `dont une flotte croise en (${Math.round(f.x)}, ${Math.round(f.y)})` }); }
      }
      fleets.push(fi);
      if (!player.ai) { // trajectories are only drawn for humans
        const tr = intel.tracks[f.id] ?? (intel.tracks[f.id] = []);
        if (!tr.length || tr[tr.length - 1].year !== game.year) tr.push({ year: game.year, x: f.x, y: f.y });
        if (tr.length > 8) tr.splice(0, tr.length - 8);
      }
    }
    intel.fleets = fleets;
    // a contact lost even for one year is a new, unknown one when it comes back
    for (const k of Object.keys(idents)) if (!fleets.some(x => x.id === +k)) delete idents[+k];
    // forget tracks of fleets not seen for 3 years
    for (const k of Object.keys(intel.tracks)) {
      const tr = intel.tracks[+k];
      if (!tr.length || game.year - tr[tr.length - 1].year > 3) delete intel.tracks[+k];
    }
    // wormholes (75% cloaked until known)
    for (const w of game.wormholes) {
      const known = intel.wormholes[w.id];
      for (const s of scanners) {
        if (apart(s, w)) continue;
        const r = known ? s.range : s.range * 0.25;
        if (d2(s, w) <= r * r || (s.pen >= 0 && d2(s, w) <= s.pen * s.pen)) {
          if (!known) player.messages.push({ year: game.year, kind: 'wormhole', text: `Un trou de ver a été détecté en (${Math.round(w.x)}, ${Math.round(w.y)}). Sa sortie reste inconnue tant qu'aucun vaisseau ne l'a franchi.`, target: { kind: 'wormhole', id: w.id } });
          intel.wormholes[w.id] = { id: w.id, x: w.x, y: w.y, year: game.year, destId: known?.destId, stability: w.stability };
          break;
        }
      }
    }
    // minefields
    for (const m of game.minefields) {
      const radius = Math.sqrt(m.mines);
      if (m.owner === player.id) { intel.minefields[m.id] = { id: m.id, owner: m.owner, x: m.x, y: m.y, mines: m.mines, type: m.type, year: game.year }; continue; }
      const known = intel.minefields[m.id];
      for (const s of scanners) {
        const r = known ? s.range : s.range * 0.25;
        const dist = Math.sqrt(d2(s, m)) - radius;
        if (dist <= r || (s.pen >= 0 && dist <= s.pen)) {
          intel.minefields[m.id] = { id: m.id, owner: m.owner, x: m.x, y: m.y, mines: m.mines, type: m.type, year: game.year };
          meet(game, player, m.owner, { target: { kind: 'minefield', id: m.id, x: Math.round(m.x), y: Math.round(m.y) }, how: `dont vos capteurs ont repéré un champ de mines en (${Math.round(m.x)}, ${Math.round(m.y)})` });
          break;
        }
      }
    }
    for (const k of Object.keys(intel.minefields)) if (!game.minefields.some(m => m.id === +k)) delete intel.minefields[+k];
    // packets, salvage, traders
    intel.packets = game.packets.filter(k => k.owner === player.id || raceSpec(player.race).packetScanner || scanners.some(s => d2(s, k) <= s.range * s.range)).map(k => ({ id: k.id, owner: k.owner, x: k.x, y: k.y, targetId: k.targetId, warp: k.warp, mass: k.cargo.ironium + k.cargo.boranium + k.cargo.germanium }));
    intel.salvage = game.salvage.filter(k => k.owner === player.id || scanners.some(s => d2(s, k) <= s.range * s.range)).map(k => ({ id: k.id, x: k.x, y: k.y, mass: k.cargo.ironium + k.cargo.boranium + k.cargo.germanium }));
    // seen by scanners, or broadcasting its position near your worlds (3.3.8)
    intel.traders = game.traders.filter(t => scanners.some(s => d2(s, t) <= s.range * s.range) || hailingWorld(game, player.id, t) !== null).map(t => ({ id: t.id, x: t.x, y: t.y, warp: t.warp, heading: t.heading ? { ...t.heading } : undefined }));
  }
}

/** Estimated future positions of a foreign fleet from its last two observations (no access to its orders). */
export function estimateTrajectory(player: Player, fleetId: number, years = 3): { from: { x: number; y: number }[]; ahead: { x: number; y: number }[] } | null {
  const tr = player.intel.tracks[fleetId];
  if (!tr || tr.length < 2) return null;
  const a = tr[tr.length - 2], b = tr[tr.length - 1];
  const dy = b.year - a.year || 1;
  const vx = (b.x - a.x) / dy, vy = (b.y - a.y) / dy;
  if (Math.abs(vx) + Math.abs(vy) < 0.01) return null;
  const ahead = [];
  for (let i = 1; i <= years; i++) ahead.push({ x: b.x + vx * i, y: b.y + vy * i });
  const from = tr.map(o => ({ x: o.x, y: o.y }));
  return { from, ahead };
}

/**
 * 0.3.8.3: the speed of a foreign fleet, from the distance between its last two observations (a fleet covers
 * warp² ly a year). A fleet that stopped, turned or crossed slowing terrain on the way looks slower; one that took a
 * stargate or a wormhole looks far faster than any engine (`jump`).
 */
export function estimateSpeed(player: Player, fleetId: number): { ly: number; warp: number; exact: boolean; from: number; to: number; jump: boolean } | null {
  const tr = player.intel.tracks[fleetId];
  if (!tr || tr.length < 2) return null;
  const a = tr[tr.length - 2], b = tr[tr.length - 1];
  const years = Math.max(1, b.year - a.year);
  const ly = Math.hypot(b.x - a.x, b.y - a.y) / years;
  if (ly < 0.5) return { ly: 0, warp: 0, exact: true, from: a.year, to: b.year, jump: false };
  // the slowest warp that covers that distance (positions are rounded at the end of each year: some slack)
  const warp = Math.min(10, Math.max(1, Math.ceil(Math.sqrt(Math.max(0, ly - 1.5)))));
  return { ly, warp, exact: Math.abs(ly - warp * warp) <= 1.5, from: a.year, to: b.year, jump: ly > 101 };
}

/**
 * 0.3.8.4: the worlds on a foreign fleet's course, if it keeps its heading and its speed. A fleet flies straight to
 * its waypoint, or around the dark clouds by the shortest way: a world is on its course when the way from its
 * previous position to that world runs through where it is now (2.5 ly of slack: positions are rounded each year).
 * Nearest first (by the way left), within `maxYears`. `exact` is false when the speed is only a lower bound: it may
 * arrive sooner. Unknown lanes of its empire are not used (they are not ours to know).
 */
export function estimateCourse(game: GameState, player: Player, fleetId: number, maxYears = 15): { planet: Planet; years: number; exact: boolean }[] {
  const tr = player.intel.tracks[fleetId];
  const sp = estimateSpeed(player, fleetId);
  if (!tr || tr.length < 2 || !sp || sp.warp === 0 || sp.jump) return [];
  const a = tr[tr.length - 2], b = tr[tr.length - 1];
  const moved = Math.hypot(b.x - a.x, b.y - a.y);
  const walls = hasWalls(game);
  const out: { planet: Planet; years: number; exact: boolean; left: number }[] = [];
  for (const p of game.planets) {
    const direct = Math.hypot(p.x - b.x, p.y - b.y);
    if (direct < 0.5 || direct > sp.ly * maxYears) continue;
    const via = walls ? routePoints(game, a, p) : [];
    if (via === null) continue;
    const pts = [a, ...via, p];
    // where it is now, on that way
    let off = Infinity, at = 0, acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const u = pts[i - 1], v = pts[i];
      const L = Math.hypot(v.x - u.x, v.y - u.y);
      const t = L > 0 ? Math.max(0, Math.min(1, ((b.x - u.x) * (v.x - u.x) + (b.y - u.y) * (v.y - u.y)) / (L * L))) : 0;
      const d = Math.hypot(u.x + (v.x - u.x) * t - b.x, u.y + (v.y - u.y) * t - b.y);
      if (d < off) { off = d; at = acc + t * L; }
      acc += L;
    }
    const left = acc - at;
    if (off > 2.5 || at < moved * 0.5 || left < 0.5 || left > sp.ly * maxYears) continue;
    out.push({ planet: p, years: Math.max(1, Math.ceil(left / sp.ly - 1e-9)), exact: sp.exact, left });
  }
  return out.sort((x, y) => x.left - y.left).map(({ planet, years, exact }) => ({ planet, years, exact }));
}

export function fleetVisibleTo(player: Player, f: Fleet): boolean {
  return f.owner === player.id || player.intel.fleets.some(x => x.id === f.id);
}

export { designSpec };

/** Deterministic noise in [0, 1) for an observation (same answer for the whole year). */
function noise(seed: string, fleet: number, observer: number, year: number, k: number): number {
  let h = 2166136261 ^ k;
  const str = `${seed}|${fleet}|${observer}|${year}|${k}`;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 15; h = Math.imul(h, 2246822507); h ^= h >>> 13;
  return ((h >>> 0) % 100000) / 100000;
}
