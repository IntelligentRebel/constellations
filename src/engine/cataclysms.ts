// 0.3.9: announced cataclysms. From the second act on, now and then, the galaxy itself strikes, always announced
// years ahead so that empires can flee or bet: a star collapses into a supernova (everything within 35 ly is wiped
// out, the fallout reaches 70 ly), or a wandering black hole crosses the galaxy at a few light-years a year (what
// passes within 10 ly is lost, it tears at what passes within 25 ly). The ruins are rich: heavy elements.
import type { Cataclysm, Fleet, GameState, Planet, Player } from './types';
import { MINERALS } from './types';
import { Rng, seedFromString } from './rng';
import { distance } from './fleet';
import { specOf } from './design';
import { revealPlanet } from './scan';
import { resetPlanetPolicies } from './empire';
import { addChronicle } from './chronicle';
import { actOf } from './acts';

export const cataclysmsOn = (game: GameState) => !!game.settings.cataclysms;
export const SUPERNOVA_WARNING = 15;
export const SN_RADIUS = 35, SN_FALLOUT = 70;
export const BH_CORE = 10, BH_REACH = 25;

const rngOf = (game: GameState, what: string) => new Rng(seedFromString(`${game.settings.seed}|cata|${what}|${game.year}`));
const empires = (game: GameState) => game.players.filter(p => !p.monster && !p.dead);
const bounds = (game: GameState) => {
  const ps = game.planets.filter(p => !p.hidden);
  return { x0: Math.min(...ps.map(p => p.x)), x1: Math.max(...ps.map(p => p.x)), y0: Math.min(...ps.map(p => p.y)), y1: Math.max(...ps.map(p => p.y)) };
};

/** The cataclysms under way (announced, not over). */
export const activeCataclysms = (game: GameState) => (game.cataclysms ?? []).filter(c => c.done === undefined);

/** Where a black hole will be in `k` years. */
export const holeAt = (c: Cataclysm, k: number) => ({ x: c.x + (c.vx ?? 0) * k, y: c.y + (c.vy ?? 0) * k });

/** Is this point in danger in the next `years` (for the planners and the computers)? */
export function dangerAt(game: GameState, at: { x: number; y: number }, years = 15): Cataclysm | undefined {
  for (const c of activeCataclysms(game)) {
    if (c.kind === 'supernova') { if (distance(at, c) <= SN_FALLOUT && (c.at ?? 0) - game.year <= years) return c; continue; }
    for (let k = 0; k <= years; k++) if (distance(at, holeAt(c, k)) <= BH_REACH) return c;
  }
  return undefined;
}

function wipe(game: GameState, pl: Planet, why: string) {
  if (pl.owner >= 0) {
    const o = game.players[pl.owner];
    o.messages.push({ year: game.year, kind: 'population', text: `${pl.name} est perdue : ${why}. Toute sa population a péri.`, target: { kind: 'planet', id: pl.id } });
    o.stats.planetsLost = (o.stats.planetsLost ?? 0) + 1;
  }
  pl.owner = -1; pl.pop = 0; pl.queue = []; pl.defenses = 0; pl.factories = 0; pl.mines = 0; pl.scanner = false; pl.starbase = null;
  pl.route = undefined; pl.packetTarget = undefined; pl.conqueredYear = undefined; resetPlanetPolicies(pl);
}

/** Damage to a fleet: a share of the armour of each ship; ships whose armour is gone are lost. */
function hurt(game: GameState, f: Fleet, share: number): number {
  let lost = 0;
  for (const t of f.tokens) {
    const armor = specOf(game, t.designId).armor;
    const dmg = armor * share;
    const before = t.qty;
    // damaged ships first take the blow
    const total = t.damage * t.qtyDamaged + dmg * t.qty;
    const dead = Math.min(t.qty, Math.floor(total / Math.max(1, armor)));
    t.qty -= dead;
    t.qtyDamaged = t.qty > 0 ? t.qty : 0;
    t.damage = t.qty > 0 ? Math.min(armor - 1, (total - dead * armor) / t.qty) : 0;
    lost += before - t.qty;
  }
  f.tokens = f.tokens.filter(t => t.qty > 0);
  return lost;
}

function tellAll(game: GameState, text: string, target?: { kind: 'planet' | 'space'; id: number; x?: number; y?: number }) {
  for (const p of empires(game)) p.messages.push({ year: game.year, kind: 'event', text, target });
}

/** Yearly: a new cataclysm now and then, the countdowns, the blows. */
export function runCataclysms(game: GameState) {
  if (!cataclysmsOn(game)) return;
  const list = game.cataclysms ?? (game.cataclysms = []);
  game.cataNext ??= 2445 + rngOf(game, 'first').int(20);
  if (!activeCataclysms(game).length && game.year >= game.cataNext && actOf(game) >= 2) {
    const rng = rngOf(game, 'new');
    const c = rng.chance(0.55) ? announceSupernova(game, rng) : announceHole(game, rng);
    if (c) list.push(c);
    game.cataNext = game.year + 35 + rng.int(25);
  }
  for (const c of activeCataclysms(game)) c.kind === 'supernova' ? supernovaYear(game, c) : holeYear(game, c);
}

function announceSupernova(game: GameState, rng: Rng): Cataclysm | undefined {
  // a star far enough from every capital and homeworld: nobody loses the heart of its empire to the sky
  const hearts = game.planets.filter(p => p.homeworld || game.players.some(o => o.capital === p.id));
  const cands = game.planets.filter(p => !p.hidden && p.owner < 0 && hearts.every(h => distance(h, p) > SN_RADIUS + 15));
  if (!cands.length) return undefined;
  // rather where something lives: a cataclysm nobody sees is no story
  const weight = (p: Planet) => 1 + game.planets.filter(o => o.owner >= 0 && distance(o, p) <= SN_FALLOUT).length;
  const total = cands.reduce((a, p) => a + weight(p), 0);
  let r = rng.random() * total, star = cands[0];
  for (const p of cands) { r -= weight(p); if (r <= 0) { star = p; break; } }
  const c: Cataclysm = { id: game.nextId++, kind: 'supernova', announced: game.year, x: star.x, y: star.y, planetId: star.id, at: game.year + SUPERNOVA_WARNING, told: [] };
  for (const p of empires(game)) revealPlanet(game, p, star, false);
  tellAll(game, `Les astronomes de toute la galaxie observent l'étoile de ${star.name} : elle s'effondre. Vers ${c.at}, une supernova soufflera tout ce qui se trouve à moins de ${SN_RADIUS} al et irradiera jusqu'à ${SN_FALLOUT} al. Ce qui peut fuir doit fuir ; les ruines seront riches en éléments lourds.`, { kind: 'planet', id: star.id });
  addChronicle(game, 'cataclysm', `L'étoile de ${star.name} s'effondre : une supernova est annoncée pour ${c.at}.`, [], star);
  return c;
}

function supernovaYear(game: GameState, c: Cataclysm) {
  const left = (c.at ?? game.year) - game.year;
  if (left > 0) {
    if ([10, 5, 2, 1].includes(left) && !c.told!.includes(left)) {
      c.told!.push(left);
      for (const p of empires(game)) {
        const worlds = game.planets.filter(pl => pl.owner === p.id && distance(pl, c) <= SN_FALLOUT);
        const ships = game.fleets.filter(f => f.owner === p.id && distance(f, c) <= SN_FALLOUT);
        if (!worlds.length && !ships.length) continue;
        const near = worlds.filter(pl => distance(pl, c) <= SN_RADIUS).length;
        p.messages.push({ year: game.year, kind: 'warning', text: left > 1 ? `Supernova de ${game.planets[c.planetId!].name} dans ${left} ans : ${worlds.length} de vos mondes (${near} dans le souffle) et ${ships.length} flotte${ships.length > 1 ? 's' : ''} à portée.` : `Supernova de ${game.planets[c.planetId!].name} l'an prochain : ${worlds.length} de vos mondes (${near} dans le souffle) et ${ships.length} flotte${ships.length > 1 ? 's' : ''} à portée.`, target: { kind: 'planet', id: c.planetId! } });
      }
    }
    return;
  }
  // the blast
  const star = game.planets[c.planetId!];
  const lost: Record<number, { worlds: number; ships: number }> = {};
  const note = (o: number, k: 'worlds' | 'ships', n: number) => { (lost[o] ??= { worlds: 0, ships: 0 })[k] += n; };
  for (const pl of game.planets) {
    const d = distance(pl, c);
    if (d > SN_FALLOUT) continue;
    if (d <= SN_RADIUS) {
      if (pl.owner >= 0) note(pl.owner, 'worlds', 1);
      wipe(game, pl, `le souffle de la supernova de ${star.name}`);
      pl.hab = [pl.hab[0], d < 5 ? 100 : Math.max(pl.hab[1], 85), 100] as Planet['hab'];
      for (const m of MINERALS) { pl.surface[m] = Math.trunc(pl.surface[m] * 0.3); pl.conc[m] = Math.min(120, pl.conc[m] + (m === 'ironium' ? 10 : 35)); }
    } else {
      pl.pop = Math.round(pl.pop * 0.5 / 100) * 100;
      pl.defenses = Math.trunc(pl.defenses * 0.5);
      pl.hab = [pl.hab[0], pl.hab[1], Math.min(100, pl.hab[2] + 25)] as Planet['hab'];
      for (const m of MINERALS) pl.conc[m] = Math.min(120, pl.conc[m] + 10);
      if (pl.owner >= 0 && pl.pop <= 0) { note(pl.owner, 'worlds', 1); wipe(game, pl, `les radiations de la supernova de ${star.name}`); }
    }
  }
  for (const f of [...game.fleets]) {
    const d = distance(f, c);
    if (d > SN_FALLOUT || game.players[f.owner]?.monster) continue;
    const before = f.tokens.reduce((a, t) => a + t.qty, 0);
    const n = d <= SN_RADIUS ? before : hurt(game, f, 0.4);
    if (d <= SN_RADIUS) f.tokens = [];
    if (n) note(f.owner, 'ships', n);
  }
  game.fleets = game.fleets.filter(f => f.tokens.length > 0);
  for (const p of empires(game)) {
    for (const pl of game.planets) if (distance(pl, c) <= SN_FALLOUT && p.intel.planets[pl.id]?.year !== undefined) revealPlanet(game, p, pl, false);
    const l = lost[p.id];
    p.messages.push({ year: game.year, kind: 'event', text: l ? `L'étoile de ${star.name} a explosé : vous perdez ${l.worlds} monde${l.worlds > 1 ? 's' : ''} et ${l.ships} vaisseau${l.ships > 1 ? 'x' : ''}. Les mondes du souffle sont stériles, mais leurs sols regorgent d'éléments lourds.` : `L'étoile de ${star.name} a explosé. Les mondes à moins de ${SN_RADIUS} al sont stériles, mais leurs sols regorgent d'éléments lourds.`, target: { kind: 'planet', id: star.id } });
  }
  const victims = Object.keys(lost).map(Number).filter(o => !game.players[o].monster);
  const swept = game.planets.filter(pl => distance(pl, c) <= SN_RADIUS).length;
  addChronicle(game, 'cataclysm', swept > 1 ? `La supernova de ${star.name} balaie ${swept} mondes.` : `La supernova de ${star.name} balaie son système.`, victims, star);
  c.done = game.year;
}

function announceHole(game: GameState, rng: Rng): Cataclysm | undefined {
  const b = bounds(game);
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  // from a random side, toward the centre with a twist
  const side = rng.int(4);
  const t = rng.random();
  const x = side === 0 ? b.x0 - 20 : side === 1 ? b.x1 + 20 : b.x0 + t * (b.x1 - b.x0);
  const y = side === 2 ? b.y0 - 20 : side === 3 ? b.y1 + 20 : b.y0 + t * (b.y1 - b.y0);
  const ang = Math.atan2(cy - y, cx - x) + (rng.random() - 0.5) * 0.7;
  const speed = 5 + rng.int(3);
  const c: Cataclysm = { id: game.nextId++, kind: 'blackhole', announced: game.year, x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, told: [] };
  tellAll(game, `Un trou noir errant entre dans la galaxie (${Math.round(x)}, ${Math.round(y)}). Il dérive à ${speed} al par an ; sa trajectoire est sur la carte. Ce qu'il frôle à moins de ${BH_CORE} al est perdu ; jusqu'à ${BH_REACH} al, il arrache coques et atmosphères.`, { kind: 'space', id: 0, x: Math.round(x), y: Math.round(y) });
  addChronicle(game, 'cataclysm', 'Un trou noir errant entre dans la galaxie.', [], c);
  return c;
}

function holeYear(game: GameState, c: Cataclysm) {
  if (c.announced < game.year) { c.x += c.vx ?? 0; c.y += c.vy ?? 0; }
  const b = bounds(game);
  if (c.x < b.x0 - 60 || c.x > b.x1 + 60 || c.y < b.y0 - 60 || c.y > b.y1 + 60) {
    if (game.year - c.announced > 3) {
      c.done = game.year;
      tellAll(game, 'Le trou noir errant a quitté la galaxie.');
      addChronicle(game, 'cataclysm', `Le trou noir errant quitte la galaxie après ${game.year - c.announced} ans de traversée.`, []);
    }
    return;
  }
  const lost: Record<number, { worlds: string[]; ships: number }> = {};
  for (const pl of game.planets) {
    const d = distance(pl, c);
    if (d > BH_REACH) continue;
    if (d <= 4) {
      if (pl.owner >= 0) (lost[pl.owner] ??= { worlds: [], ships: 0 }).worlds.push(pl.name);
      wipe(game, pl, 'avalée par le trou noir errant');
      pl.hab = [100, 100, 100] as Planet['hab'];
      for (const m of MINERALS) { pl.surface[m] = 0; pl.conc[m] = Math.max(1, Math.trunc(pl.conc[m] / 2)); }
    } else if (d <= BH_CORE) {
      pl.pop = Math.round(pl.pop * 0.5 / 100) * 100; pl.factories = Math.trunc(pl.factories * 0.7); pl.mines = Math.trunc(pl.mines * 0.7); pl.defenses = Math.trunc(pl.defenses * 0.7);
      if (pl.owner >= 0 && pl.pop <= 0) { (lost[pl.owner] ??= { worlds: [], ships: 0 }).worlds.push(pl.name); wipe(game, pl, 'arrachée par le trou noir errant'); }
    } else { pl.pop = Math.round(pl.pop * 0.85 / 100) * 100; pl.defenses = Math.trunc(pl.defenses * 0.9); }
  }
  for (const f of [...game.fleets]) {
    if (game.players[f.owner]?.monster) continue;
    const d = distance(f, c);
    if (d > BH_REACH) continue;
    const before = f.tokens.reduce((a, t) => a + t.qty, 0);
    let n: number;
    if (d <= BH_CORE) { f.tokens = []; n = before; } else n = hurt(game, f, 0.2);
    if (n) (lost[f.owner] ??= { worlds: [], ships: 0 }).ships += n;
  }
  game.fleets = game.fleets.filter(f => f.tokens.length > 0);
  for (const [o, l] of Object.entries(lost)) {
    const p = game.players[+o];
    if (p.monster) continue;
    p.messages.push({ year: game.year, kind: 'event', text: l.worlds.length ? (l.ships ? `Le trou noir errant a emporté ${l.worlds.join(', ')} et ${l.ships} de vos vaisseaux.` : `Le trou noir errant a emporté ${l.worlds.join(', ')}.`) : `Le trou noir errant a détruit ${l.ships} de vos vaisseaux.`, target: { kind: 'space', id: 0, x: Math.round(c.x), y: Math.round(c.y) } });
    if (l.worlds.length) addChronicle(game, 'cataclysm', `Le trou noir errant avale ${l.worlds.join(', ')}.`, [+o], c);
  }
  // warnings: worlds near its path in the next five years
  for (const p of empires(game)) {
    const near: { pl: Planet; k: number }[] = [];
    for (const pl of game.planets) {
      if (pl.owner !== p.id) continue;
      for (let k = 1; k <= 5; k++) if (distance(pl, holeAt(c, k)) <= BH_REACH) { near.push({ pl, k }); break; }
    }
    const fresh = near.filter(x => !(c.warned ?? []).includes(x.pl.id));
    if (!fresh.length) continue;
    c.warned = [...(c.warned ?? []), ...fresh.map(x => x.pl.id)];
    p.messages.push({ year: game.year, kind: 'warning', text: fresh.length > 1 ? `Le trou noir errant passera près de ${fresh.length} de vos mondes dans les cinq ans : ${fresh.map(x => `${x.pl.name} (${x.k} an${x.k > 1 ? 's' : ''})`).join(', ')}.` : `Le trou noir errant passera près de ${fresh[0].pl.name} dans ${fresh[0].k} an${fresh[0].k > 1 ? 's' : ''}.`, target: { kind: 'planet', id: fresh[0].pl.id } });
  }
}

/** For the tests and the settings: start one now. */
export function forceCataclysm(game: GameState, kind: 'supernova' | 'blackhole'): Cataclysm | undefined {
  const rng = rngOf(game, 'forced' + kind);
  const c = kind === 'supernova' ? announceSupernova(game, rng) : announceHole(game, rng);
  if (c) (game.cataclysms ??= []).push(c);
  return c;
}

export type { Player };
