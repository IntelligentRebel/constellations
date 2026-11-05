// 0.3.9.25: a game by turn files through a shared folder (Dropbox, Google Drive, OneDrive... synced on each
// computer): the host's game drops the turn files there and picks up the orders, each player's game picks up its new
// turn and drops its orders; nothing to send by hand. And, for those without such a folder, the mail prepared.
// File System Access API: Chrome and Edge on a computer, as the backup folder.
import type { GameState } from '../engine/types';
import * as PB from '../engine/pbem';
import { backupSupported, kvGet, kvPut, kvDel } from './backup';
import { store, saveFile } from './store';

type Perm = 'granted' | 'denied' | 'prompt';
interface FileH { kind: 'file'; name: string; getFile(): Promise<File>; createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }> }
export interface Dir { kind: 'directory'; name: string; values(): AsyncIterable<FileH | Dir>; getFileHandle(n: string, o?: { create?: boolean }): Promise<FileH>; removeEntry(n: string): Promise<void>; queryPermission?(o: { mode: 'readwrite' }): Promise<Perm>; requestPermission?(o: { mode: 'readwrite' }): Promise<Perm> }

export const sharedSupported = backupSupported;
const KEY = (hostId: string) => 'pbemFolder:' + hostId;
const dirs = new Map<string, Dir>();
const listeners = new Set<() => void>();
export const onSharedChange = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
const changed = () => { for (const f of listeners) f(); };

export interface SharedState { name: string; ok: boolean }
/** The shared folder of this game in this browser (without asking anything), or null. */
export async function sharedFolder(hostId: string): Promise<SharedState | null> {
  if (!sharedSupported()) return null;
  let d = dirs.get(hostId);
  if (!d) { try { d = await kvGet<Dir>(KEY(hostId)); } catch { d = undefined; } if (d) dirs.set(hostId, d); }
  if (!d) return null;
  let ok = true;
  try { ok = !d.queryPermission || await d.queryPermission({ mode: 'readwrite' }) === 'granted'; } catch { ok = false; }
  return { name: d.name, ok };
}

async function pick(): Promise<Dir | null> {
  try { return await (window as unknown as { showDirectoryPicker(o: object): Promise<Dir> }).showDirectoryPicker({ id: 'constellations-pbem', mode: 'readwrite', startIn: 'documents' }); } catch { return null; }
}
async function adopt(hostId: string, d: Dir) {
  dirs.set(hostId, d);
  try { await kvPut(KEY(hostId), d); } catch { /* this session only */ }
  changed();
}
/** The player picks the shared folder of this game (call from a click). */
export async function chooseShared(hostId: string): Promise<boolean> {
  const d = await pick(); if (!d) return false;
  await adopt(hostId, d); return true;
}
/** The browser asks again for the folder chosen in an earlier session (call from a click). */
export async function allowShared(hostId: string): Promise<boolean> {
  const d = dirs.get(hostId); if (!d) return false;
  let ok = false;
  try { ok = !d.requestPermission || await d.requestPermission({ mode: 'readwrite' }) === 'granted'; } catch { ok = false; }
  changed(); return ok;
}
export async function forgetShared(hostId: string) { dirs.delete(hostId); try { await kvDel(KEY(hostId)); } catch { /* ignore */ } changed(); }

async function write(d: Dir, name: string, text: string) {
  const w = await (await d.getFileHandle(name, { create: true })).createWritable();
  await w.write(text); await w.close();
}
const mods = new Map<string, number>();
/** The turn or orders files of the folder changed since this session last read them. */
async function fresh(d: Dir, ext: '.tour.json' | '.ordres.json'): Promise<{ name: string; mod: number; text: string }[]> {
  const out: { name: string; mod: number; text: string }[] = [];
  for await (const e of d.values()) {
    if (e.kind !== 'file' || !e.name.endsWith(ext)) continue;
    const f = await e.getFile();
    if (mods.get(d.name + '/' + e.name) === f.lastModified) continue;
    mods.set(d.name + '/' + e.name, f.lastModified);
    out.push({ name: e.name, mod: f.lastModified, text: await f.text() });
  }
  return out;
}

// ------------------------------------------------------------------ the yearly round, every few seconds
let running = false;
export async function syncShared(): Promise<void> {
  const g = store.game, P = g?.pbem;
  if (!g || !P || running || store.busy) return;
  const st = await sharedFolder(P.hostId);
  const d = dirs.get(P.hostId);
  if (!st?.ok || !d) return;
  running = true;
  try { if (P.role === 'host') await hostRound(g, d); else await playerRound(g, d); } catch { /* the folder is gone or busy: next round */ } finally { running = false; }
}

async function hostRound(g: GameState, d: Dir) {
  const P = g.pbem!;
  // the turn files of the year, once; the files of earlier years go
  if (P.sharedTurn !== P.turn) {
    const seen = (P.sharedSeen ??= {});
    // (the files of earlier years this game wrote or read go: turn files, orders already merged)
    for (const [name, x] of Object.entries(seen)) if (x.year < P.turn) { try { await d.removeEntry(name); } catch { /* gone already */ } delete seen[name]; }
    for (const id of PB.pbemHumans(g)) { const f = PB.turnFile(g, id, g.id), name = PB.fileName(f); await write(d, name, JSON.stringify(f)); seen[name] = { mod: 0, year: P.turn }; }
    P.sharedTurn = P.turn; store.save(); store.bump();
    store.notify(`Fichiers de tour de ${P.turn} déposés dans le dossier partagé.`);
  }
  // the orders that came in
  let got = 0;
  for (const x of await fresh(d, '.ordres.json')) {
    const seen = P.sharedSeen?.[x.name];
    if (seen && seen.mod === x.mod) continue;
    const r = PB.readPbem(x.text);
    (P.sharedSeen ??= {})[x.name] = { mod: x.mod, year: r?.file.year ?? 0 };
    if (!r || r.file.hostId !== P.hostId || r.file.year !== P.turn || r.file.format !== PB.ORDERS_FORMAT) continue;
    store.checkpoint();
    const err = PB.mergeOrders(g, r.file, r.game);
    store.notify(err ? `Ordres des ${g.players[r.file.player]?.name ?? '?'} refusés : ${err}.` : `Ordres des ${g.players[r.file.player].name} reçus (dossier partagé).`);
    if (!err) got++;
  }
  if (got) { store.save(); store.bump(); }
  if (P.autoGen && got && !PB.missingOrders(g).length) {
    store.close('pbem');
    await store.endTurn(1, true);
    // (the turn files of the new year at once)
    const h = store.game;
    if (h?.pbem?.role === 'host' && h.pbem.hostId === P.hostId) await hostRound(h, d);
  }
}

async function playerRound(g: GameState, d: Dir) {
  const P = g.pbem!;
  for (const x of await fresh(d, '.tour.json')) {
    const r = PB.readPbem(x.text);
    if (!r || r.file.format !== PB.TURN_FORMAT || r.file.hostId !== P.hostId || r.file.player !== P.player || r.file.year <= P.turn) continue;
    const late = P.sent !== P.turn;
    store.setGame(PB.openTurn(r.file, r.game));
    store.notify(late ? `Le tour ${r.file.year} est arrivé sans vos ordres de ${P.turn} : l'hôte a généré l'année sans eux. À vous de jouer.` : `Le tour ${r.file.year} est arrivé : à vous de jouer.`);
    return;
  }
}

/** The player's orders: into the shared folder when there is one, else a file to send. */
export async function dropOrders(g: GameState): Promise<boolean> {
  const P = g.pbem!;
  const st = await sharedFolder(P.hostId), d = dirs.get(P.hostId);
  if (!st?.ok || !d) return false;
  const f = PB.ordersFile(g);
  try { await write(d, PB.fileName(f), JSON.stringify(f)); } catch { return false; }
  P.sent = P.turn; store.save(); store.bump();
  // (the host plays here too: back to the hosted game, which picks them up)
  const host = P.hostSlot && store.hasSlot(P.hostSlot) ? await store.readSlot(P.hostSlot) : null;
  if (host?.pbem?.role === 'host') { store.setGame(host); store.open('pbem'); void syncShared(); }
  store.notify(`Ordres de ${P.turn} déposés dans le dossier partagé : l'hôte les recevra tout seul.`);
  return true;
}

/** A player joins from the shared folder: picks it, then the turn of their empire opens. */
export async function joinShared(): Promise<void> {
  const d = await pick(); if (!d) return;
  const turns: { file: PB.PbemFile; game: GameState }[] = [];
  try {
    for await (const e of d.values()) {
      if (e.kind !== 'file' || !e.name.endsWith('.tour.json')) continue;
      const r = PB.readPbem(await (await e.getFile()).text());
      if (r && r.file.format === PB.TURN_FORMAT) turns.push(r);
    }
  } catch { /* unreadable */ }
  // the latest turn of each empire of each game
  const best = new Map<string, { file: PB.PbemFile; game: GameState }>();
  for (const t of turns) { const k = t.file.hostId + '/' + t.file.player; const b = best.get(k); if (!b || t.file.year > b.file.year) best.set(k, t); }
  const list = [...best.values()].sort((a, b) => a.file.game.localeCompare(b.file.game) || a.file.player - b.file.player);
  if (!list.length) { store.notify('Aucun fichier de tour dans ce dossier : l\'hôte doit d\'abord y déposer les tours (fenêtre de la partie par fichiers).'); return; }
  store.open('joinShared', { list, dir: d });
}
export async function openShared(t: { file: PB.PbemFile; game: GameState }, d: Dir) {
  await adopt(t.file.hostId, d);
  store.close('joinShared');
  store.setGame(PB.openTurn(t.file, t.game));
  store.notify(`Tour ${t.file.year} des ${t.game.players[t.file.player].name} : donnez vos ordres, puis « Envoyer mes ordres » les dépose dans le dossier partagé.`);
}

// ------------------------------------------------------------------ the mail, prepared
function mail(to: string, subject: string, body: string) {
  const a = document.createElement('a');
  a.href = `mailto:${encodeURIComponent(to.trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  document.body.appendChild(a); a.click(); a.remove();
}
/** The host: the turn file saved, and a mail to the player written (the file to attach is named in it). */
export async function mailTurn(g: GameState, pid: number) {
  const f = PB.turnFile(g, pid, g.id), name = PB.fileName(f);
  await saveFile(name, JSON.stringify(f));
  mail(g.pbem?.emails?.[pid] ?? '', `Constellations · ${g.name} · ${f.year} · ${f.empire}`, `Voici ton tour ${f.year} de la partie « ${g.name} » (les ${f.empire}) : le fichier ${name}, joint à ce message. Ouvre-le dans Constellations avec « Importer une partie… », donne tes ordres, puis renvoie-moi le fichier d'ordres avec le bouton « Envoyer mes ordres ».`);
  store.notify(`${name} est enregistré dans vos téléchargements : joignez-le au message.`);
}
/** The player: the orders file saved, and a mail to the host written. */
export async function mailOrders(g: GameState) {
  const P = g.pbem!;
  const f = PB.ordersFile(g), name = PB.fileName(f);
  await saveFile(name, JSON.stringify(f));
  P.sent = P.turn; store.save(); store.bump();
  mail(P.hostEmail ?? '', `Constellations · ${g.name} · ${f.year} · ${f.empire}`, `Voici mes ordres ${f.year} pour la partie « ${g.name} » (les ${f.empire}) : le fichier ${name}, joint à ce message.`);
  store.notify(`${name} est enregistré dans vos téléchargements : joignez-le au message.`);
}
