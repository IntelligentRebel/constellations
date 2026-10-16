// 0.3.7: hidden stars. Some stars are on nobody's charts: a young star veiled by a dark cloud, cold brown dwarfs, the
// sanctuary of the Ancients, a pulsar whose beam never sweeps our way, a cluster behind a sealed wormhole, an isolated
// black hole, a star wrapped in a Dyson swarm. They are made with the galaxy (own random stream: the rest of the
// universe is the same with or without them) but join the map only when an empire finds them: by a quest (an anomaly,
// the map of the Ancients, a sealed wormhole), by a technology (deep infrared survey, gravitational interferometry, the
// Grand Observatoire) or by passing very close. The other empires do not see them until they find them too.
import type { Fleet, GameState, Hab, Minerals, Planet, Player, Secret, SecretKind, Wormhole } from './types';
import { Rng, seedFromString } from './rng';
import { fleetSpec, distance, emptyCargo } from './fleet';
import { revealPlanet } from './scan';
import { spawnGuardian, hoard, guardiansOn, guardianAt, ensureMonster, designAtTech } from './guardians';
import { hasWalls, inWall, wallAt, mainRegionTest, laneT, inPocket, regionOf } from './walls';
import { cloudAt, galaxyDensity } from './shape';
import { hasSpecial, INFRARED, LENSING, canUseWormholes, WORMHOLE_NAV } from './specials';
import { hasMega } from './megaprojects';
import { studyRate } from './anomalies';
import { specOf } from './design';
import { galaxyTech } from './factions';
import { PLANET_NAMES, generatedName } from '../data/names';
import { applyTemplate } from './production';
import { resetPlanetPolicies } from './empire';
import { people } from './words';

type Pt = { x: number; y: number };

export const SECRET_INFO: Record<SecretKind, { name: string; text: string }> = {
  veiled: { name: 'Étoile voilée', text: 'Une jeune étoile au cœur d\'un nuage sombre, dans la cavité que son rayonnement a creusée. On n\'y entre que par un étroit couloir de poussière raréfiée, à Warp 3 au plus.' },
  dwarf: { name: 'Naine brune', text: 'Une étoile avortée, trop froide pour briller : on ne la voit qu\'en infrarouge, ou en passant tout près. Son monde est riche en boranium, et l\'on fait le plein de deutérium dans son atmosphère.' },
  ancients: { name: 'Étoile des Anciens', text: 'L\'étoile où les Anciens ont bâti leur sanctuaire, effacée de toutes les cartes sauf la leur.' },
  pulsar: { name: 'Pulsar muet', text: 'Une étoile à neutrons dont le faisceau ne balaie jamais notre direction. Son monde est irradié et très riche en germanium. À moins de 40 al, les boucliers ne tiennent qu\'à moitié ; tous les cinq à dix ans, une éruption endommage les vaisseaux à moins de 35 al.' },
  pocket: { name: 'Amas caché', text: 'Quelques étoiles isolées loin de la galaxie, reliées à elle par un seul trou de ver, scellé jusqu\'à ce qu\'un empire l\'étudie assez longtemps pour l\'ouvrir.' },
  blackhole: { name: 'Trou noir isolé', text: 'Un trou noir sans compagnon, invisible sinon par la lumière qu\'il dévie. Une flotte qui part de moins de 40 al de lui gagne une demi-année de route (fronde gravitationnelle), si son empire le connaît.' },
  dyson: { name: 'Essaim de Dyson', text: 'Une étoile enfermée dans des milliards de collecteurs : aucune lumière visible, une forte source infrarouge. Une colonie installée là reçoit 200 ressources de plus par an.' },
};

/** Distance at which a ship or a colony notices a hidden star by itself (light-years). */
const NEAR: Record<SecretKind, number> = { veiled: 0, dwarf: 30, ancients: 25, pulsar: 30, pocket: 0, blackhole: 18, dyson: 30 };
export const IR_DWARF = 450, IR_DYSON = 700, LENS_RANGE = 600, OBS_LENS = 1000;
/** Study points to find the way into the veiled star, to open the sealed wormhole. */
export const PROBE_NEED = 12, OPEN_NEED = 26;
export const SLING_RANGE = 40, SLING = 1.5;
export const FLARE_RANGE = 35;
export const DYSON_BONUS = 200;
const POCKET_NAMES = ['Thulé', 'Lémurie', 'Hyperborée', 'Brocéliande', 'Cimmérie', 'Shambhala'];

export const secretsOn = (game: GameState) => !!game.settings.anomalies && !!game.secrets?.length;
export const secretOfPlanet = (game: GameState, id: number) => game.secrets?.find(s => s.ids.includes(id));
export const knowsSecret = (p: Player, s: Secret) => s.known.includes(p.id);
export const isUnknown = (p: Player, planetId: number) => !!p.intel.planets[planetId]?.unknown;
/** The worlds of a secret (once found). */
export const worldsOf = (game: GameState, s: Secret) => s.ids.map(id => game.planets[id]);
const r1 = (x: number) => Math.round(x * 10) / 10;
const hasScanner = (game: GameState, f: Fleet) => { const s = fleetSpec(game, f); return s.scanRange >= 0 || s.scanRangePen > 0; };
const say = (game: GameState, p: Player, text: string, planetId?: number, kind: 'event' | 'warning' = 'event') => p.messages.push({ year: game.year, kind, text, target: planetId !== undefined ? { kind: 'planet', id: planetId } : undefined });

// ------------------------------------------------------------------ creation

/** Makes the hidden stars of a game (at its creation, or on the first turn of an older game: `migrate`). */
export function generateSecrets(game: GameState, migrate = false) {
  const rng = new Rng(seedFromString(game.settings.seed + '|secrets'));
  const W = game.width, H = game.height, R = W / 2;
  const homes = game.planets.filter(p => p.homeworld && p.owner >= 0);
  const homeDist = (p: Pt) => homes.length ? Math.min(...homes.map(h => distance(h, p))) : W;
  const main = mainRegionTest(game);
  const taken: Pt[] = [];
  const list: Secret[] = [];
  const clearOf = (pt: Pt, clear: number) => game.planets.every(pl => Math.abs(pl.x - pt.x) > clear || Math.abs(pl.y - pt.y) > clear || distance(pl, pt) >= clear)
    && taken.every(t => distance(t, pt) >= 60) && game.wormholes.every(w => distance(w, pt) >= 20);
  const outsideClouds = (pt: Pt) => !game.shape?.walls?.length || (cloudAt(game.shape, (pt.x - R) / R, (pt.y - H / 2) / R).edge * R < -15 && (!main || main(pt.x, pt.y)));
  const spot = (minHome: number, clear: number, far = false): Pt | null => {
    for (let relax = 0; relax < 4; relax++) {
      const mh = minHome * (1 - relax * 0.3), cl = clear * (1 - relax * 0.2);
      let best: Pt | null = null, bs = -1;
      for (let t = 0; t < 400; t++) {
        const pt = { x: 25 + rng.int(W - 50), y: 25 + rng.int(H - 50) };
        if (game.shape && galaxyDensity(game, pt.x, pt.y) < 0.05) continue;
        if (homeDist(pt) < mh || !outsideClouds(pt) || !clearOf(pt, cl)) continue;
        if (!far) return pt;
        const sc = homeDist(pt);
        if (sc > bs) { bs = sc; best = pt; }
      }
      if (best) return best;
    }
    return null;
  };
  const used = new Set(game.planets.map(p => p.name));
  const pool = rng.shuffle([...new Set(PLANET_NAMES)].filter(n => !used.has(n)));
  let nk = 0;
  const nameOf = (): string => {
    let n = pool[nk++];
    for (let i = 0; !n || used.has(n); i++) n = generatedName(4000 + nk * 7 + i);
    used.add(n);
    return n;
  };
  const r = (a: number, b: number) => a + rng.int(b - a + 1);
  const world = (pt: Pt, kind: SecretKind, hab: Hab, conc: Minerals): Planet => ({
    id: -1, name: nameOf(), x: Math.round(pt.x), y: Math.round(pt.y), hab, baseHab: [...hab] as Hab, terraformed: [0, 0, 0],
    conc, mineYears: { ironium: 0, boranium: 0, germanium: 0 }, surface: { ironium: 0, boranium: 0, germanium: 0 },
    owner: -1, pop: 0, mines: 0, factories: 0, defenses: 0, scanner: false, homeworld: false,
    queue: [], leftoverOnly: false, packetWarp: 5, starbase: null, bonusResources: 0, hidden: kind,
  });
  const add = (kind: SecretKind, pt: Pt, planets: Planet[], extra: Partial<Secret> = {}): Secret => {
    const s: Secret = { id: game.nextId++, kind, name: planets[0]?.name ?? '', x: Math.round(pt.x), y: Math.round(pt.y), pending: planets, ids: [], known: [], ...extra };
    list.push(s); taken.push(pt);
    return s;
  };
  /** the free world nearest to a point, for the clue of a quest (no other anomaly, no guardian, nobody's) */
  const clueWorld = (pt: Pt, min = 0): Planet | undefined => game.planets
    .filter(pl => pl.owner < 0 && !pl.homeworld && distance(pl, pt) >= min && !game.anomalies?.some(a => a.planetId === pl.id) && !game.guardians?.some(g => g.planetId === pl.id))
    .sort((a, b) => distance(a, pt) - distance(b, pt))[0];
  const clue = (pl: Planet, kind: string) => { (game.anomalies ??= []).push({ id: game.nextId++, planetId: pl.id, kind, level: 2, known: [], progress: {} }); return pl.id; };
  const big = ({ Tiny: 0, Small: 1, Medium: 2, Large: 3, Huge: 4 } as Record<string, number>)[game.settings.size] ?? 1;

  // the Ancients: their sanctuary moves to a star of its own, as far as possible from every homeworld
  const vault = game.anomalies?.find(a => a.kind === 'vault');
  if (!migrate && vault && vault.doneBy === undefined && !vault.known.length) {
    const pt = spot(W * 0.3, 40, true);
    if (pt) {
      add('ancients', pt, [world(pt, 'ancients', [r(30, 70), r(30, 70), r(20, 60)], { ironium: r(80, 120), boranium: r(80, 120), germanium: r(80, 120) })]);
      game.anomalies = game.anomalies!.filter(a => a !== vault);
      const g = game.guardians?.find(x => x.kind === 'warden' && x.planetId === vault.planetId);
      if (g) { game.fleets = game.fleets.filter(f => f.id !== g.fleetId); game.guardians = game.guardians!.filter(x => x !== g); }
    }
  }
  // the veiled star, in the heart of a dark cloud
  if (hasWalls(game)) {
    const v = veiledSite(game, rng);
    const at = v ? clueWorld(v.lane[0]) : undefined;
    if (v && at) add('veiled', v.star, [world(v.star, 'veiled', [r(20, 80), r(30, 80), r(30, 80)], { ironium: r(100, 140), boranium: r(100, 140), germanium: r(100, 140) })],
      { lane: v.lane, laneWidth: 3, cavity: 9, zone: v.zone, tunnel: [], probe: {}, clueAt: clue(at, 'echo') });
  }
  // brown dwarfs
  const dwarfs = big === 0 ? 1 : Math.min(3, big);
  for (let i = 0; i < dwarfs; i++) {
    const pt = spot(W * 0.12, 30);
    if (pt) add('dwarf', pt, [world(pt, 'dwarf', [r(15, 50), r(1, 15), r(5, 35)], { ironium: r(40, 90), boranium: r(130, 160), germanium: r(30, 80) })]);
  }
  const pulsar = big >= 1 || rng.chance(0.5);
  if (pulsar) {
    const pt = spot(W * 0.2, 40);
    const at = pt ? clueWorld(pt, 50) : undefined;
    if (pt && at) add('pulsar', pt, [world(pt, 'pulsar', [r(40, 85), r(55, 85), r(98, 100)], { ironium: r(40, 80), boranium: r(30, 70), germanium: r(140, 160) })], { clueAt: clue(at, 'drift'), nextFlare: game.year + r(5, 9) });
  }
  if (big >= 1 || !pulsar) {
    const pt = spot(W * 0.25, 45);
    if (pt) add('blackhole', pt, [world(pt, 'blackhole', [r(95, 100), r(1, 4), r(97, 100)], { ironium: r(90, 130), boranium: r(90, 130), germanium: r(90, 130) })]);
  }
  if (big >= 2 || (big === 1 && rng.chance(0.5))) {
    const pt = spot(W * 0.3, 40);
    if (pt) add('dyson', pt, [world(pt, 'dyson', [r(10, 90), r(10, 90), r(10, 90)], { ironium: r(60, 110), boranium: r(60, 110), germanium: r(60, 110) })]);
  }
  // the cluster behind a sealed wormhole, off the map
  if (big >= 1) {
    const pt = spot(W * 0.22, 30);
    if (pt) {
      const S = Math.max(140, Math.min(240, Math.round(W * 0.2)));
      const box = { x: W + Math.max(140, Math.round(W * 0.15)), y: Math.max(20, Math.min(H - S - 20, Math.round(H / 2 - S / 2 + (rng.random() - 0.5) * H * 0.4))), w: S, h: S };
      const end = { x: box.x + 18, y: box.y + Math.round(S / 2) };
      const outcomes: Secret['outcome'][] = guardiansOn(game) ? ['virgin', 'dragon', 'enclave', 'swarm'] : ['virgin', 'enclave'];
      const outcome = outcomes[rng.int(outcomes.length)];
      const n = 3 + rng.int(3);
      const pts: Pt[] = [];
      for (let t = 0; t < 400 && pts.length < n; t++) {
        const q = { x: box.x + 22 + rng.int(S - 44), y: box.y + 22 + rng.int(S - 44) };
        if (distance(q, end) >= 30 && pts.every(o => distance(o, q) >= 32)) pts.push(q);
      }
      const good = outcome === 'virgin' || outcome === 'enclave';
      const planets = pts.map((q, k) => world(q, 'pocket', good && (outcome === 'virgin' || k === 0) ? [r(35, 65), r(35, 65), r(30, 60)] : [r(10, 90), r(10, 90), r(10, 90)],
        good ? { ironium: r(80, 125), boranium: r(80, 125), germanium: r(80, 125) } : { ironium: r(50, 115), boranium: r(50, 115), germanium: r(50, 115) }));
      const mouth: Wormhole = { id: game.nextId++, x: pt.x, y: pt.y, destId: 0, stability: 'rockSolid', yearsAtStability: 0, fixed: true, sealed: true };
      const inner: Wormhole = { id: game.nextId++, x: end.x, y: end.y, destId: mouth.id, stability: 'rockSolid', yearsAtStability: 0, fixed: true, sealed: true };
      mouth.destId = inner.id;
      game.wormholes.push(mouth, inner);
      const s = add('pocket', pt, planets, { box, mouthId: mouth.id, endId: inner.id, outcome, open: {}, raids: 0 });
      s.name = POCKET_NAMES[rng.int(POCKET_NAMES.length)];
    }
  }
  game.secrets = list;
}

/**
 * Where the veiled star can be: deep in a cloud, a short way from free space that leads somewhere. The way in is the
 * shortest way out, with two bends; the zone where to look for it is centred a little beside its mouth.
 */
function veiledSite(game: GameState, rng: Rng): { star: Pt; lane: Pt[]; zone: { x: number; y: number; r: number } } | null {
  const W = game.width, H = game.height, R = W / 2;
  const main = mainRegionTest(game);
  const edgeOf = (x: number, y: number) => cloudAt(game.shape!, (x - R) / R, (y - H / 2) / R).edge * R;
  const cands: Pt[] = [];
  for (let y = 40; y < H - 40; y += 8) for (let x = 40; x < W - 40; x += 8) if (edgeOf(x, y) >= 26) cands.push({ x, y });
  rng.shuffle(cands);
  for (const S of cands.slice(0, 80)) {
    let best: { d: number; E: Pt; M: Pt; ang: number } | null = null;
    for (let k = 0; k < 48; k++) {
      const a = k / 48 * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
      for (let d = 4; d < 140; d += 2) {
        const x = S.x + dx * d, y = S.y + dy * d;
        if (x < 15 || y < 15 || x > W - 15 || y > H - 15) break;
        if (inWall(game, x, y)) continue;
        const M = { x: Math.round(S.x + dx * (d + 9)), y: Math.round(S.y + dy * (d + 9)) };
        if (d >= 24 && M.x > 15 && M.y > 15 && M.x < W - 15 && M.y < H - 15 && !inWall(game, M.x, M.y) && edgeOf(M.x, M.y) < -6 && (!main || main(M.x, M.y)) && (!best || d < best.d))
          best = { d, E: { x: Math.round(x), y: Math.round(y) }, M, ang: a };
        break;
      }
    }
    if (!best) continue;
    const nx = -Math.sin(best.ang), ny = Math.cos(best.ang), j = Math.min(7, best.d * 0.15);
    const at = (t: number) => ({ x: Math.round(S.x + (best!.E.x - S.x) * t + nx * j * (rng.random() * 2 - 1)), y: Math.round(S.y + (best!.E.y - S.y) * t + ny * j * (rng.random() * 2 - 1)) });
    const J1 = at(1 / 3), J2 = at(2 / 3);
    let zone = { x: best.M.x + rng.int(41) - 20, y: best.M.y + rng.int(41) - 20, r: 45 };
    if (inWall(game, zone.x, zone.y) || (main && !main(zone.x, zone.y))) zone = { x: best.M.x, y: best.M.y, r: 45 };
    return { star: S, lane: [best.M, best.E, J2, J1, { ...S }], zone };
  }
  return null;
}

// ------------------------------------------------------------------ finding them

/** The worlds of a secret join the galaxy (the first time anybody finds it), with what waits there. */
function bringIn(game: GameState, s: Secret, by?: Player) {
  if (!s.pending) return;
  for (const pl of s.pending) {
    pl.id = game.planets.length;
    game.planets.push(pl);
    s.ids.push(pl.id);
    for (const o of game.players) o.intel.planets[pl.id] = { id: pl.id, unknown: true };
  }
  s.pending = undefined;
  s.foundBy = by?.id; s.foundYear = game.year;
  const pl = game.planets[s.ids[0]];
  const anomaly = (at: Planet, kind: string, level: number, hidden?: boolean) => (game.anomalies ??= []).push({ id: game.nextId++, planetId: at.id, kind, level, known: [], progress: {}, hidden });
  const guard = guardiansOn(game);
  if (s.kind === 'veiled' && guard) { hoard(pl, 2); spawnGuardian(game, pl, 'shepherd'); }
  if (s.kind === 'ancients') { anomaly(pl, 'vault', 5, true); if (guard) { hoard(pl, 3); spawnGuardian(game, pl, 'warden'); } }
  if (s.kind === 'pulsar') anomaly(pl, 'timing', 3);
  if (s.kind === 'blackhole') anomaly(pl, 'horizon', 4);
  if (s.kind === 'dyson' && guard) { hoard(pl, 3); spawnGuardian(game, pl, 'mind'); }
  if (s.kind === 'pocket') {
    const best = worldsOf(game, s).sort((a, b) => (b.conc.ironium + b.conc.boranium + b.conc.germanium) - (a.conc.ironium + a.conc.boranium + a.conc.germanium))[0];
    if (s.outcome === 'dragon' && guard) { hoard(best, 3); hoard(best, 3); spawnGuardian(game, best, 'dragon'); }
    if (s.outcome === 'swarm' && guard) { hoard(best, 2); spawnGuardian(game, best, 'nest'); s.nextRaid = game.year + 4; }
    if (s.outcome === 'enclave') anomaly(worldsOf(game, s)[0], 'enclave', 3);
  }
}

/** This empire learns where the secret is (true the first time). `full`: its worlds are analysed at once. */
export function knowSecret(game: GameState, s: Secret, p: Player, full = false): boolean {
  if (p.dead || p.monster) return false;
  bringIn(game, s, p);
  const fresh = !s.known.includes(p.id);
  if (fresh) s.known.push(p.id);
  for (const id of s.ids) {
    const pi = p.intel.planets[id];
    if (pi) delete pi.unknown;
    if (full) revealPlanet(game, p, game.planets[id], false);
  }
  if (s.kind === 'pocket' && s.mouthId !== undefined && s.endId !== undefined) {
    const a = game.wormholes.find(w => w.id === s.mouthId), b = game.wormholes.find(w => w.id === s.endId);
    if (a && b && s.openedBy !== undefined) {
      p.intel.wormholes[a.id] = { id: a.id, x: a.x, y: a.y, year: game.year, destId: b.id, stability: a.stability };
      p.intel.wormholes[b.id] = { id: b.id, x: b.x, y: b.y, year: game.year, destId: a.id, stability: b.stability };
    }
  }
  return fresh;
}

/** The anomaly that puts an empire on the track of the veiled star or the pulsar (text of the result). */
export function followClue(game: GameState, p: Player, planetId: number): string {
  const s = game.secrets?.find(x => x.clueAt === planetId);
  if (!s) return 'la piste se perd : la source s\'est tue';
  knowSecret(game, s, p);
  const pl = game.planets[s.ids[0]];
  if (s.kind === 'veiled') return `l'écho vient d'une jeune étoile cachée au cœur de ${wallAt(game, s.x, s.y) ?? 'un nuage sombre'} : ${pl.name}. Aucune route connue n'y mène. Une flotte équipée d'un scanner qui stationne dans la zone marquée sur la carte, au bord du nuage, finira par trouver un passage`;
  return `les horloges battent au rythme d'une étoile à neutrons dont le faisceau ne balaie jamais notre direction : un pulsar muet, ${pl.name}, à ${Math.round(distance(pl, game.planets[planetId]))} al d'ici. Prudence : ses éruptions endommagent les vaisseaux qui passent trop près`;
}

/** The map of the Ancients is complete: their star appears (null when this empire already knew the sanctuary). */
export function ancientsMap(game: GameState, p: Player): string | null {
  const s = game.secrets?.find(x => x.kind === 'ancients');
  if (!s) return null;
  knowSecret(game, s, p, true);
  const pl = game.planets[s.ids[0]];
  const vault = game.anomalies?.find(a => a.kind === 'vault' && a.planetId === pl.id);
  if (!vault || vault.known.includes(p.id)) return null;
  vault.known.push(p.id);
  return `le dernier fragment manquant : la carte des Anciens est complète. Elle montre une étoile qu'aucun de vos catalogues ne mentionne, ${pl.name}, où se trouve leur sanctuaire`;
}

/** The Exiles of the hidden cluster join the empire (choice of their enclave). */
export function joinEnclave(game: GameState, p: Player, pl: Planet): string | null {
  if (pl.owner >= 0) return null;
  pl.owner = p.id; pl.pop = 40000; pl.colonizedYear = game.year; pl.factories = 40; pl.mines = 40;
  resetPlanetPolicies(pl);
  pl.queue = [
    { kind: 'autoFactories', qty: 100, allocated: { ironium: 0, boranium: 0, germanium: 0, resources: 0 } },
    { kind: 'autoMines', qty: 100, allocated: { ironium: 0, boranium: 0, germanium: 0, resources: 0 } },
  ];
  if (p.defaultTemplate >= 0) applyTemplate(game, pl, p.defaultTemplate);
  p.stats.planetsColonized++;
  revealPlanet(game, p, pl);
  return `les Exilés rejoignent votre empire : ${pl.name} devient une de vos colonies, avec ${people(game, pl.pop)} habitants, 40 usines et 40 mines`;
}

/** A fleet came out of a wormhole: into the hidden cluster? */
export function secretArrival(game: GameState, f: Fleet) {
  const s = game.secrets?.find(x => x.kind === 'pocket');
  if (!s || !inPocket(game, f)) return;
  const p = game.players[f.owner];
  if (knowSecret(game, s, p)) say(game, p, `${f.name} débouche dans l'amas de ${s.name} : ${s.ids.length} étoiles inconnues, très loin de toute autre. Seul le trou de ver relie l'amas à la galaxie.`, s.ids[0]);
}

// ------------------------------------------------------------------ every year

/** Yearly: detection, the search for the way into the veiled star, the opening of the sealed wormhole, flares, raids. */
export function runSecrets(game: GameState, rng: Rng) {
  if (!game.settings.anomalies) return;
  if (!game.secrets) generateSecrets(game, true);
  if (!game.secrets!.length) return;
  for (const p of game.players) {
    if (p.dead || p.monster) continue;
    detect(game, p);
    probe(game, p);
    openPocket(game, p);
  }
  flares(game, rng);
  raids(game, rng);
}

/** Colonies with a Dyson swarm: the collectors feed them (after the yearly reset of the bonus). */
export function secretBonus(game: GameState) {
  for (const s of game.secrets ?? []) {
    if (s.kind !== 'dyson') continue;
    for (const pl of worldsOf(game, s)) if (pl.owner >= 0 && pl.pop > 0) pl.bonusResources += DYSON_BONUS;
  }
}

const KIND_PHRASE: Record<SecretKind, string> = {
  veiled: 'une étoile voilée', dwarf: 'une naine brune', ancients: 'une étoile que ne mentionne aucun catalogue', pulsar: 'un pulsar muet', pocket: 'un amas caché',
  blackhole: 'un trou noir isolé', dyson: 'une étoile enfermée dans un essaim de Dyson',
};

function detect(game: GameState, p: Player) {
  const own = game.planets.filter(pl => pl.owner === p.id && pl.pop > 0);
  const fleets = game.fleets.filter(f => f.owner === p.id && f.tokens.length > 0);
  const ir = hasSpecial(p, INFRARED), lens = hasSpecial(p, LENSING);
  const obs = own.filter(pl => hasMega(pl, 'observatory'));
  const nearest = (list: Planet[], at: Pt, max: number) => { let b: Planet | undefined, bd = max; for (const pl of list) { const d = distance(pl, at); if (d <= bd) { bd = d; b = pl; } } return b; };
  for (const s of game.secrets ?? []) {
    if (s.known.includes(p.id)) continue;
    const at = { x: s.x, y: s.y };
    let text: string | null = null;
    if (s.kind === 'pocket') {
      const f = s.ids.length ? fleets.find(x => inPocket(game, x)) : undefined;
      if (f) text = `${f.name} se trouve dans l'amas de ${s.name}, très loin de la galaxie : ${s.ids.length} étoiles que ne relie à elle qu'un trou de ver.`;
    } else if (s.kind === 'veiled') {
      const f = fleets.find(x => distance(x, at) <= (s.cavity ?? 9) + 2);
      if (f) text = `${f.name} a trouvé une étoile au cœur du nuage : ${s.name}.`;
    } else {
      const near = NEAR[s.kind];
      const f = fleets.find(x => distance(x, at) <= near);
      const c = f ? undefined : nearest(own, at, near);
      if (f || c) text = `En passant à ${Math.round(distance(f ?? c!, at))} al de ${s.name}, ${f ? f.name : `la colonie de ${c!.name}`} a découvert ${KIND_PHRASE[s.kind]}, invisible de plus loin.`;
      if (!text && ir && (s.kind === 'dwarf' || s.kind === 'dyson')) {
        const pl = nearest(own, at, s.kind === 'dwarf' ? IR_DWARF : IR_DYSON);
        if (pl) text = s.kind === 'dwarf'
          ? `Relevé infrarouge : une naine brune, trop froide pour briller, à ${Math.round(distance(pl, at))} al de ${pl.name}. Son monde, ${s.name}, n'a jamais été exploré ; on peut y refaire le plein de carburant.`
          : `Relevé infrarouge : une puissante source infrarouge sans étoile visible, à ${Math.round(distance(pl, at))} al de ${pl.name}. Vos astronomes y voient une étoile enfermée dans un essaim de Dyson : ${s.name}.`;
      }
      if (!text && s.kind === 'blackhole') {
        const o = nearest(obs, at, OBS_LENS);
        const pl = o ? undefined : lens ? nearest(own, at, LENS_RANGE) : undefined;
        if (o) text = `Le Grand Observatoire de ${o.name} a surpris la lumière d'étoiles lointaines déviée par une masse invisible : un trou noir isolé, ${s.name}, à ${Math.round(distance(o, at))} al.`;
        else if (pl) text = `Interférométrie gravitationnelle : une distorsion de l'espace trahit un trou noir isolé, ${s.name}, à ${Math.round(distance(pl, at))} al de ${pl.name}.`;
      }
    }
    if (!text) continue;
    knowSecret(game, s, p);
    if (!p.ai) say(game, p, text, s.ids[0]);
  }
}

/** The way into the veiled star: ships with a scanner stationed in the zone sound the cloud. */
function probe(game: GameState, p: Player) {
  for (const s of game.secrets ?? []) {
    if (s.kind !== 'veiled' || !s.zone || !s.known.includes(p.id) || s.tunnel?.includes(p.id)) continue;
    const z = s.zone;
    const fl = game.fleets.filter(f => f.owner === p.id && f.waypoints.length <= 1 && distance(f, z) <= z.r && hasScanner(game, f));
    if (!fl.length) continue;
    const rate = studyRate(game, p, fl.length, false, fl.some(f => fleetSpec(game, f).scanRangePen > 0));
    s.probe ??= {};
    s.probe[p.id] = r1((s.probe[p.id] ?? 0) + rate);
    if (s.probe[p.id] < PROBE_NEED) continue;
    (s.tunnel ??= []).push(p.id);
    const pl = game.planets[s.ids[0]];
    if (!p.ai) say(game, p, `${fl[0].name} a trouvé le passage : un couloir de poussière raréfiée traverse ${wallAt(game, s.x, s.y) ?? 'le nuage'} jusqu'à ${pl.name}. On y vole à Warp 3 au plus. Le couloir est tracé sur votre carte.`, pl.id);
  }
}

/** Points per year a fleet group would put into sounding the cloud (for the interface). */
export function probeFleets(game: GameState, p: Player, s: Secret): Fleet[] {
  if (!s.zone) return [];
  const z = s.zone;
  return game.fleets.filter(f => f.owner === p.id && f.waypoints.length <= 1 && distance(f, z) <= z.r && hasScanner(game, f));
}

/** What a stopped fleet is doing for a hidden star: sounding the cloud, studying the seal (share done), or null. */
export function secretStudyOf(game: GameState, f: Fleet): { kind: 'probe' | 'seal'; s: Secret; pct: number } | null {
  if (!game.secrets?.length || f.waypoints.length > 1) return null;
  const p = game.players[f.owner];
  for (const s of game.secrets) {
    if (s.kind === 'veiled' && s.zone && s.known.includes(p.id) && !s.tunnel?.includes(p.id) && probeFleets(game, p, s).includes(f)) return { kind: 'probe', s, pct: Math.min(1, (s.probe?.[p.id] ?? 0) / PROBE_NEED) };
    if (s.kind === 'pocket' && game.wormholes.find(w => w.id === s.mouthId)?.sealed && sealFleets(game, p, s).includes(f)) return { kind: 'seal', s, pct: Math.min(1, (s.open?.[p.id] ?? 0) / OPEN_NEED) };
  }
  return null;
}

/** Fleets studying the sealed wormhole (stopped at its mouth, with a scanner). */
export function sealFleets(game: GameState, p: Player, s: Secret): Fleet[] {
  const mouth = game.wormholes.find(w => w.id === s.mouthId);
  if (!mouth) return [];
  return game.fleets.filter(f => f.owner === p.id && f.waypoints.length <= 1 && distance(f, mouth) <= 1.5 && hasScanner(game, f));
}

function openPocket(game: GameState, p: Player) {
  const s = game.secrets?.find(x => x.kind === 'pocket');
  const mouth = s ? game.wormholes.find(w => w.id === s.mouthId) : undefined;
  if (!s || !mouth?.sealed) return;
  const fl = sealFleets(game, p, s);
  if (!fl.length) return;
  if (!canUseWormholes(p)) {
    p.intel.warned ??= {};
    const key = `seal${s.id}`;
    if (p.intel.warned[key] === undefined && !p.ai) say(game, p, `${fl[0].name} observe le trou de ver scellé, mais vos scientifiques n'y comprennent rien sans « ${WORMHOLE_NAV.name} ».`, undefined, 'warning');
    p.intel.warned[key] = game.year;
    return;
  }
  const rate = studyRate(game, p, fl.length, false, fl.some(f => fleetSpec(game, f).scanRangePen > 0));
  s.open ??= {};
  s.open[p.id] = r1((s.open[p.id] ?? 0) + rate);
  if (s.open[p.id] < OPEN_NEED) return;
  const inner = game.wormholes.find(w => w.id === s.endId);
  mouth.sealed = false;
  if (inner) inner.sealed = false;
  s.openedBy = p.id;
  knowSecret(game, s, p);
  if (s.outcome === 'swarm' && s.nextRaid !== undefined) s.nextRaid = Math.max(s.nextRaid, game.year + 3);
  if (!p.ai) say(game, p, `${fl[0].name} a ouvert le trou de ver scellé. De l'autre côté, loin de la galaxie : ${s.ids.length} étoiles inconnues, l'amas de ${s.name}. Une flotte qui franchit le trou de ver y arrive.`, s.ids[0]);
  for (const o of game.players) {
    if (o.id === p.id || o.dead || o.monster || o.ai || !o.intel.wormholes[mouth.id]) continue;
    o.messages.push({ year: game.year, kind: 'wormhole', text: `Le trou de ver scellé en (${Math.round(mouth.x)}, ${Math.round(mouth.y)}) s'est ouvert : les ${p.name} l'ont forcé.`, target: { kind: 'wormhole', id: mouth.id } });
  }
}

/** The pulsar's flares: every five to ten years, the ships near it are hit (and learn where it is). */
function flares(game: GameState, rng: Rng) {
  for (const s of game.secrets ?? []) {
    if (s.kind !== 'pulsar') continue;
    if (s.nextFlare === undefined) s.nextFlare = game.year + 5 + rng.int(5);
    if (game.year < s.nextFlare) continue;
    s.nextFlare = game.year + 5 + rng.int(6);
    const hit = game.fleets.filter(f => !game.players[f.owner]?.monster && f.tokens.length > 0 && distance(f, s) <= FLARE_RANGE);
    for (const f of hit) {
      for (const t of f.tokens) {
        const armor = specOf(game, t.designId).armor;
        t.damage = Math.min(Math.max(1, armor - 1), t.damage + Math.round(armor * 0.25));
        t.qtyDamaged = t.qty;
      }
      const p = game.players[f.owner];
      const fresh = knowSecret(game, s, p);
      if (p.ai) continue;
      say(game, p, fresh
        ? `Une bouffée de rayonnement venue de nulle part a endommagé ${f.name} : un pulsar invisible jusqu'ici, ${s.name}, à ${Math.round(distance(f, s))} al.`
        : `Éruption du pulsar ${s.name} : ${f.name}, à ${Math.round(distance(f, s))} al, est endommagé.`, s.ids[0], 'warning');
    }
  }
}

/** The Nest of the hidden cluster sends a swarm through the wormhole every few years while it lives. */
function raids(game: GameState, rng: Rng) {
  for (const f of game.fleets) if (f.purpose === 'guardian:raider') f.fuel = fleetSpec(game, f).fuelCapacity;
  const s = game.secrets?.find(x => x.kind === 'pocket' && x.outcome === 'swarm');
  if (!s || s.openedBy === undefined || s.nextRaid === undefined || game.year < s.nextRaid) return;
  const nest = game.guardians?.find(g => g.kind === 'nest' && s.ids.includes(g.planetId));
  if (!nest || !guardianAt(game, nest.planetId)) { s.nextRaid = undefined; return; }
  s.nextRaid = game.year + 6 + rng.int(4);
  const mouth = game.wormholes.find(w => w.id === s.mouthId);
  if (!mouth) return;
  let target: Planet | undefined, bd = 500;
  for (const pl of game.planets) {
    if (pl.owner < 0 || game.players[pl.owner]?.monster || pl.pop <= 0) continue;
    const d = distance(pl, mouth);
    if (d < bd) { bd = d; target = pl; }
  }
  if (!target) return;
  const m = ensureMonster(game);
  const tech = Math.max(8, Math.min(24, Math.round(galaxyTech(game)) + 2));
  const key = `raider:${tech}`;
  let d = game.designs.find(x => x.owner === m.id && x.purpose === key);
  if (!d) {
    const nd = designAtTech(m, tech, 'Destroyer', 'torpedoWarship', 'Nuée de l\'amas');
    if (!nd) return;
    nd.purpose = key; nd.alien = true; nd.id = game.nextId++;
    game.designs.push(nd);
    d = nd;
  }
  const qty = Math.min(16, 5 + 2 * (s.raids ?? 0));
  s.raids = (s.raids ?? 0) + 1;
  m.fleetNum++;
  const f: Fleet = {
    id: game.nextId++, owner: m.id, num: m.fleetNum, name: 'Nuée de l\'amas', customName: true, x: mouth.x, y: mouth.y, orbiting: -1,
    tokens: [{ designId: d.id, qty, damage: 0, qtyDamaged: 0 }], cargo: emptyCargo(), fuel: 0,
    waypoints: [{ x: mouth.x, y: mouth.y, target: 'space', warp: 0, task: 'none', processed: true }, { x: target.x, y: target.y, target: 'planet', targetId: target.id, warp: 7, task: 'none' }],
    repeat: false, battlePlan: 0, heading: null, lastWarp: 0, age: 0, purpose: 'guardian:raider',
  };
  game.fleets.push(f);
  f.fuel = fleetSpec(game, f).fuelCapacity;
  for (const p of game.players) {
    if (p.dead || p.monster || p.ai) continue;
    if (p.id === target.owner) say(game, p, `Une nuée de ${qty} chasseurs a jailli du trou de ver de l'amas de ${s.name} et fonce vers ${target.name}. Tant que le Nid de la nuée vivra, d'autres suivront.`, target.id, 'warning');
    else if (p.intel.wormholes[mouth.id] || s.known.includes(p.id)) p.messages.push({ year: game.year, kind: 'wormhole', text: `Une nuée de ${qty} chasseurs a jailli du trou de ver de l'amas de ${s.name}, en direction des ${game.players[target.owner].name}.`, target: { kind: 'wormhole', id: mouth.id } });
  }
}

// ------------------------------------------------------------------ effects and rules

/** 0.3.7 fronde: a fleet leaving from near a black hole its empire knows gains half a year of travel. */
export function slingshot(game: GameState, owner: number, at: Pt): number {
  for (const s of game.secrets ?? []) if (s.kind === 'blackhole' && s.ids.length && s.known.includes(owner) && distance(at, s) <= SLING_RANGE) return SLING;
  return 1;
}

/** Can this empire's ships get there by ordinary flight (the veiled star needs its way in, the cluster its wormhole)? */
export function reachable(game: GameState, p: Player, pl: Planet): boolean {
  if (p.intel.planets[pl.id]?.unknown) return false;
  if (pl.hidden === 'pocket') return false;
  if (pl.hidden === 'veiled') return !!secretOfPlanet(game, pl.id)?.tunnel?.includes(p.id);
  return true;
}

/**
 * The wormhole step a route needs between these two points (one in the hidden cluster, the other in the galaxy),
 * for an empire that knows the cluster; null when none is needed or it is still sealed.
 */
export function pocketGate(game: GameState, p: Player, a: Pt, b: Pt): Wormhole | null {
  const s = game.secrets?.find(x => x.kind === 'pocket' && x.known.includes(p.id));
  if (!s) return null;
  const ra = regionOf(game, a), rb = regionOf(game, b);
  if (ra === rb || ra < 0 || rb < 0) return null;
  const w = game.wormholes.find(x => x.id === (ra === 0 ? s.mouthId : s.endId));
  return w && !w.sealed ? w : null;
}

/** Where a fleet is on the way into a veiled star (for the interface), or null. */
export function onLane(game: GameState, at: Pt): Secret | null {
  for (const s of game.secrets ?? []) if (s.lane && laneT(s, at) >= 0 && inWall(game, at.x, at.y)) return s;
  return null;
}
