// Pirates (Constellations 3.4). Some fifteen years into the game, bands of pirates settle in lairs far from the
// homeworlds. Every few years a lair launches a raid on a rich, poorly defended colony within reach: the raiders
// take minerals, wreck some mines and factories, and go home with the loot. Empires can pay them (anonymously) to
// aim at a rival: a bounty. Destroying a lair yields research and the band's treasure; with every lair gone the
// pirates are finished.
import { people } from './words';
import type { Fleet, GameState, Planet, Player, PirateLair } from './types';
import { MINERALS, FIELDS } from './types';
import { Rng, seedFromString } from './rng';
import { distance, fleetSpec } from './fleet';
import { planetSpec } from './planet';
import { specOf } from './design';
import { guardianAt } from './guardians';
import { navyOf } from './guardians';
import { shareOf } from './words';
import { researchCost } from './research';
import { researchStory } from './tales';
import { giveRelic, missingRelic, RELICS } from './relics';
import { ensureFaction, factionDesign, galaxyTech, spawnFleet, sendTo, damageShare, empires, fleetStrength, raidOrder } from './factions';

export const piratesOn = (game: GameState) => !!game.settings.pirates;
/** Resources of one unit of bounty (a production item). */
export const BOUNTY_UNIT = 100;
/** Lairs by size of galaxy. */
const LAIRS: Record<string, number> = { Tiny: 1, Small: 1, Medium: 2, Large: 2, Huge: 3 };
/** The bands (with their article). */
const BANDS = ['les Écorcheurs', 'la Confrérie du Vide', 'les Chacals de la Dérive', 'la Flotte Noire', 'les Frères de la Ceinture', 'les Charognards'];
/** Garrison of a lair: ships at the start, ships at most. */
const GARRISON_START = 3, GARRISON_MAX = 9;
/** Cost (in treasure) of a ship added to a garrison, of an extra raider. */
const SHIP_COST = 250, RAIDER_COST = 500;

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
/** "des Écorcheurs", "de la Flotte Noire". */
export const deBand = (band: string) => band.startsWith('les ') ? `des ${band.slice(4)}` : `de ${band}`;
const rngOf = (game: GameState, tag: string) => new Rng(seedFromString(`${game.settings.seed}|pirates|${tag}|${game.year}`));
export const pirateOwner = (game: GameState): Player | undefined => game.pirates && game.pirates.id >= 0 ? game.players[game.pirates.id] : undefined;
export const isPirate = (game: GameState, owner: number) => game.players[owner]?.faction === 'pirates';
/** The lairs still standing. */
export const liveLairs = (game: GameState) => (game.pirates?.lairs ?? []).filter(l => l.alive);
export const lairAt = (game: GameState, planetId: number): PirateLair | undefined => liveLairs(game).find(l => l.planetId === planetId);
export const lairFleet = (game: GameState, l: PirateLair): Fleet | undefined => game.fleets.find(f => f.id === l.fleetId);
/** The pirates are out there and not finished. */
export const piratesActive = (game: GameState) => piratesOn(game) && !!game.pirates?.emerged && !game.pirates.ended;

/** Prepares the pirates (they appear between 2412 and 2418, or three years after the rule is switched on). */
export function initPirates(game: GameState) {
  if (game.pirates) return;
  const rng = new Rng(seedFromString(game.settings.seed + '|pirates'));
  game.pirates = { id: -1, emergeYear: Math.max(game.year + 3, 2412 + rng.int(7)), emerged: false, lairs: [], bounty: {}, treasure: 0, nextRaid: 0, raids: 0 };
}

/** Rule switched off: the pirates vanish (their bounties with them). */
export function removePirates(game: GameState) {
  game.fleets = game.fleets.filter(f => !isPirate(game, f.owner));
  for (const p of game.players) {
    for (const pi of p.intel.planets) if (pi.lair === 'pirates') pi.lair = undefined;
    p.intel.fleets = p.intel.fleets.filter(fi => !isPirate(game, fi.owner));
    for (const pl of game.planets) if (pl.owner === p.id) pl.queue = pl.queue.filter(q => q.kind !== 'bounty');
  }
  game.pirates = undefined;
}

// ---------------------------------------------------------------------------------------------------- designs

/** Ships of the pirates: armed freighters (they carry their loot), warships for the lairs. */
function raiderDesign(game: GameState, owner: Player, tech: number) {
  for (const hull of tech >= 11 ? ['Galleon', 'Privateer', 'Destroyer'] : tech >= 4 ? ['Privateer', 'Destroyer'] : ['Destroyer', 'Frigate']) {
    const d = factionDesign(game, owner, tech, hull, 'beamWarship', hull === 'Galleon' ? 'Galion pirate' : hull === 'Privateer' ? 'Corsaire' : 'Écumeur');
    if (d) return d;
  }
  return null;
}
function garrisonDesign(game: GameState, owner: Player, tech: number) {
  for (const hull of tech >= 13 ? ['Battleship', 'Cruiser', 'Destroyer'] : tech >= 9 ? ['Cruiser', 'Destroyer'] : ['Destroyer', 'Frigate']) {
    const d = factionDesign(game, owner, tech, hull, 'beamWarship', hull === 'Battleship' ? 'Forteresse pirate' : hull === 'Cruiser' ? 'Garde du repaire' : 'Sentinelle pirate');
    if (d) return d;
  }
  return null;
}
const shipsOf = (f: Fleet) => f.tokens.reduce((a, t) => a + t.qty, 0);

// ---------------------------------------------------------------------------------------------------- emergence

function emerge(game: GameState) {
  const P = game.pirates!;
  const rng = rngOf(game, 'emerge');
  const owner = ensureFaction(game, 'pirates');
  P.id = owner.id; P.emerged = true;
  const W = game.width;
  const owned = game.planets.filter(pl => pl.owner >= 0 && !game.players[pl.owner].monster);
  const homeDist = (pl: Planet) => owned.length ? Math.min(...owned.map(o => distance(o, pl))) : W;
  const n = LAIRS[game.settings.size] ?? 1;
  const bands = rng.shuffle([...BANDS]);
  const tech = Math.round(galaxyTech(game) + 2);
  const gd = garrisonDesign(game, owner, tech);
  if (!gd) { P.ended = true; return; }
  const taken: Planet[] = [];
  for (let i = 0; i < n; i++) {
    const cands = game.planets.filter(pl => pl.owner < 0 && !pl.hidden && !guardianAt(game, pl.id) && !taken.includes(pl) && taken.every(t => distance(t, pl) >= W * 0.3))
      .map(pl => ({ pl, d: homeDist(pl) * (0.85 + 0.3 * rng.random()) })).sort((a, b) => b.d - a.d);
    if (!cands.length) break;
    // among the most remote worlds, not always the very farthest
    const pick = cands[Math.min(cands.length - 1, rng.int(Math.min(4, cands.length)))].pl;
    taken.push(pick);
    const band = bands[i % bands.length];
    const f = spawnFleet(game, owner, [{ designId: gd.id, qty: GARRISON_START }], pick, `Repaire ${deBand(band)}`, { immobile: true, purpose: 'lair' });
    P.lairs.push({ planetId: pick.id, name: band, fleetId: f.id, alive: true });
  }
  if (!P.lairs.length) { P.ended = true; return; }
  P.nextRaid = game.year + 3 + rng.int(3);
  P.treasure = 300;
  const where = P.lairs.map(l => `${l.name} à ${game.planets[l.planetId].name}`).join(', ');
  for (const p of empires(game)) {
    for (const l of P.lairs) { const pi = p.intel.planets[l.planetId]; if (pi) pi.lair = 'pirates'; }
    p.messages.push({ year: game.year, kind: 'event', text: `Des pirates se sont installés dans la galaxie : ${where}. Ils vont piller les colonies riches et mal défendues. Leur repaire garde leur butin ; on peut aussi les payer pour viser un rival (une prime, dans la file de production ou sur la page Empire).`, target: { kind: 'planet', id: P.lairs[0].planetId } });
  }
}

// ---------------------------------------------------------------------------------------------------- bounties

/** Why an empire cannot put a bounty on another (null: it can). */
export function bountyBlocker(game: GameState, p: Player, target: number | undefined): string | null {
  if (!piratesActive(game)) return 'les pirates ne sont pas actifs';
  const t = target !== undefined ? game.players[target] : undefined;
  if (!t || t.monster || t.id === p.id) return 'cible invalide';
  if (t.dead) return `les ${t.name} ont disparu`;
  if (!p.intel.met.includes(t.id)) return 'empire inconnu';
  return null;
}

/** The bounty is paid (anonymously): the pirates will favour the target. */
export function placeBounty(game: GameState, p: Player, target: number, amount: number, at?: Planet) {
  const P = game.pirates;
  if (!P || bountyBlocker(game, p, target)) return;
  P.bounty[target] = (P.bounty[target] ?? 0) + amount;
  P.placed ??= {};
  const mine = P.placed[p.id] ??= {};
  mine[target] = (mine[target] ?? 0) + amount;
  p.messages.push({ year: game.year, kind: 'event', text: `${at ? at.name + ' : ' : ''}prime de ${amount} R versée aux pirates contre les ${game.players[target].name} (${P.bounty[target]} R en tout sur leur tête). Les prochains raids les viseront en priorité.`, target: at ? { kind: 'planet', id: at.id } : { kind: 'player', id: target } });
}

// ---------------------------------------------------------------------------------------------------- raids

/** What a world is worth to a pirate: minerals and installations, less what defends it. */
export function raidAppeal(game: GameState, pl: Planet): number {
  const owner = game.players[pl.owner];
  if (!owner || owner.monster) return 0;
  const sp = planetSpec(game, pl, owner);
  const wealth = pl.surface.ironium + pl.surface.boranium + pl.surface.germanium + (pl.mines + pl.factories) * 3 + pl.pop / 500;
  const sb = pl.starbase ? (specOf(game, pl.starbase.designId).hasWeapons ? 0.12 : 0.5) : 1;
  return wealth * sb * (1 - 0.7 * (sp.defenseCoverage ?? 0));
}

/** How far a raid goes from its lair. */
export const raidRange = (game: GameState) => Math.max(350, game.width * 0.45);

/** Picks the next target: rich, poorly defended worlds within reach, much more often those of the empire with a bounty. */
function pickTarget(game: GameState, from: Planet, rng: Rng): Planet | null {
  const P = game.pirates!;
  const range = raidRange(game);
  const scores = empires(game).map(p => ({ id: p.id, s: p.scores[p.scores.length - 1]?.score ?? 0 })).sort((a, b) => b.s - a.s);
  const leader = scores.length > 1 && scores[0].s > scores[1].s * 1.2 ? scores[0].id : -1;
  const cands: { pl: Planet; w: number }[] = [];
  for (const pl of game.planets) {
    if (pl.owner < 0 || game.players[pl.owner].monster || game.players[pl.owner].dead) continue;
    const bounty = P.bounty[pl.owner] ?? 0;
    const d = distance(pl, from);
    if (d > range * (bounty >= BOUNTY_UNIT ? 1.5 : 1)) continue;
    let w = raidAppeal(game, pl) / (1 + d / 250);
    w *= 1 + bounty / 150;
    if (pl.owner === leader) w *= 1.25;
    if (pl.owner === P.lastTarget && bounty < BOUNTY_UNIT) w *= 0.6;
    if (w > 0) cands.push({ pl, w });
  }
  if (!cands.length) return null;
  cands.sort((a, b) => b.w - a.w);
  const top = cands.slice(0, 5);
  let r = rng.random() * top.reduce((a, c) => a + c.w, 0);
  for (const c of top) { r -= c.w; if (r <= 0) return c.pl; }
  return top[0].pl;
}

/** Years for a fleet to reach a point at its raid speed. */
export function etaYears(game: GameState, f: Fleet, to: { x: number; y: number }): number {
  const w = Math.max(4, Math.min(10, fleetSpec(game, f).idealSpeed || 6));
  return Math.max(1, Math.ceil(distance(f, to) / (w * w)));
}

function launchRaid(game: GameState) {
  const P = game.pirates!;
  const owner = game.players[P.id];
  const rng = rngOf(game, 'raid');
  const lairs = liveLairs(game);
  // the lair with the best target
  let best: { lair: PirateLair; pl: Planet } | null = null;
  for (const l of rng.shuffle([...lairs])) {
    const pl = pickTarget(game, game.planets[l.planetId], rng);
    if (pl && (!best || (P.bounty[pl.owner] ?? 0) > (P.bounty[best.pl.owner] ?? 0) || raidAppeal(game, pl) > raidAppeal(game, best.pl) * 1.5)) best = { lair: l, pl };
  }
  const interval = Math.max(4, 9 - lairs.length) + rng.int(3);
  if (!best) { P.nextRaid = game.year + 2; return; }
  const target = best.pl, home = game.planets[best.lair.planetId];
  const empire = target.owner;
  const consumed = Math.min(P.bounty[empire] ?? 0, 400);
  if (consumed > 0) { P.bounty[empire] -= consumed; P.treasure += consumed; }
  const years = game.year - 2400;
  let n = 1 + Math.floor(years / 20) + Math.floor(consumed / 200);
  if (P.treasure >= RAIDER_COST * 3) { n++; P.treasure -= RAIDER_COST; }
  n = Math.max(1, Math.min(10, n));
  const d = raiderDesign(game, owner, Math.round(galaxyTech(game) + 1));
  if (!d) { P.nextRaid = game.year + interval; return; }
  const f = spawnFleet(game, owner, [{ designId: d.id, qty: n }], home, `Raid ${deBand(best.lair.name)}`, { purpose: 'raider', raid: raidOrder(game, 'pirates', empire, target.id, home.id) });
  sendTo(game, f, target);
  P.raids++; P.lastTarget = empire;
  P.nextRaid = game.year + interval - (consumed >= 200 ? 2 : 0);
  const eta = game.year + etaYears(game, f, target);
  f.raid!.eta = eta;
  const victim = game.players[empire];
  victim.messages.push({ year: game.year, kind: 'warning', text: `Alerte pirate : un raid ${deBand(best.lair.name)} (${n} vaisseau${n > 1 ? 'x' : ''}) a quitté ${home.name}. Vos informateurs pensent qu'il vise ${target.name} (arrivée vers ${eta}).${consumed > 0 ? ' Quelqu\'un a payé pour ce raid.' : ''} Une flotte armée en orbite ou une station armée l'arrêteront ; des défenses planétaires limiteront le pillage.`, target: { kind: 'planet', id: target.id } });
  // 0.3.9.21: only the payers whose money this raid used are told (it was everyone who ever paid against that empire),
  // each for its share of what is left of its bounties
  const left = Object.entries(P.placed ?? {}).map(([payer, by]) => ({ payer: +payer, n: (by[empire] ?? 0) - (P.spent?.[+payer]?.[empire] ?? 0) })).filter(x => x.n > 0);
  const owed = left.reduce((a, x) => a + x.n, 0);
  let toShare = consumed;
  if (consumed > 0) for (const [k, x] of left.entries()) {
    const take = k === left.length - 1 ? Math.min(x.n, toShare) : Math.min(x.n, toShare, Math.floor(consumed * x.n / owed));
    if (take <= 0) continue;
    toShare -= take;
    const sp = (P.spent ??= {})[x.payer] ??= {};
    sp[empire] = (sp[empire] ?? 0) + take;
    const payer = x.payer;
    if (game.players[payer].dead) continue;
    game.players[payer].messages.push({ year: game.year, kind: 'event', text: `Les pirates ont pris votre argent : un raid ${deBand(best.lair.name)} part contre les ${victim.name} (${target.name}).`, target: { kind: 'planet', id: target.id } });
  }
}

/** An empire fleet able to fight, at that point. */
const armedEmpireAt = (game: GameState, pl: Planet) => game.fleets.some(f => f.x === pl.x && f.y === pl.y && f.tokens.length > 0 && !game.players[f.owner].monster && fleetSpec(game, f).hasWeapons);

function goHome(game: GameState, f: Fleet) {
  const r = f.raid!;
  const lairs = liveLairs(game);
  let home = lairs.find(l => l.planetId === r.home);
  if (!home && lairs.length) home = [...lairs].sort((a, b) => distance(game.planets[a.planetId], f) - distance(game.planets[b.planetId], f))[0];
  if (!home) { disband(game, f); return; }
  r.home = home.planetId; r.phase = 'home'; r.since = game.year;
  sendTo(game, f, game.planets[home.planetId]);
}
function disband(game: GameState, f: Fleet) { f.tokens = []; game.fleets = game.fleets.filter(x => x !== f); }

/** The raid takes what it can. */
function plunder(game: GameState, f: Fleet, pl: Planet, rng: Rng) {
  const r = f.raid!;
  const victim = game.players[pl.owner];
  const sp = planetSpec(game, pl, victim);
  const cov = sp.defenseCoverage ?? 0;
  const fs = fleetSpec(game, f);
  const k = 0.5 * (1 - cov * 0.6);
  // what the holds take, plus what the crews carry off in their own ways (400 kt a ship at most)
  const hold = Math.max(0, fs.cargoCapacity - (f.cargo.ironium + f.cargo.boranium + f.cargo.germanium));
  const room = Math.max(hold, 400 * fs.ships);
  const want = MINERALS.map(m => Math.floor(pl.surface[m] * k));
  const total = want.reduce((a, b) => a + b, 0);
  const scale = total > room ? room / total : 1;
  let taken = 0, held = 0;
  MINERALS.forEach((m, i) => {
    const t = Math.floor(want[i] * scale);
    pl.surface[m] -= t; taken += t;
    const c = Math.min(t, Math.floor(hold * (total > 0 ? want[i] / total : 0)));
    f.cargo[m] += c; held += c;
  });
  r.loot += taken - held;
  const frac = (0.06 + 0.04 * rng.random()) * (1 - cov * 0.5);
  const mines = pl.mines > 0 ? Math.min(pl.mines, Math.ceil(pl.mines * frac)) : 0;
  const facts = pl.factories > 0 ? Math.min(pl.factories, Math.ceil(pl.factories * frac)) : 0;
  pl.mines -= mines; pl.factories -= facts;
  const killed = Math.max(0, Math.min(pl.pop - 100, Math.round(pl.pop * 0.03 * (1 - cov) / 100) * 100));
  pl.pop -= killed;
  const P = game.pirates!;
  (P.log ??= []).push({ year: game.year, empire: pl.owner, planet: pl.id, loot: taken });
  if (P.log.length > 40) P.log.splice(0, P.log.length - 40);
  victim.stats.raided = (victim.stats.raided ?? 0) + 1;
  const band = liveLairs(game).find(l => l.planetId === r.home)?.name;
  const parts = [`${taken.toLocaleString('fr-FR')} kt de minerais pillés`];
  if (facts || mines) parts.push(`${facts} usine${facts > 1 ? 's' : ''} et ${mines} mine${mines > 1 ? 's' : ''} détruite${facts + mines > 1 ? 's' : ''}`);
  if (killed > 0) parts.push(`${people(game, killed)} colons tués`);
  victim.messages.push({ year: game.year, kind: 'combat', text: `Raid pirate sur ${pl.name}${band ? ` (${band})` : ''} : ${parts.join(', ')}. Les pillards repartent vers leur repaire${cov > 0.3 ? ' ; vos défenses ont limité les dégâts' : ''}.`, target: { kind: 'planet', id: pl.id } });
}

/** Raids under way: arrival, siege, plunder, retreat, return. */
function runRaids(game: GameState) {
  const rng = rngOf(game, 'plunder');
  for (const f of [...game.fleets]) {
    const r = f.raid;
    if (!r || r.kind !== 'pirates' || !f.tokens.length) continue;
    const victim = game.players[r.empire];
    const target = game.planets[r.target];
    if (r.phase === 'home') {
      const home = game.planets[r.home ?? -1];
      if (!home || !lairAt(game, home.id)) { goHome(game, f); continue; }
      if (f.x === home.x && f.y === home.y) {
        const P = game.pirates!;
        P.treasure += r.loot + f.cargo.ironium + f.cargo.boranium + f.cargo.germanium;
        const lf = lairFleet(game, lairAt(game, home.id)!);
        // the raiders join the garrison while it has room, the others share the loot and leave
        // (0.3.9.21: up to the cap, ship by ship; the whole raid joined as soon as there was room for one)
        let room = lf ? garrisonCap(game) - shipsOf(lf) : 0;
        for (const t of f.tokens) {
          if (room <= 0) break;
          const q = Math.min(t.qty, room), qd = Math.min(t.qtyDamaged, q);
          room -= q;
          const same = lf!.tokens.find(x => x.designId === t.designId);
          if (same) {
            const total = same.damage * same.qtyDamaged + t.damage * qd;
            same.qty += q; same.qtyDamaged += qd;
            same.damage = same.qtyDamaged > 0 ? total / same.qtyDamaged : 0;
          } else lf!.tokens.push({ ...t, qty: q, qtyDamaged: qd, damage: qd > 0 ? t.damage : 0 });
        }
        disband(game, f);
      } else if (f.waypoints.length < 2) sendTo(game, f, home);
      continue;
    }
    // the target changed hands or died out: the nearest world of the same empire, else home
    if (target.owner !== r.empire) {
      const alt = game.planets.filter(pl => pl.owner === r.empire).sort((a, b) => distance(a, f) - distance(b, f))[0];
      if (alt && distance(alt, f) <= 250 && !victim.dead) {
        r.target = alt.id; sendTo(game, f, alt);
        // 0.3.9.21: the informants tell where it turns (the map moved its warning there without a word)
        r.eta = game.year + etaYears(game, f, alt);
        victim.messages.push({ year: game.year, kind: 'warning', text: `Alerte pirate : ${target.name} ne vous appartenant plus, ${f.name} se détourne vers ${alt.name}, selon vos informateurs (arrivée vers ${r.eta}).`, target: { kind: 'planet', id: alt.id } });
      } else goHome(game, f);
      continue;
    }
    // badly mauled: back to the lair
    if (damageShare(game, f) > 0.5) {
      goHome(game, f);
      victim.messages.push({ year: game.year, kind: 'combat', text: `Le raid pirate qui visait ${target.name} a subi trop de pertes et rebrousse chemin.`, target: { kind: 'planet', id: target.id } });
      continue;
    }
    const there = f.x === target.x && f.y === target.y;
    if (!there) {
      if (f.waypoints.length < 2) sendTo(game, f, target);
      if (game.year - r.since > 12) goHome(game, f); // lost in space
      continue;
    }
    if (r.phase === 'go') { r.phase = 'siege'; r.since = game.year; }
    if (target.starbase || armedEmpireAt(game, target)) {
      if (game.year - r.since >= 2) {
        goHome(game, f);
        victim.messages.push({ year: game.year, kind: 'combat', text: `Les pirates renoncent à ${target.name}, trop bien défendue, et repartent.`, target: { kind: 'planet', id: target.id } });
      }
      continue;
    }
    plunder(game, f, target, rng);
    goHome(game, f);
  }
}

/** Ships a lair can hold (grows with time). */
const garrisonCap = (game: GameState) => Math.min(GARRISON_MAX, GARRISON_START + Math.floor((game.year - (game.pirates?.emergeYear ?? game.year)) / 12));

/** Lairs mend their damage and spend their treasure on new ships (of the galaxy's current level). */
function tendLairs(game: GameState) {
  const P = game.pirates!;
  const owner = game.players[P.id];
  for (const l of liveLairs(game)) {
    const f = lairFleet(game, l);
    if (!f) continue;
    for (const t of f.tokens) { t.damage = Math.floor(t.damage * 0.75); if (t.damage <= 0) { t.damage = 0; t.qtyDamaged = 0; } }
    P.treasure += 30;
    if (shipsOf(f) < garrisonCap(game) && P.treasure >= SHIP_COST) {
      const d = garrisonDesign(game, owner, Math.round(galaxyTech(game) + 2));
      if (!d) continue;
      P.treasure -= SHIP_COST;
      const same = f.tokens.find(t => t.designId === d.id);
      if (same) same.qty++; else f.tokens.push({ designId: d.id, qty: 1, damage: 0, qtyDamaged: 0 });
    }
  }
  // raiders mend a little on the way
  for (const f of game.fleets) if (f.raid?.kind === 'pirates') for (const t of f.tokens) { t.damage = Math.floor(t.damage * 0.9); if (t.damage <= 0) { t.damage = 0; t.qtyDamaged = 0; } }
}

/** Lairs destroyed this year: research and the treasure for the winners; the pirates end with their last lair. */
function checkLairs(game: GameState) {
  const P = game.pirates!;
  const rng = rngOf(game, 'lair');
  for (const l of P.lairs) {
    if (!l.alive || game.fleets.some(f => f.id === l.fleetId && f.tokens.length)) continue;
    const alive = liveLairs(game).length;
    l.alive = false; l.killedYear = game.year;
    const pl = game.planets[l.planetId];
    const battle = game.battles.find(b => b.planetId === pl.id || (Math.round(b.x) === pl.x && Math.round(b.y) === pl.y));
    const winners = (battle?.players ?? []).filter(id => !game.players[id].monster && !game.players[id].dead);
    const held = winners.map(id => ({ id, n: game.fleets.filter(f => f.owner === id && f.x === pl.x && f.y === pl.y).reduce((a, f) => a + shipsOf(f), 0) })).sort((a, b) => b.n - a.n || a.id - b.id);
    if (held.length) l.killedBy = held[0].id;
    // the treasure, shared between the lairs still standing, is left on the planet
    const share = Math.round(P.treasure / Math.max(1, alive));
    P.treasure -= share;
    const each = 200 + Math.round(share / 3);
    for (const m of MINERALS) pl.surface[m] += each;
    for (const id of winners) {
      const p = game.players[id];
      const field = FIELDS[rng.int(FIELDS.length)];
      const pts = Math.round(researchCost(game, p, field) * 0.4);
      const story = researchStory(game, p, field, pts, 'lair', rng);
      let text = `Le repaire ${deBand(l.name)} à ${pl.name} est détruit. Vos équipes fouillent les ruines : ${story}. Le butin des pirates, ${each} kt de chaque minerai, est resté à la surface.`;
      if (id === l.killedBy && rng.chance(0.3)) {
        const relic = missingRelic(p, rng.int(100), ['heart']);
        if (relic && giveRelic(p, relic)) text += ` Dans la salle du trésor, une relique : ${RELICS[relic].name} (${RELICS[relic].effect}).`;
      }
      p.stats.lairsDestroyed = (p.stats.lairsDestroyed ?? 0) + 1;
      p.messages.push({ year: game.year, kind: 'event', text, target: { kind: 'planet', id: pl.id } });
    }
    for (const p of empires(game)) {
      const pi = p.intel.planets[pl.id];
      if (pi) pi.lair = undefined;
      if (winners.includes(p.id)) continue;
      p.messages.push({ year: game.year, kind: 'event', text: `Le repaire ${deBand(l.name)} à ${pl.name} a été détruit${held.length ? ` par les ${game.players[held[0].id].name}` : ''}.`, target: { kind: 'planet', id: pl.id } });
    }
  }
  if (!liveLairs(game).length && !P.ended) {
    P.ended = true;
    for (const f of [...game.fleets]) if (isPirate(game, f.owner)) disband(game, f);
    for (const pl of game.planets) pl.queue = pl.queue.filter(q => q.kind !== 'bounty');
    const last = game.planets[[...P.lairs].sort((a, b) => (b.killedYear ?? 0) - (a.killedYear ?? 0))[0].planetId];
    for (const p of empires(game)) p.messages.push({ year: game.year, kind: 'event', text: `Le dernier repaire pirate, à ${last.name}, est tombé : les bandes survivantes se dispersent. Les routes de la galaxie sont sûres.`, target: { kind: 'planet', id: last.id } });
  }
}

/** Yearly, after the battles. */
export function runPirates(game: GameState) {
  if (!piratesOn(game)) return;
  if (!game.pirates) initPirates(game);
  const P = game.pirates!;
  if (P.ended) return;
  if (!P.emerged) { if (game.year >= P.emergeYear) emerge(game); return; }
  checkLairs(game);
  if (P.ended) return;
  runRaids(game);
  tendLairs(game);
  if (game.year >= P.nextRaid) launchRaid(game);
}

/** Raids under way against an empire (for its AI and its Empire page). */
export function raidsAgainst(game: GameState, empire: number): Fleet[] {
  return game.fleets.filter(f => f.raid?.kind === 'pirates' && f.raid.empire === empire && f.raid.phase !== 'home' && f.tokens.length > 0);
}

/**
 * 0.3.9.7: a crew at a lair (a ship there, or a battle there this year) measures its garrison: told to the player and
 * kept for the lair's panel, as for the guardians.
 */
export function lairAssessments(game: GameState) {
  const P = game.pirates;
  if (!P?.emerged) return;
  for (const l of P.lairs) {
    if (!l.alive) continue;
    const gf = lairFleet(game, l);
    if (!gf || !gf.tokens.length) continue;
    const pl = game.planets[l.planetId];
    const theirs = fleetStrength(game, gf);
    const ships = shipsOf(gf);
    for (const p of game.players) {
      if (p.dead || p.ai || p.monster) continue;
      const there = game.fleets.filter(f => f.owner === p.id && Math.abs(f.x - gf.x) < 0.5 && Math.abs(f.y - gf.y) < 0.5);
      const fought = game.battles.find(b => b.players.includes(p.id) && b.players.includes(P.id) && Math.abs(b.x - gf.x) < 0.5 && Math.abs(b.y - gf.y) < 0.5);
      const witness = there[0]?.name ?? (fought ? fought.tokens.find(t => t.owner === p.id && t.fleetId >= 0)?.designName : undefined);
      if (!witness) continue;
      const { navy, best, bestName } = navyOf(game, p.id);
      (p.intel.lairReports ??= {})[l.planetId] = { year: game.year, witness, strength: theirs, navy, best, bestName, ships };
      const pi = p.intel.planets[pl.id];
      if (pi) pi.lair = 'pirates';
      p.intel.warned ??= {};
      const key = `lair${l.planetId}`;
      if (p.intel.warned[key] === game.year) continue;
      p.intel.warned[key] = game.year;
      const s = Math.max(1, theirs);
      p.messages.push({ year: game.year, kind: 'event', text: navy > 0
        ? `D'après l'équipage de ${witness}, la garnison du repaire ${deBand(l.name)} à ${pl.name} compte ${ships} vaisseaux. L'ensemble de vos vaisseaux de guerre réunis : ${shareOf(navy / s)} ; votre plus forte flotte, ${bestName} : ${shareOf(best / s)}.`
        : `D'après l'équipage de ${witness}, la garnison du repaire ${deBand(l.name)} à ${pl.name} compte ${ships} vaisseaux. Vous n'avez aucun vaisseau de guerre.`, target: { kind: 'planet', id: pl.id } });
    }
  }
}

/** Strength of a lair (as the AI counts it). */
export function lairStrength(game: GameState, l: PirateLair): number {
  const f = lairFleet(game, l);
  return f ? fleetStrength(game, f) : 0;
}
