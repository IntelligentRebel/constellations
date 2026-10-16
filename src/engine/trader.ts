// The Mystery Trader: a wandering alien ship that trades technology for minerals.
import type { GameState, MysteryTrader } from './types';
import { FIELDS, MINERALS } from './types';
import { Rng } from './rng';
import { RULES_RAW } from '../data/rules-raw';
import { distance } from './fleet';
import { hasWalls, detourPoints } from './walls';
import { addResearch, MAX_TECH } from './research';
import { FIELD_NAMES } from './tech';
import { tl, TRADER_NAME } from '../data/labels';

const REWARDS = ['research', 'Engine', 'Bomb', 'Armor', 'Shield', 'Electrical', 'Mechanical', 'Torpedo', 'BeamWeapon', 'MineRobot', 'ShipHull', 'Genesis'];

export function spawnTraders(game: GameState, rng: Rng) {
  if (!game.settings.randomEvents) return;
  const years = game.year - 2400;
  if (years < 40 || years % 2 !== 0 || game.traders.length >= 2) return;
  const chances: number[] = RULES_RAW.mysteryTrader?.chanceSpawn ?? [7, 7, 7, 7, 4, 3, 2];
  if (!rng.chance(1 / chances[rng.int(chances.length)])) return;
  const W = game.width;
  const edge = rng.int(4);
  const along = 20 + rng.int(W - 40);
  const start = [{ x: -20, y: along }, { x: W + 20, y: along }, { x: along, y: -20 }, { x: along, y: W + 20 }][edge];
  const dest = [{ x: W + 20, y: 20 + rng.int(W - 40) }, { x: -20, y: 20 + rng.int(W - 40) }, { x: 20 + rng.int(W - 40), y: W + 20 }, { x: 20 + rng.int(W - 40), y: -20 }][edge];
  const warp = 7 + rng.int(6);
  let reward = rng.int(10) < (years < 100 ? 5 : 3) ? 'research' : rng.pick(REWARDS);
  if (reward === 'Genesis' && years < 150) reward = 'research';
  const t: MysteryTrader = { id: game.nextId++, x: start.x, y: start.y, destX: dest.x, destY: dest.y, warp, reward, heading: null, rewarded: [] };
  game.traders.push(t);
  // 3.3.8: no announcement to everyone from the edge of the galaxy; it hails each empire when it comes near (traderHails)
}

/** Distance (al) at which the Mystery Trader announces itself to an empire, measured from its nearest world. */
export const TRADER_HAIL = 200;

/** The empire's world nearest to the trader, if within hailing distance. */
export function hailingWorld(game: GameState, playerId: number, t: { x: number; y: number }): { name: string; d: number } | null {
  let best: { name: string; d: number } | null = null;
  for (const pl of game.planets) {
    if (pl.owner !== playerId) continue;
    const d = distance(pl, t);
    if (d <= TRADER_HAIL && (!best || d < best.d)) best = { name: pl.name, d };
  }
  return best;
}

/** Each year: the trader announces itself (once) to every empire it passes near. */
export function traderHails(game: GameState) {
  for (const t of game.traders) {
    for (const p of game.players) {
      if (p.dead || p.monster || t.hailed?.includes(p.id)) continue;
      const w = hailingWorld(game, p.id, t);
      if (!w) continue;
      (t.hailed ??= []).push(p.id);
      const dir = t.heading ? compass(t.heading) : '';
      p.messages.push({ year: game.year, kind: 'trader', text: `Un ${TRADER_NAME} s'annonce à ${Math.round(w.d)} al de ${w.name}, Warp ${t.warp}${dir ? `, ${dir}` : ''} : il ne s'arrête pas. Interceptez-le avec une flotte transportant au moins 5 000 kt de minerais pour obtenir une récompense. Tant qu'il passe à moins de ${TRADER_HAIL} al de vos mondes, il émet sa position.`, target: { kind: 'trader', id: t.id, x: Math.round(Math.max(0, Math.min(game.width, t.x))), y: Math.round(Math.max(0, Math.min(game.height, t.y))) } });
    }
  }
}

function compass(h: { x: number; y: number }): string {
  const a = (Math.atan2(h.y, h.x) * 180 / Math.PI + 360) % 360; // y grows downward: 90° is south
  return ['cap à l\'est', 'cap au sud-est', 'cap au sud', 'cap au sud-ouest', 'cap à l\'ouest', 'cap au nord-ouest', 'cap au nord', 'cap au nord-est'][Math.round(a / 45) % 8];
}

export function moveTraders(game: GameState, rng: Rng) {
  for (const t of [...game.traders]) {
    const d = distance(t, { x: t.destX, y: t.destY });
    const step = t.warp * t.warp;
    if (d <= step) {
      if (rng.chance(0.5)) {
        t.destX = 20 + rng.int(game.width - 40); t.destY = rng.chance(0.5) ? -20 : game.height + 20;
      } else { game.traders.splice(game.traders.indexOf(t), 1); continue; }
    }
    // 3.6: he knows his way around the dark clouds
    const via = hasWalls(game) ? detourPoints(game, t, { x: t.destX, y: t.destY }) : null;
    const to = via?.length ? via[0] : { x: t.destX, y: t.destY };
    const dd = distance(t, to) || 1;
    t.heading = { x: (to.x - t.x) / dd, y: (to.y - t.y) / dd };
    t.x += t.heading.x * Math.min(step, dd); t.y += t.heading.y * Math.min(step, dd);
  }
}

export function meetTraders(game: GameState, rng: Rng) {
  for (const t of game.traders) {
    for (const f of [...game.fleets]) {
      if (distance(f, t) > 2) continue;
      const player = game.players[f.owner];
      if (t.rewarded.includes(player.id)) continue;
      const minerals = f.cargo.ironium + f.cargo.boranium + f.cargo.germanium;
      if (minerals < 5000) continue;
      for (const m of MINERALS) f.cargo[m] = 0;
      t.rewarded.push(player.id);
      if (t.reward === 'research') {
        const levels = minerals >= 9800 ? 5 : minerals >= 7400 ? 4 : minerals >= 6200 ? 3 : 2;
        const gained: string[] = [];
        for (let i = 0; i < levels; i++) {
          const fields = FIELDS.filter(x => player.tech[x] < MAX_TECH);
          if (!fields.length) break;
          const fld = rng.pick(fields);
          player.tech[fld] += 1; gained.push(FIELD_NAMES[fld]);
        }
        player.messages.push({ year: game.year, kind: 'trader', text: `Le ${TRADER_NAME} a accepté vos ${minerals} kt de minerais et vous a transmis ${gained.length} niveaux de technologie (${gained.join(', ')}).`, target: { kind: 'research', id: 0 } });
      } else {
        const techs: string[] = RULES_RAW.mtTechs ?? [];
        const candidates = techs.filter(n => !player.acquiredTechs.includes(n));
        const name = candidates.length ? rng.pick(candidates) : null;
        if (name) {
          player.acquiredTechs.push(name);
          player.messages.push({ year: game.year, kind: 'trader', text: `Le ${TRADER_NAME} vous a cédé une technologie extraterrestre : ${tl(name)}.`, target: { kind: 'research', id: 0 } });
        } else addResearch(game, player, rng.pick(FIELDS), 2000);
      }
    }
  }
}
