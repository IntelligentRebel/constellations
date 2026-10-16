// 0.3.9: multiplayer by turn files, as Stars! played by e-mail. A host holds the game; every year it gives each human
// player a turn file (the whole game, seen as that player), the players give their orders at home and send back an
// orders file, the host merges them and generates the year. The merge is a three-way merge: the host keeps the
// fingerprint of every object as it was when the turn files were made, and takes from a player's file what that
// player changed (their worlds, fleets, designs, and what their diplomacy changed between empires). Ids created by a
// player come from a range of their own, so two players never create the same id. The files hold the whole game:
// a game between friends who trust each other.
import { deflateSync, inflateSync, strToU8, strFromU8 } from 'fflate';
import type { Fleet, GameState, PbemBase, ShipDesign } from './types';

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
  copy.nextId = P.base!.nextId + (pid + 1) * ID_STRIDE;
  copy.pbem = { role: 'player', hostId: P.hostId, turn: g.year, player: pid, hostSlot };
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
  const safe = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${safe(f.game) || 'partie'}-${f.year}-${safe(f.empire)}.${f.format === TURN_FORMAT ? 'tour' : 'ordres'}.json`;
}

/** Reads a turn or orders file (null: not one). */
export function readPbem(text: string): { file: PbemFile; game: GameState } | null {
  let o: PbemFile;
  try { o = JSON.parse(text); } catch { return null; }
  if (!o || (o.format !== TURN_FORMAT && o.format !== ORDERS_FORMAT) || typeof o.data !== 'string') return null;
  const game = unpack(o.data) as GameState;
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

/** Merges a player's orders into the host's game. Returns an error or null. */
export function mergeOrders(host: GameState, file: PbemFile, f: GameState): string | null {
  const err = ordersBlocker(host, file);
  if (err) return err;
  const P = host.pbem!, B = P.base!, pid = file.player;
  // the player
  const keepAi = host.players[pid].ai;
  host.players[pid] = f.players[pid];
  host.players[pid].ai = keepAi;
  // what the player's actions told the others
  for (const o of host.players) {
    if (o.id === pid) continue;
    for (const m of f.players[o.id]?.messages ?? []) if (m.year === P.turn && !o.messages.some(x => x.year === m.year && x.text === m.text)) o.messages.push(m);
  }
  // worlds
  for (const p of f.planets) if (fingerprint(p) !== B.planets[p.id]) host.planets[p.id] = p;
  // fleets and designs: theirs as they are now, others' only when the player's actions changed them
  const sync = <T extends { id: number; owner: number }>(mine: T[], theirs: T[], base: Record<number, string>): T[] => {
    const ids = new Set(theirs.map(x => x.id));
    const out = mine.filter(x => x.owner !== pid || ids.has(x.id));
    for (const x of theirs) {
      const i = out.findIndex(y => y.id === x.id);
      if (i < 0) { if (x.owner === pid || base[x.id] === undefined) out.push(x); }
      else if (fingerprint(x) !== base[x.id]) out[i] = x;
    }
    return out;
  };
  host.fleets = sync<Fleet>(host.fleets, f.fleets, B.fleets);
  host.designs = sync<ShipDesign>(host.designs, f.designs, B.designs);
  // diplomacy between empires
  if (host.diplomacy && f.diplomacy) {
    const H = host.diplomacy, F = f.diplomacy;
    for (const [k, v] of Object.entries(F.pairs)) if (fingerprint(v) !== B.pairs[k]) H.pairs[k] = v;
    const fids = new Set(F.proposals.map(p => p.id));
    H.proposals = H.proposals.filter(p => !(B.proposals.includes(p.id) && !fids.has(p.id) && (p.to === pid || p.from === pid)));
    for (const p of F.proposals) if (!B.proposals.includes(p.id) && !H.proposals.some(x => x.id === p.id)) H.proposals.push(p);
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
      else if (fingerprint(c) !== B.chains[c.id]) host.chains[i] = c;
    }
  }
  if (f.chronicle && host.chronicle) for (const e of f.chronicle.events) if (e.year === P.turn && !host.chronicle.events.some(x => x.year === e.year && x.text === e.text)) host.chronicle.events.push(e);
  host.nextId = Math.max(host.nextId, f.nextId);
  P.received = { ...(P.received ?? {}), [pid]: P.turn };
  return null;
}

/** The humans whose orders have not come in this year. */
export function missingOrders(host: GameState): number[] {
  const P = host.pbem;
  if (!P || P.role !== 'host') return [];
  return pbemHumans(host).filter(id => P.received?.[id] !== P.turn);
}
