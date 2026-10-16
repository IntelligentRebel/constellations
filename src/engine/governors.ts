// 0.3.9: sector governors. Every seat of government (the capital, a regional capital or, without the cost of distance,
// a world designated as a sector seat) heads a sector: the worlds closer to it than to any other seat. A governor named
// at its head brings a talent that grows with the years of service, and may run the production queues of the sector
// along a standing order (develop, industry, fortify, radiance), raising the defenses when a hostile fleet comes close.
// The manual lines of a queue are never touched; the capital and the worlds set apart stay in the player's hands.
import type { GameState, Governor, Planet, Player, QueueItem, QueueKind } from './types';
import { Rng, seedFromString } from './rng';
import { distance } from './fleet';
import { seatsOf, capitalOf } from './empire';
import { isAuto, zeroCost } from './production';
import { GOVERNOR_FIRST, GOVERNOR_LAST } from '../data/names';

export const governorsOn = (game: GameState) => !!game.settings.governors;

export type GovTrait = Governor['trait'];
export type GovPolicy = Governor['policy'];

/** The talents: `rate` % per level (five levels). */
export const GOV_TRAITS: Record<GovTrait, { name: string; rate: number; text: (pct: number) => string }> = {
  steward: { name: 'Intendant', rate: 2, text: n => `+${n} % de ressources dans le secteur` },
  builder: { name: 'Bâtisseur', rate: 4, text: n => `usines et mines ${n} % moins chères dans le secteur` },
  warden: { name: 'Stratège', rate: 5, text: n => `défenses et stations ${n} % moins chères dans le secteur` },
  prospector: { name: 'Prospecteur', rate: 3, text: n => `+${n} % d'extraction minière dans le secteur` },
  patron: { name: 'Mécène', rate: 6, text: n => `+${n} % de culture dans le secteur` },
};
/** Years of service for each level (1 to 5). */
export const GOV_LEVELS = [0, 8, 20, 35, 55];
export const POOL_SIZE = 3;
export const POOL_YEARS = 10;
/** A hostile fleet this close to a world of the sector raises its defenses. */
export const THREAT_RANGE = 60;
/** Without the cost of distance: one designated seat for every this many worlds (besides the capital). */
export const WORLDS_PER_SEAT = 8;

type PolicyItem = { kind: QueueKind; qty: number };
export const GOV_POLICIES: Record<GovPolicy, { name: string; text: string; items: PolicyItem[] }> = {
  manual: { name: 'Gestion manuelle', text: 'le gouverneur ne touche pas aux files de production', items: [] },
  develop: { name: 'Développement', text: 'terraformation, usines, mines et quelques défenses, davantage sous la menace', items: [{ kind: 'autoMinTerraform', qty: 5 }, { kind: 'autoFactories', qty: 500 }, { kind: 'autoMines', qty: 500 }, { kind: 'autoDefenses', qty: 20 }, { kind: 'autoMaxTerraform', qty: 200 }] },
  industry: { name: 'Industrie', text: 'usines, mines, terraformation et alchimie, sans défenses', items: [{ kind: 'autoMinTerraform', qty: 5 }, { kind: 'autoFactories', qty: 500 }, { kind: 'autoMines', qty: 500 }, { kind: 'autoMaxTerraform', qty: 200 }, { kind: 'autoAlchemy', qty: 1 }] },
  fortify: { name: 'Fortification', text: 'les défenses d\'abord, puis usines, mines et terraformation', items: [{ kind: 'autoDefenses', qty: 100 }, { kind: 'autoMinTerraform', qty: 5 }, { kind: 'autoFactories', qty: 500 }, { kind: 'autoMines', qty: 500 }, { kind: 'autoMaxTerraform', qty: 200 }] },
  culture: { name: 'Rayonnement', text: 'usines, mécénat, mines et terraformation', items: [{ kind: 'autoMinTerraform', qty: 5 }, { kind: 'autoFactories', qty: 500 }, { kind: 'autoPatronage', qty: 3 }, { kind: 'autoMines', qty: 500 }, { kind: 'autoMaxTerraform', qty: 200 }] },
};
export const policiesFor = (game: GameState): GovPolicy[] => (['manual', 'develop', 'industry', 'fortify', 'culture'] as GovPolicy[]).filter(p => p !== 'culture' || !!game.settings.culture);
export const traitsFor = (game: GameState): GovTrait[] => (Object.keys(GOV_TRAITS) as GovTrait[]).filter(t => t !== 'patron' || !!game.settings.culture);

export function levelOf(g: Governor): number {
  let lv = 0;
  for (const y of GOV_LEVELS) if (g.xp >= y) lv++;
  return Math.max(1, lv);
}
export const traitPct = (g: Governor) => GOV_TRAITS[g.trait].rate * levelOf(g);
export const traitText = (g: Governor) => GOV_TRAITS[g.trait].text(traitPct(g));

/** Seats of the sectors of an empire: its seats of government, and the designated seats without the cost of distance. */
export function sectorSeats(game: GameState, p: Player): Planet[] {
  const res = seatsOf(game, p);
  if (!game.settings.distanceCost) for (const pl of game.planets) if (pl.owner === p.id && pl.sectorSeat && !res.includes(pl)) res.push(pl);
  return res;
}
/** How many seats can still be designated (without the cost of distance). */
export function seatsLeft(game: GameState, p: Player): number {
  if (game.settings.distanceCost) return 0;
  const n = game.planets.filter(pl => pl.owner === p.id).length;
  const used = game.planets.filter(pl => pl.owner === p.id && pl.sectorSeat).length;
  return Math.max(0, Math.floor(n / WORLDS_PER_SEAT) - used);
}

/** Every world of the empire gets the seat it is closest to. */
export function computeSectors(game: GameState, p: Player) {
  const seats = sectorSeats(game, p);
  for (const pl of game.planets) {
    if (pl.owner !== p.id) { if (pl.sector !== undefined && pl.owner < 0) pl.sector = undefined; continue; }
    let best: Planet | undefined, bd = Infinity;
    for (const s of seats) { const d = distance(s, pl); if (d < bd) { bd = d; best = s; } }
    pl.sector = best?.id;
  }
}

export function sectorWorlds(game: GameState, p: Player, seatId: number): Planet[] {
  return game.planets.filter(pl => pl.owner === p.id && pl.sector === seatId);
}

/** The governor of the sector this world belongs to. */
export function governorOf(game: GameState, planet: Planet): Governor | undefined {
  if (!governorsOn(game) || planet.owner < 0 || planet.sector === undefined) return undefined;
  return game.players[planet.owner]?.governors?.find(g => g.seat === planet.sector);
}
/** The bonus of a talent on this world (a fraction: 0.06 for +6 %), 0 without such a governor. */
export function govBonus(game: GameState, planet: Planet, trait: GovTrait): number {
  const g = governorOf(game, planet);
  return g && g.trait === trait ? traitPct(g) / 100 : 0;
}

/** Does the governor run this world's queue? (not the capital, not a world set apart, not under the manual order) */
export function governed(game: GameState, planet: Planet): Governor | undefined {
  const g = governorOf(game, planet);
  if (!g || g.policy === 'manual' || planet.manual) return undefined;
  const p = game.players[planet.owner];
  if (capitalOf(game, p)?.id === planet.id) return undefined;
  return g;
}

function candidate(game: GameState, p: Player, rng: Rng): Governor {
  const traits = traitsFor(game);
  return {
    id: game.nextId++,
    name: `${GOVERNOR_FIRST[rng.int(GOVERNOR_FIRST.length)]} ${GOVERNOR_LAST[rng.int(GOVERNOR_LAST.length)]}`,
    trait: traits[rng.int(traits.length)],
    // some candidates have already served elsewhere
    xp: rng.chance(0.3) ? GOV_LEVELS[1] + rng.int(10) : rng.int(4),
    policy: p.ai ? 'manual' : 'develop',
  };
}

/** The candidates on offer: renewed every ten years, completed the year after a nomination. */
export function refreshPool(game: GameState, p: Player, force = false) {
  const rng = new Rng(seedFromString(`${game.settings.seed}|gov|${p.id}|${game.year}|${p.govPool?.length ?? 0}`));
  if (force || p.govPoolYear === undefined || game.year - p.govPoolYear >= POOL_YEARS) { p.govPool = []; p.govPoolYear = game.year; }
  p.govPool ??= [];
  while (p.govPool.length < POOL_SIZE) p.govPool.push(candidate(game, p, rng));
}

/** Names a candidate (or a governor waiting for a sector) at the head of a sector. Returns an error or null. */
export function appoint(game: GameState, p: Player, govId: number, seatId: number): string | null {
  const seat = game.planets[seatId];
  if (!seat || seat.owner !== p.id || !sectorSeats(game, p).includes(seat)) return 'ce monde n\'est pas un siège de secteur';
  p.governors ??= [];
  let g = p.governors.find(x => x.id === govId);
  if (!g) {
    const i = (p.govPool ?? []).findIndex(x => x.id === govId);
    if (i < 0) return 'ce candidat n\'est plus disponible';
    g = p.govPool!.splice(i, 1)[0];
    p.governors.push(g);
  }
  // the governor in place, if any, waits for another sector
  for (const o of p.governors) if (o !== g && o.seat === seatId) o.seat = undefined;
  g.seat = seatId; g.since = game.year;
  return null;
}

export function dismiss(p: Player, govId: number) {
  p.governors = (p.governors ?? []).filter(g => g.id !== govId);
}

/** Can this world become a sector seat (without the cost of distance)? null: yes. */
export function seatBlocker(game: GameState, p: Player, planet: Planet): string | null {
  if (!governorsOn(game)) return 'règle désactivée';
  if (game.settings.distanceCost) return 'avec la règle « Coût de la taille », les sièges sont les capitales régionales';
  if (planet.owner !== p.id) return 'ce monde n\'est pas à vous';
  if (planet.sectorSeat || capitalOf(game, p)?.id === planet.id) return 'déjà un siège';
  if (seatsLeft(game, p) <= 0) return `un siège pour ${WORLDS_PER_SEAT} mondes`;
  return null;
}

/** A hostile fleet seen this year close to the world? */
export function threatNear(game: GameState, p: Player, planet: Planet): boolean {
  for (const fi of p.intel.fleets) {
    if (fi.owner === p.id) continue;
    const hostile = fi.owner < 0 || p.relations[fi.owner] === 'enemy' || !!game.players[fi.owner]?.monster;
    if (!hostile) continue;
    const tr = p.intel.tracks?.[fi.id];
    if (tr && tr.length && tr[tr.length - 1].year !== game.year) continue;
    if (distance(fi, planet) <= THREAT_RANGE) return true;
  }
  return false;
}

/** The governor's queue for a world: the manual lines first, then the automatic lines of the order. */
export function applyPolicy(planet: Planet, policy: GovPolicy, threat: boolean) {
  const items = GOV_POLICIES[policy].items.map(i => ({ ...i }));
  if (!items.length) return;
  if (threat && (policy === 'develop' || policy === 'fortify')) {
    const d = items.find(i => i.kind === 'autoDefenses');
    if (d) d.qty = 100;
  }
  const manual = planet.queue.filter(q => !isAuto(q.kind));
  const autos = planet.queue.filter(q => isAuto(q.kind));
  const next: QueueItem[] = items.map(it => {
    const had = autos.find(q => q.kind === it.kind);
    return had ? { ...had, qty: it.qty } : { kind: it.kind, qty: it.qty, allocated: zeroCost() };
  });
  if (threat && (policy === 'develop' || policy === 'fortify')) {
    const d = next.findIndex(q => q.kind === 'autoDefenses');
    const def = next.splice(d, 1)[0];
    planet.queue = [def, ...manual, ...next];
  } else planet.queue = [...manual, ...next];
  planet.tpl = undefined;
}

/** Yearly, before production: sectors, years of service, the candidates, the orders of the governors. */
export function runGovernors(game: GameState) {
  if (!governorsOn(game)) return;
  for (const p of game.players) {
    if (p.dead || p.monster) continue;
    computeSectors(game, p);
    const seats = sectorSeats(game, p);
    refreshPool(game, p);
    // a governor whose seat is lost waits for another sector
    for (const g of p.governors ?? []) {
      if (g.seat !== undefined && !seats.some(s => s.id === g.seat)) {
        const lost = game.planets[g.seat];
        g.seat = undefined;
        if (!p.ai) p.messages.push({ year: game.year, kind: 'warning', text: `Le gouverneur ${g.name} a perdu son siège, ${lost?.name ?? '?'} : il attend un autre secteur (page Empire).`, target: { kind: 'colonies', id: 0 } });
      }
      if (g.seat !== undefined) g.xp++;
    }
    // the computers name a governor in every sector (their talents only: they run their production themselves)
    if (p.ai) {
      for (const s of seats) if (!(p.governors ?? []).some(g => g.seat === s.id) && p.govPool?.length) appoint(game, p, p.govPool[0].id, s.id);
      continue;
    }
    for (const g of p.governors ?? []) {
      if (g.seat === undefined || g.policy === 'manual') continue;
      const worlds = sectorWorlds(game, p, g.seat).filter(pl => governed(game, pl) === g);
      let alerted: Planet | undefined;
      for (const pl of worlds) {
        const threat = (g.policy === 'develop' || g.policy === 'fortify') && threatNear(game, p, pl);
        applyPolicy(pl, g.policy, threat);
        if (threat && !alerted) alerted = pl;
      }
      if (alerted && (g.alert === undefined || game.year - g.alert >= 3)) {
        g.alert = game.year;
        p.messages.push({ year: game.year, kind: 'warning', text: `Le gouverneur ${g.name} renforce les défenses de ${alerted.name} : une flotte hostile approche du secteur de ${game.planets[g.seat].name}.`, target: { kind: 'planet', id: alerted.id } });
      }
    }
  }
}

/** When the rule is switched on during a game. */
export function initGovernors(game: GameState) {
  for (const p of game.players) if (!p.monster && !p.dead) { computeSectors(game, p); refreshPool(game, p, true); }
}
