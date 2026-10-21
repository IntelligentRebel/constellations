// 0.3.9: multiplayer by turn files, as Stars! played by e-mail. A host holds the game; every year it gives each human
// player a turn file (the whole game, seen as that player), the players give their orders at home and send back an
// orders file, the host merges them and generates the year. The merge is a three-way merge: the host keeps the
// fingerprint of every object as it was when the turn files were made, and takes from a player's file what that
// player changed (their worlds, fleets, designs, and what their diplomacy changed between empires). Ids created by a
// player come from a range of their own, so two players never create the same id. The files hold the whole game:
// a game between friends who trust each other.
import { deflateSync, inflateSync, strToU8, strFromU8 } from 'fflate';
import type { Cargo, Fleet, GameState, Minerals, PbemApplied, PbemBase, PbemContains, ShipDesign } from './types';

export const TURN_FORMAT = 'constellations-turn';
export const ORDERS_FORMAT = 'constellations-orders';
/** each player creates ids in a range of their own, this wide */
export const ID_STRIDE = 100_000;

export const pbemHumans = (g: GameState) => g.players.filter(p => !p.ai && !p.monster && !p.dead).map(p => p.id);

/** FNV-1a over the JSON of an object: a short fingerprint. */
export function fingerprint(o: unknown): string {
  const s = JSON.stringify(o) ?? '';
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36) + s.length.toString(36);
}

export function baseOf(g: GameState): PbemBase {
  const map = <T extends { id: number }>(list: T[]) => Object.fromEntries(list.map(x => [x.id, fingerprint(x)]));
  return {
    nextId: g.nextId,
    surface: Object.fromEntries(g.planets.map(p => [p.id, { ...p.surface }])),
    holds: Object.fromEntries(g.fleets.map(f => [f.id, { cargo: { ...f.cargo }, fuel: f.fuel }])),
    salvage: Object.fromEntries((g.salvage ?? []).map(x => [x.id, { ...x.cargo }])),
    planets: Object.fromEntries(g.planets.map(p => [p.id, fingerprint(p)])),
    fleets: map(g.fleets),
    designs: map(g.designs),
    pairs: Object.fromEntries(Object.entries(g.diplomacy?.pairs ?? {}).map(([k, v]) => [k, fingerprint(v)])),
    chains: map(g.chains ?? []),
    proposals: (g.diplomacy?.proposals ?? []).map(p => p.id),
  };
}

/** Turns this game into a hosted one (the host does not play: each human plays from turn files). */
export function startHosting(g: GameState) {
  g.pbem = { role: 'host', hostId: Math.random().toString(36).slice(2, 10), turn: g.year, base: undefined, received: {} };
  prepareTurn(g);
}

/** Before the host generates the year: the ids it creates come after every player's range. */
export function beforeGenerate(g: GameState) {
  const B = g.pbem?.base;
  if (B) g.nextId = Math.max(g.nextId, B.nextId + (g.players.length + 1) * ID_STRIDE);
}

/** After a year was generated (or at the start): the fingerprints the next merges compare with. */
export function prepareTurn(g: GameState) {
  if (g.pbem?.role !== 'host') return;
  g.pbem.turn = g.year;
  g.pbem.base = baseOf(g);
  g.pbem.received = {};
  g.pbem.applied = {};
  g.pbem.gone = [];
  g.submitted = [];
}

// -------------------------------------------------------------------------------------------- files

function pack(o: unknown): string {
  const u8 = deflateSync(strToU8(JSON.stringify(o)), { level: 6 });
  let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(bin);
}
function unpack(s: string): any {
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return JSON.parse(strFromU8(inflateSync(u8)));
}

export interface PbemHeader { format: string; version: 1; hostId: string; year: number; player: number; game: string; empire: string }
export interface PbemFile extends PbemHeader { data: string }

/** The turn file of a human player: the whole game, as that player, ids in their own range. */
export function turnFile(g: GameState, pid: number, hostSlot?: string): PbemFile {
  const P = g.pbem!;
  const copy: GameState = JSON.parse(JSON.stringify(g));
  copy.human = pid;
  copy.submitted = [];
  // (0.3.9.21: after the player's orders were merged, a new turn file goes on from where their ids had got to: it gave
  // the same ids again, and a second split lost a ship)
  copy.nextId = Math.max(P.base!.nextId + (pid + 1) * ID_STRIDE, P.applied?.[pid]?.nextId ?? 0);
  // (0.3.9.21: a turn file made after some orders were merged holds them: its orders must not count them again)
  const contains: PbemContains = {
    applied: JSON.parse(JSON.stringify(P.applied ?? {})),
    surface: Object.fromEntries(g.planets.map(p => [p.id, { ...p.surface }])),
    holds: Object.fromEntries(g.fleets.map(x => [x.id, { cargo: { ...x.cargo }, fuel: x.fuel }])),
    free: Object.fromEntries(g.planets.filter(p => p.owner < 0).map(p => [p.id, fingerprint({ ...p, surface: P.base!.surface?.[p.id] ?? p.surface })])),
    pairs: Object.fromEntries(Object.entries(g.diplomacy?.pairs ?? {}).map(([k, v]) => [k, fingerprint(v)])),
    chains: Object.fromEntries((g.chains ?? []).map(c => [c.id, fingerprint(c)])),
    salvage: Object.fromEntries((g.salvage ?? []).map(x => [x.id, { ...x.cargo }])),
    proposals: (g.diplomacy?.proposals ?? []).map(p => p.id),
    msgs: g.players[pid].messages.filter(m => m.year === g.year).map(m => m.text),
  };
  copy.pbem = { role: 'player', hostId: P.hostId, turn: g.year, player: pid, hostSlot, contains };
  // the other humans' reports are theirs
  for (const o of copy.players) if (o.id !== pid && !o.ai && !o.monster) o.messages = [];
  delete (copy as { id?: string }).id;
  return { format: TURN_FORMAT, version: 1, hostId: P.hostId, year: g.year, player: pid, game: g.name, empire: g.players[pid].name, data: pack(copy) };
}

/** The orders file of a player: their copy of the game after their orders. */
export function ordersFile(g: GameState): PbemFile {
  const P = g.pbem!;
  const pid = P.player!;
  const copy = JSON.parse(JSON.stringify(g));
  delete copy.id;
  return { format: ORDERS_FORMAT, version: 1, hostId: P.hostId, year: P.turn, player: pid, game: g.name, empire: g.players[pid].name, data: pack(copy) };
}

export function fileName(f: PbemHeader): string {
  // (0.3.9.21: letters of any script: in Russian, Chinese, Japanese or Korean every empire got the same file name)
  const safe = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  return `${safe(f.game) || 'partie'}-${f.year}-${safe(f.empire) || 'empire-' + (f.player + 1)}.${f.format === TURN_FORMAT ? 'tour' : 'ordres'}.json`;
}

/** Reads a turn or orders file (null: not one). */
export function readPbem(text: string): { file: PbemFile; game: GameState } | null {
  let o: PbemFile;
  try { o = JSON.parse(text); } catch { return null; }
  if (!o || (o.format !== TURN_FORMAT && o.format !== ORDERS_FORMAT) || typeof o.data !== 'string') return null;
  // (0.3.9.21: a damaged file is not one either: it threw, and the files after it were never read)
  let game: GameState;
  try { game = unpack(o.data) as GameState; } catch { return null; }
  if (!game || !Array.isArray(game.players) || !Array.isArray(game.planets) || !Array.isArray(game.fleets)) return null;
  return { file: o, game };
}

/** A player opens a turn file: the game, locked to that player, in a save slot of its own (the turn after replaces it). */
export function openTurn(file: PbemFile, game: GameState): GameState {
  game.pbem = { ...game.pbem!, role: 'player', player: file.player, turn: file.year };
  (game as { id?: string }).id = `pbem-${file.hostId}-${file.player}`;
  return game;
}

// -------------------------------------------------------------------------------------------- the merge

/** Why the host cannot take this orders file (null: it can). */
export function ordersBlocker(host: GameState, file: PbemFile): string | null {
  const P = host.pbem;
  if (!P || P.role !== 'host') return 'cette partie n\'est pas hébergée ici';
  if (file.format !== ORDERS_FORMAT) return 'ce n\'est pas un fichier d\'ordres';
  if (file.hostId !== P.hostId) return 'ces ordres viennent d\'une autre partie';
  if (file.year !== P.turn) return file.year < P.turn ? `ces ordres sont ceux de ${file.year}, l'année est ${P.turn}` : `ces ordres sont pour ${file.year}, l'année n'est que ${P.turn}`;
  if (!pbemHumans(host).includes(file.player)) return 'cet empire ne joue pas par fichiers';
  return null;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const MINS = ['ironium', 'boranium', 'germanium'] as const;
const zeroM = (): Minerals => ({ ironium: 0, boranium: 0, germanium: 0 });
const diffM = (a: Minerals, b: Minerals): Minerals => ({ ironium: a.ironium - b.ironium, boranium: a.boranium - b.boranium, germanium: a.germanium - b.germanium });
const addM = (to: Minerals, d: Minerals, k = 1) => { for (const m of MINS) to[m] = Math.max(0, to[m] + k * d[m]); };
const anyM = (d: Minerals) => MINS.some(m => d[m] !== 0);
/** Adds d, never below zero; returns what was really added (less, when something was taken twice). */
const applyM = (to: Minerals, d: Minerals): Minerals => { const out = zeroM(); for (const m of MINS) { const v = Math.max(0, to[m] + d[m]); out[m] = v - to[m]; to[m] = v; } return out; };
const sumM = (list: (Minerals | undefined)[]): Minerals => { const s = zeroM(); for (const d of list) if (d) for (const m of MINS) s[m] += d[m]; return s; };
const sumH = (list: (Hold | undefined)[]): Hold => { const s: Hold = { cargo: { ...zeroM(), colonists: 0 }, fuel: 0 }; for (const d of list) if (d) { for (const m of MINS) s.cargo[m] += d.cargo[m]; s.cargo.colonists += d.cargo.colonists; s.fuel += d.fuel; } return s; };
type Hold = { cargo: Cargo; fuel: number };
const diffH = (a: Hold, b: Hold): Hold => ({ cargo: { ...diffM(a.cargo, b.cargo), colonists: a.cargo.colonists - b.cargo.colonists }, fuel: a.fuel - b.fuel });
const addH = (f: Fleet, d: Hold, k = 1) => { addM(f.cargo, d.cargo, k); f.cargo.colonists = Math.max(0, f.cargo.colonists + k * d.cargo.colonists); f.fuel = Math.max(0, f.fuel + k * d.fuel); };
const anyH = (d: Hold) => anyM(d.cargo) || d.cargo.colonists !== 0 || d.fuel !== 0;

/**
 * Merges a player's orders into the host's game. Returns an error or null.
 *
 * 0.3.9.21: the player's own worlds, fleets and designs are taken as they are in the file (compared with the base,
 * a file sent again could not put anything back: the cancelled ships were built all the same). On the objects of
 * others, only what the orders moved is taken, as a difference: minerals given or loaded on another's world, cargo
 * passed to another's fleet, a wreck loaded or filled (the whole world was taken, which made or destroyed minerals and
 * wiped its owner's orders when the files came in a given order; wrecks were not merged at all). What the others'
 * orders did to this player's objects is kept when theirs are taken; a file sent again first takes back the
 * differences of the one before it. Troops landed by hand, guardians woken, and the borders a computer opened or the
 * grudges it took against this player come along too.
 */
export function mergeOrders(host: GameState, file: PbemFile, f: GameState): string | null {
  const err = ordersBlocker(host, file);
  if (err) return err;
  const P = host.pbem!, B = P.base!, pid = file.player;
  if (!f.players?.[pid]) return 'ce fichier ne contient pas cet empire';
  const A = (P.applied ??= {});
  // what the turn file of these orders already held of the merges made before it (0.3.9.21)
  const C = f.pbem?.contains;
  const inFile = (q: number) => C?.applied[q];
  // what this player's previous file of the year did to the others' objects is taken back
  const prev = A[pid];
  const unmade = new Map<number, NonNullable<GameState['salvage']>[number]>();
  if (prev) {
    for (const [id, d] of Object.entries(prev.planets)) { const pl = host.planets[+id]; if (pl) addM(pl.surface, d, -1); }
    for (const [id, d] of Object.entries(prev.fleets)) { const fl = host.fleets.find(x => x.id === +id); if (fl) addH(fl, d, -1); }
    for (const [id, d] of Object.entries(prev.salvage)) { const w = (host.salvage ?? []).find(x => x.id === +id); if (w) addM(w.cargo, d, -1); }
    for (const x of host.salvage ?? []) if (prev.created.includes(x.id)) unmade.set(x.id, x);
    host.salvage = (host.salvage ?? []).filter(x => !prev.created.includes(x.id));
  }
  // the player's own reports in this file: not those its turn file already had from the others' merges
  const othersMsgs = (C?.msgs ?? []).filter(t => !C?.applied[pid]?.msgs?.includes(t));
  const cur: PbemApplied = { planets: {}, fleets: {}, salvage: {}, created: [], nextId: f.nextId, msgs: f.players[pid].messages.filter(m => m.year === P.turn && !othersMsgs.includes(m.text)).map(m => m.text) };
  const otherIds = Object.keys(A).map(Number).filter(q => q !== pid);
  // for an object the player's file holds whole: what the others did to it that the file does not hold yet
  const missingM = (pick: (a: PbemApplied) => Minerals | undefined) => sumM(otherIds.flatMap(q => { const a = pick(A[q]), c = inFile(q) ? pick(inFile(q)!) : undefined; return [a, c ? diffM(zeroM(), c) : undefined]; }));
  const missingH = (pick: (a: PbemApplied) => Hold | undefined) => sumH(otherIds.flatMap(q => { const a = pick(A[q]), c = inFile(q) ? pick(inFile(q)!) : undefined; return [a, c ? diffH({ cargo: { ...zeroM(), colonists: 0 }, fuel: 0 }, c) : undefined]; }));
  // minerals the player took from a world or a wreck that someone else had emptied already: taken from its own holds
  const short: { x: number; y: number; d: Minerals }[] = [];
  const took = (x: number, y: number, want: Minerals, got: Minerals) => {
    const d = diffM(got, want);
    if (anyM(d)) short.push({ x, y, d });
  };
  // the player
  const keepAi = host.players[pid].ai;
  // the reports the others' orders sent this player since its turn file
  // (not those of this player's previous file of the year: the new one stands in for it)
  const keepMsgs = host.players[pid].messages.filter(m => m.year === P.turn && !prev?.msgs?.includes(m.text) && !f.players[pid].messages.some(x => x.year === m.year && x.text === m.text));
  host.players[pid] = f.players[pid];
  host.players[pid].ai = keepAi;
  host.players[pid].messages.push(...keepMsgs);
  // empires (monsters) the player's orders brought in: a guardian woken by a decision
  for (let i = host.players.length; i < f.players.length; i++) if (f.players[i]?.monster) host.players[i] = f.players[i];
  // what the player's actions told the others
  for (const o of host.players) {
    if (o.id === pid) continue;
    for (const m of f.players[o.id]?.messages ?? []) if (m.year === P.turn && !o.messages.some(x => x.year === m.year && x.text === m.text)) o.messages.push(m);
    // a computer's borders opened to the player (a request it accepted), the grudge it took (a war declared)
    const fo = f.players[o.id];
    if (o.ai && fo) {
      const closedNow = !!fo.closed?.includes(pid), closedHere = !!o.closed?.includes(pid);
      if (closedNow !== closedHere) o.closed = closedNow ? [...(o.closed ?? []), pid] : (o.closed ?? []).filter(x => x !== pid);
      if (fo.bordersSet?.includes(pid) && !o.bordersSet?.includes(pid)) (o.bordersSet ??= []).push(pid);
      const gr = fo.grudges?.[pid];
      if (gr !== undefined && gr > (o.grudges?.[pid] ?? 0)) (o.grudges ??= {})[pid] = gr;
    }
  }
  // worlds
  for (const p of f.planets) {
    const h = host.planets[p.id];
    if (!h) continue;
    if (p.owner === pid) {
      // theirs, with what the others' orders gave or took there (and the file does not hold yet)
      // (what another took there that this player had taken away meanwhile comes out of this player's holds)
      const want = missingM(a => a.planets[p.id]);
      if (anyM(want)) took(p.x, p.y, want, applyM(p.surface, want));
      host.planets[p.id] = p;
      continue;
    }
    const bs = B.surface?.[p.id];
    if (!bs) { if (fingerprint(p) !== B.planets[p.id]) host.planets[p.id] = p; continue; } // (a base made before 0.3.9.21)
    // what the player did there since its turn file was made (with what it had done before, if the file held it)
    const d = sumM([diffM(p.surface, C?.surface[p.id] ?? bs), C?.applied[pid]?.planets[p.id]]);
    if (anyM(d)) {
      const got = applyM(h.surface, d);
      if (anyM(got)) cur.planets[p.id] = got;
      took(p.x, p.y, d, got);
    }
    // a free world may have changed otherwise (a decision about its anomaly): those changes are taken, not its minerals
    if (p.owner < 0 && h.owner < 0 && fingerprint({ ...p, surface: bs }) !== (C?.free[p.id] ?? B.planets[p.id])) host.planets[p.id] = { ...p, surface: h.surface };
  }
  // fleets: theirs as they are now (with what the others put in or took from their holds), others' as differences
  const fids = new Set(f.fleets.map(x => x.id));
  // a fleet of this player gone from its file (merged into another): what the others put in it is kept, on the fleet
  // of this player that took it in, or on the world below (0.3.9.21: it was lost)
  const parkOn = (x: number, y: number, orbiting: number | undefined, owner: number): { kind: 'fleet' | 'planet'; id: number } | null => {
    const before = (fl: Fleet) => { const h = C?.holds[fl.id] ?? B.holds?.[fl.id]; return h ? h.cargo.ironium + h.cargo.boranium + h.cargo.germanium + h.cargo.colonists : 0; };
    const grew = (fl: Fleet) => cargoMassOf(fl) - before(fl);
    const fl = (owner === pid ? f.fleets : host.fleets).filter(o => o.owner === owner && Math.abs(o.x - x) < 1 && Math.abs(o.y - y) < 1).sort((a, b) => grew(b) - grew(a))[0];
    if (fl) return { kind: 'fleet', id: fl.id };
    if (orbiting !== undefined && orbiting >= 0) return { kind: 'planet', id: orbiting };
    return null;
  };
  for (const gone of host.fleets.filter(x => x.owner === pid && !fids.has(x.id))) {
    for (const q of otherIds) {
      const d = A[q].fleets[gone.id];
      if (!d) continue;
      const at = parkOn(gone.x, gone.y, gone.orbiting, pid);
      if (!at) continue;
      // the other player's record follows the minerals (so that its own file sent again takes them back from there);
      // what the file already held of it is in the fleet that took it in
      const held = C?.applied[q]?.fleets[gone.id]?.cargo ?? zeroM();
      delete A[q].fleets[gone.id];
      if (at.kind === 'planet') {
        const t = (A[q].planets[at.id] ??= zeroM()); for (const m of MINS) t[m] += d.cargo[m];
        applyM((f.planets[at.id]?.owner === pid ? f.planets[at.id] : host.planets[at.id]).surface, diffM(d.cargo, held));
      } else {
        const t = (A[q].fleets[at.id] ??= { cargo: { ...zeroM(), colonists: 0 }, fuel: 0 }); for (const m of MINS) t.cargo[m] += d.cargo[m];
        // (the fleet's own merge below adds what the file does not hold yet)
        if (C?.applied[q]) { const c = (C.applied[q].fleets[at.id] ??= { cargo: { ...zeroM(), colonists: 0 }, fuel: 0 }); for (const m of MINS) c.cargo[m] += held[m]; }
      }
    }
  }
  host.fleets = host.fleets.filter(x => x.owner !== pid || fids.has(x.id));
  for (const x of f.fleets) {
    const i = host.fleets.findIndex(y => y.id === x.id);
    if (x.owner === pid || (i >= 0 && host.fleets[i].owner === pid)) {
      // their fleet (or one they gave away)
      addH(x, missingH(a => a.fleets[x.id]));
      if (i < 0) host.fleets.push(x); else host.fleets[i] = x;
      continue;
    }
    // a fleet of another that was not there at the start of the year: only a monster the player's orders woke (the
    // others' new fleets are theirs to send)
    // (one another player made this year, that the turn file already held: what this player put in it is taken)
    if (B.fleets[x.id] === undefined && !(i >= 0 && C?.holds[x.id])) { if (i < 0 && (f.players[x.owner]?.monster || host.players[x.owner]?.monster)) host.fleets.push(x); continue; }
    if (i < 0) {
      // its owner merged it into another since: what this player put in it goes to the fleet that took it in, or the world
      const bh0 = B.holds?.[x.id];
      if (!bh0) continue;
      const d = sumH([diffH({ cargo: x.cargo, fuel: x.fuel }, C?.holds[x.id] ?? bh0), C?.applied[pid]?.fleets[x.id]]);
      if (!anyM(d.cargo)) continue;
      const at = parkOn(x.x, x.y, x.orbiting, x.owner);
      if (!at) continue;
      if (at.kind === 'planet') {
        const got = applyM(host.planets[at.id].surface, d.cargo);
        const t = (cur.planets[at.id] ??= zeroM()); for (const m of MINS) t[m] += got[m];
        took(x.x, x.y, d.cargo, got);
      } else {
        const hf = host.fleets.find(o => o.id === at.id)!;
        const got = applyM(hf.cargo, d.cargo);
        const t = (cur.fleets[at.id] ??= { cargo: { ...zeroM(), colonists: 0 }, fuel: 0 }); for (const m of MINS) t.cargo[m] += got[m];
        took(x.x, x.y, d.cargo, got);
      }
      continue;
    }
    const bh = B.holds?.[x.id] ?? C?.holds[x.id];
    if (!bh) { if (fingerprint(x) !== B.fleets[x.id]) host.fleets[i] = x; continue; }
    const d = sumH([diffH({ cargo: x.cargo, fuel: x.fuel }, C?.holds[x.id] ?? bh), C?.applied[pid]?.fleets[x.id]]);
    if (anyH(d)) {
      const hf = host.fleets[i];
      const before: Hold = { cargo: { ...hf.cargo }, fuel: hf.fuel };
      addH(hf, d);
      const got = diffH({ cargo: hf.cargo, fuel: hf.fuel }, before);
      if (anyH(got)) cur.fleets[x.id] = got;
      took(hf.x, hf.y, d.cargo, got.cargo);
    }
  }
  // designs: theirs as they are now, others' only those of a monster the orders woke
  const dids = new Set(f.designs.map(x => x.id));
  host.designs = host.designs.filter(x => x.owner !== pid || dids.has(x.id));
  for (const x of f.designs) {
    const i = host.designs.findIndex(y => y.id === x.id);
    if (x.owner === pid) { if (i < 0) host.designs.push(x); else host.designs[i] = x; }
    else if (i < 0 && B.designs[x.id] === undefined && (f.players[x.owner]?.monster || host.players[x.owner]?.monster)) host.designs.push(x);
  }
  // wrecks: loaded or filled, as differences; the new ones (cargo jettisoned)
  if (B.salvage) {
    host.salvage ??= [];
    const fs = f.salvage ?? [];
    const othersMade = new Set(Object.values(C?.applied ?? {}).flatMap(a => a.created));
    for (const x of fs) {
      const b = B.salvage[x.id];
      if (b === undefined) {
        if (othersMade.has(x.id) && !(prev?.created.includes(x.id))) {
          // another's, held by the file: what the player loaded from it or put in it
          const at = C?.salvage[x.id], w = host.salvage.find(y => y.id === x.id);
          if (at && w) { const d = sumM([diffM(x.cargo, at), C?.applied[pid]?.salvage[x.id]]); if (anyM(d)) { const got = applyM(w.cargo, d); if (anyM(got)) cur.salvage[x.id] = got; took(w.x, w.y, d, got); } }
          continue;
        }
        if (!host.salvage.some(y => y.id === x.id)) {
          // (a wreck of this player's that others have loaded from or filled since: with what they did)
          const want = missingM(a => a.salvage[x.id]);
          if (anyM(want)) took(x.x, x.y, want, applyM(x.cargo, want));
          host.salvage.push(x); cur.created.push(x.id); unmade.delete(x.id);
        }
        continue;
      }
      const d = sumM([diffM(x.cargo, C ? C.salvage[x.id] ?? x.cargo : b), C?.applied[pid]?.salvage[x.id]]);
      const w = host.salvage.find(y => y.id === x.id);
      if (w && anyM(d)) { const got = applyM(w.cargo, d); if (anyM(got)) cur.salvage[x.id] = got; took(w.x, w.y, d, got); }
    }
    // emptied by the player (gone from its file): a wreck of the base, or another's held by the file
    const gone: [string, Minerals][] = [...Object.entries(B.salvage), ...Object.entries(C?.salvage ?? {}).filter(([id]) => B.salvage![+id] === undefined && othersMade.has(+id))];
    for (const [id, b] of gone) {
      if (fs.some(x => x.id === +id)) continue;
      const w = host.salvage.find(y => y.id === +id);
      if (w) { const d = sumM([diffM(zeroM(), C ? C.salvage[+id] ?? zeroM() : b), C?.applied[pid]?.salvage[+id]]); const got = applyM(w.cargo, d); if (anyM(got)) cur.salvage[+id] = got; took(w.x, w.y, d, got); }
    }
  }
  // a wreck this player made in a file before and not in this one: what others took from it comes out of this
  // player's holds (they have the cargo back), what others put in it stays there
  for (const [id, w] of unmade) {
    const by = sumM(otherIds.map(q => A[q].salvage[id]));
    const takes = zeroM(), gives = zeroM();
    for (const m of MINS) { if (by[m] < 0) takes[m] = by[m]; else gives[m] = by[m]; }
    if (anyM(takes)) took(w.x, w.y, takes, zeroM());
    if (anyM(gives)) { host.salvage!.push({ ...w, cargo: gives }); cur.created.push(id); }
  }
  // what could not be taken (another player had taken it first) leaves the player's holds there
  for (const sh of short) {
    // the player's fleets there first, then those whose holds grew this year
    const mine = host.fleets.filter(x => x.owner === pid);
    const here = mine.filter(x => Math.abs(x.x - sh.x) < 1 && Math.abs(x.y - sh.y) < 1).sort((a, b) => cargoMassOf(b) - cargoMassOf(a));
    for (const m of MINS) {
      let left = sh.d[m];
      const grew = (x: Fleet) => x.cargo[m] - ((C?.holds[x.id] ?? B.holds?.[x.id])?.cargo[m] ?? 0);
      const rest = mine.filter(x => !here.includes(x) && grew(x) > 0).sort((a, b) => grew(b) - grew(a));
      for (const x of [...here, ...rest]) { if (left <= 0) break; const k = Math.min(left, x.cargo[m]); x.cargo[m] -= k; left -= k; }
      // then its worlds where they landed (a payment of a treaty goes to the capital's surface)
      if (left > 0) {
        const up = (pl: { id: number; surface: Minerals }) => pl.surface[m] - ((C?.surface[pl.id] ?? B.surface?.[pl.id])?.[m] ?? pl.surface[m]);
        for (const pl of host.planets.filter(pl => pl.owner === pid && up(pl) > 0).sort((a, b) => up(b) - up(a))) { if (left <= 0) break; const k = Math.min(left, up(pl)); pl.surface[m] -= k; left -= k; }
      }
    }
  }
  // troops landed by hand
  host.landings = [...(host.landings ?? []).filter(l => l.owner !== pid), ...(f.landings ?? []).filter(l => l.owner === pid)];
  // guardians woken
  for (const x of f.guardians ?? []) if (!(host.guardians ?? []).some(y => y.id === x.id)) (host.guardians ??= []).push(x);
  // diplomacy between empires: the pairs of this player its orders changed, its proposals
  if (host.diplomacy && f.diplomacy) {
    const H = host.diplomacy, F = f.diplomacy;
    // the pairs of this player, and those between computers its orders moved (an ally following it into a war)
    const human = (id: number) => id !== pid && !host.players[id]?.ai && !host.players[id]?.monster;
    for (const [k, v] of Object.entries(F.pairs)) {
      const ids = k.split('-').map(Number);
      const was = C?.pairs[k] ?? B.pairs[k];
      if (fingerprint(v) === was) continue;
      // a pair of this player; or one between others its orders moved (an ally following it into a war), unless
      // another player's orders changed it meanwhile
      if (ids.includes(pid) || !ids.some(human) || fingerprint(H.pairs[k]) === was) H.pairs[k] = v;
    }
    const fids2 = new Set(F.proposals.map(p => p.id));
    // answered (or withdrawn) by the player: those there at the start of the year, or made since and held by the file
    const gone = (P.gone ??= []);
    H.proposals = H.proposals.filter(p => {
      const out = (B.proposals.includes(p.id) || !!C?.proposals.includes(p.id)) && !fids2.has(p.id) && (p.to === pid || p.from === pid);
      if (out && !gone.includes(p.id)) gone.push(p.id);
      return !out;
    });
    for (const p of F.proposals) if (p.from === pid && !B.proposals.includes(p.id) && !gone.includes(p.id) && !H.proposals.some(x => x.id === p.id)) H.proposals.push(p);
    for (const m of F.memory) if ((m.about === pid || m.by === pid) && m.year === P.turn && !H.memory.some(x => same(x, m))) H.memory.push(m);
    for (const l of F.log) if (l.year === P.turn && (l.a === pid || l.b === pid) && !H.log.some(x => same(x, l))) H.log.push(l);
    if (F.bonus?.[pid]) H.bonus[pid] = F.bonus[pid];
  }
  // stories, chronicle
  if (f.chains) {
    host.chains ??= [];
    for (const c of f.chains) {
      const i = host.chains.findIndex(x => x.id === c.id);
      if (i < 0) host.chains.push(c);
      else if (fingerprint(c) !== (C?.chains[c.id] ?? B.chains[c.id])) host.chains[i] = c;
    }
  }
  if (f.chronicle && host.chronicle) for (const e of f.chronicle.events) if (e.year === P.turn && !host.chronicle.events.some(x => x.year === e.year && x.text === e.text)) host.chronicle.events.push(e);
  // nothing of an empire the host does not know (a forged or damaged file)
  host.fleets = host.fleets.filter(x => !!host.players[x.owner]);
  host.designs = host.designs.filter(x => !!host.players[x.owner]);
  host.nextId = Math.max(host.nextId, f.nextId);
  A[pid] = cur;
  P.received = { ...(P.received ?? {}), [pid]: P.turn };
  return null;
}

const cargoMassOf = (f: Fleet) => f.cargo.ironium + f.cargo.boranium + f.cargo.germanium + f.cargo.colonists;

/** The humans whose orders have not come in this year. */
export function missingOrders(host: GameState): number[] {
  const P = host.pbem;
  if (!P || P.role !== 'host') return [];
  return pbemHumans(host).filter(id => P.received?.[id] !== P.turn);
}
