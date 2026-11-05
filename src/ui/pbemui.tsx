// 0.3.9: the window of a game played by turn files: the host's (turn files to send, orders received, the year to
// generate) and the player's (the orders file to send back).
import { useState, useEffect } from 'preact/hooks';
import { sharedSupported, sharedFolder, chooseShared, allowShared, onSharedChange, syncShared, dropOrders, mailTurn, mailOrders, openShared, type SharedState, type Dir } from './shared';
import { useStore, store, saveFile } from './store';
import { Modal } from './components';
import type { GameState } from '../engine/types';
import * as PB from '../engine/pbem';

/** Reads files picked by the host: orders are merged, anything else is reported. */
async function importOrders(files: FileList | null): Promise<string[]> {
  const g = store.game;
  const out: string[] = [];
  if (!g || !files) return out;
  store.checkpoint();
  for (const f of Array.from(files)) {
    const r = PB.readPbem(await f.text());
    if (!r) { out.push(`${f.name} : ce n'est pas un fichier d'ordres de Constellations.`); continue; }
    const err = PB.mergeOrders(g, r.file, r.game);
    out.push(err ? `${f.name} : ${err}.` : `Ordres des ${g.players[r.file.player].name} reçus.`);
  }
  store.save(); store.bump();
  return out;
}

export async function sendFile(f: PB.PbemFile) {
  const ok = await saveFile(PB.fileName(f), JSON.stringify(f));
  if (!ok) store.open('export', { title: PB.fileName(f), text: JSON.stringify(f), file: PB.fileName(f), note: 'Copiez ce texte dans un fichier portant ce nom.' });
}

/** Opens a turn file in this browser (the host's game stays in its own slot). */
export function playHere(host: GameState, pid: number) {
  store.save();
  const f = PB.turnFile(host, pid, host.id);
  const r = PB.readPbem(JSON.stringify(f))!;
  store.setGame(PB.openTurn(r.file, r.game));
  store.notify(`Vous jouez les ${r.game.players[pid].name} pour ${r.file.year}. Envoyez vos ordres avec le bouton de fin de tour.`);
}

/** Gives a player's orders to the host whose game is saved in this browser, and opens the host's game. */
async function handToHost(g: GameState) {
  const slot = g.pbem!.hostSlot!;
  const host = await store.readSlot(slot);
  if (!host) { store.notify('La partie hébergée n\'est plus dans ce navigateur : envoyez le fichier d\'ordres.'); return; }
  const f = PB.ordersFile(g);
  const r = PB.readPbem(JSON.stringify(f))!;
  const err = PB.mergeOrders(host, r.file, r.game);
  if (err) { store.notify(`Ordres refusés : ${err}.`); return; }
  g.pbem!.sent = g.pbem!.turn;
  store.save();
  store.setGame(host);
  store.open('pbem');
  store.notify(`Ordres des ${host.players[r.file.player].name} remis à l'hôte.`);
}

/** 0.3.9.25: the shared folder of the game in this browser, kept up to date. */
function useShared(hostId: string | undefined): SharedState | null | undefined {
  const [st, setSt] = useState<SharedState | null | undefined>(undefined);
  useEffect(() => {
    if (!hostId) return;
    let live = true;
    const read = () => { void sharedFolder(hostId).then(x => { if (live) setSt(x); }); };
    read();
    const off = onSharedChange(read);
    return () => { live = false; off(); };
  }, [hostId]);
  return st;
}

/** 0.3.9.25: where the turn files go and the orders come from, without any file sent by hand. */
function SharedBlock({ hostId, host }: { hostId: string; host: boolean }) {
  const st = useShared(hostId);
  const g = store.game!;
  if (!sharedSupported()) return <p class="small muted">Dossier partagé (Dropbox, Google Drive, OneDrive…) : il demande Chrome ou Edge sur ordinateur, avec la page du jeu ouverte directement (pas depuis un autre site).</p>;
  if (st === undefined) return null;
  const choose = () => void chooseShared(hostId).then(ok => { if (ok) void syncShared(); });
  return <div class="pbem-shared">
    <b>Dossier partagé</b>
    {!st ? <>
      <p class="small">{host ? 'Choisissez un dossier synchronisé sur votre ordinateur (Dropbox, Google Drive, OneDrive…) et partagez-le avec les joueurs. Le jeu y dépose les fichiers de tour et y relève les ordres tout seul.' : 'Si l\'hôte a partagé un dossier avec vous (Dropbox, Google Drive, OneDrive…), choisissez-le ici : vos ordres y partiront et votre tour suivant s\'ouvrira tout seul.'}</p>
      <button onClick={choose}>Choisir le dossier partagé…</button>
    </> : !st.ok ? <>
      <p class="small yellow">{`Le navigateur demande votre accord pour reprendre le dossier « ${st.name} ».`}</p>
      <button class="primary" onClick={() => void allowShared(hostId).then(ok => { if (ok) void syncShared(); })}>Autoriser le dossier</button>
    </> : <>
      <p class="small green">{host ? `Dossier « ${st.name} » : les fichiers de tour y sont déposés, les ordres relevés toutes les 10 secondes.` : `Dossier « ${st.name} » : vos ordres y partent, votre tour suivant s'ouvrira tout seul.`}</p>
      {host && <label class="chk"><input type="checkbox" checked={!!g.pbem?.autoGen} onChange={e => { store.checkpoint(); g.pbem!.autoGen = (e.target as HTMLInputElement).checked; store.save(); store.bump(); }} /> Générer l'année dès que tous les ordres sont arrivés</label>}
      <button class="small" onClick={choose}>Changer de dossier…</button>
    </>}
  </div>;
}

/** 0.3.9.25: a player joins from the shared folder: the turns found there, one per empire. */
export function JoinSharedDialog({ data }: { data: { list: { file: PB.PbemFile; game: GameState }[]; dir: Dir } }) {
  const s = useStore();
  return <Modal title="Rejoindre une partie" width={520} onClose={() => s.close('joinShared')} footer={<><span class="sp" /><button onClick={() => s.close('joinShared')}>Annuler</button></>}>
    <p class="small">Choisissez votre empire :</p>
    <div class="btns col">{data.list.map(t => <button onClick={() => void openShared(t, data.dir)}>{`${t.file.game} · ${t.file.empire} · ${t.file.year}`}</button>)}</div>
  </Modal>;
}

/** The player's orders: into the shared folder, else as a file. */
export async function sendOrders(g: GameState) {
  if (await dropOrders(g)) return;
  g.pbem!.sent = g.pbem!.turn; store.save(); void sendFile(PB.ordersFile(g)); store.bump();
}

export function PbemDialog() {
  const s = useStore();
  const g = s.game!;
  const P = g.pbem;
  const [report, setReport] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);
  const st = useShared(P?.hostId);
  if (!P) return <StartHosting g={g} />;
  if (P.role === 'player') {
    const pid = P.player!;
    const sent = P.sent === P.turn;
    const local = !!P.hostSlot && s.hasSlot(P.hostSlot);
    return <Modal title={`Vos ordres pour ${P.turn}`} width={560} onClose={() => s.close('pbem')} footer={<><span class="sp" /><button onClick={() => s.close('pbem')}>Fermer</button></>}>
      <p>{sent ? `Vos ordres de ${P.turn} sont partis. Vous pouvez encore les modifier et renvoyer le fichier : seul le dernier reçu compte.` : `Vous jouez les ${g.players[pid].name} pour ${P.turn}. Une fois vos ordres donnés, enregistrez le fichier d'ordres et envoyez-le à l'hôte de la partie.`}</p>
      <div class="btns">
        {st?.ok ? <button class="primary" onClick={() => void dropOrders(g)}>Déposer mes ordres dans le dossier partagé</button>
          : <button class="primary" onClick={() => { P.sent = P.turn; s.save(); void sendFile(PB.ordersFile(g)); s.bump(); }}>Enregistrer le fichier d'ordres</button>}
        {!st?.ok && P.hostEmail && <button onClick={() => void mailOrders(g)}>Envoyer par e-mail à l'hôte</button>}
        {local && <button onClick={() => void handToHost(g)}>Remettre les ordres à l'hôte (ce navigateur)</button>}
      </div>
      <SharedBlock hostId={P.hostId} host={false} />
      <p class="small muted">Le tour suivant arrivera sous la forme d'un nouveau fichier de tour : ouvrez-le avec le bouton « Importer » (barre des onglets) ou « Importer une partie… » (écran d'accueil). Il remplace la sauvegarde de ce tour.</p>
    </Modal>;
  }
  const humans = PB.pbemHumans(g);
  const missing = PB.missingOrders(g);
  const go = () => { setConfirm(false); s.close('pbem'); void s.endTurn(1, true).then(() => { if (store.game?.pbem) store.open('pbem'); }); };
  return <Modal title={`Partie par fichiers · ${P.turn}`} width={680} onClose={() => s.close('pbem')} footer={<>
    <label class="filebtn">Importer des ordres…<input type="file" multiple accept=".json,application/json" onChange={async e => setReport(await importOrders((e.target as HTMLInputElement).files))} /></label>
    <span class="sp" />
    {confirm ? <><span class="small yellow">{missing.length > 1 ? `${missing.length} empires n'ont pas envoyé d'ordres : ils garderont ceux de l'an dernier.` : 'Un empire n\'a pas envoyé d\'ordres : il gardera ceux de l\'an dernier.'}</span><button class="danger" onClick={go}>Générer quand même</button><button onClick={() => setConfirm(false)}>Attendre</button></>
      : <button class="primary" disabled={s.busy} onClick={() => missing.length ? setConfirm(true) : go()}>{`Générer l'année ${P.turn + 1}`}</button>}
  </>}>
    <p class="small">Ce navigateur héberge la partie. Chaque année, envoyez à chaque joueur son fichier de tour ; il donne ses ordres chez lui et vous renvoie un fichier d'ordres ; importez-les, puis générez l'année. Vous pouvez jouer votre propre empire ici (« Jouer ici »), comme les autres : la partie hébergée reste dans sa sauvegarde. Ne donnez pas d'ordres directement dans la partie hébergée : les fichiers d'ordres des joueurs remplacent ce qui y change.</p>
    <SharedBlock hostId={P.hostId} host />
    <table class="report pbem-table"><thead><tr><th>Empire</th><th>Ordres de {P.turn}</th><th>E-mail</th><th /></tr></thead>
      <tbody>{humans.map(id => { const p = g.players[id]; const got = P.received?.[id] === P.turn; return <tr>
        <td><span style={{ color: p.color }}>{p.name}</span></td>
        <td>{got ? <b class="green">reçus</b> : <span class="muted">en attente</span>}</td>
        <td><input type="email" class="pbem-mail" placeholder="@" value={P.emails?.[id] ?? ''} onChange={e => { (P.emails ??= {})[id] = (e.target as HTMLInputElement).value.trim(); s.save(); s.bump(); }} /></td>
        <td class="row-btns">{!st?.ok && <button class="small" disabled={!P.emails?.[id]} title="Enregistre le fichier de tour et prépare le message (il reste à y joindre le fichier)" onClick={() => void mailTurn(g, id)}>E-mail</button>} <button class="small" onClick={() => void sendFile(PB.turnFile(g, id, g.id))}>Fichier de tour</button> <button class="small" onClick={() => playHere(g, id)}>Jouer ici</button></td>
      </tr>; })}</tbody></table>
    {!st?.ok && <label class="small">Votre adresse (pour que les joueurs vous répondent) : <input type="email" class="pbem-mail" value={P.hostEmail ?? ''} onChange={e => { P.hostEmail = (e.target as HTMLInputElement).value.trim() || undefined; s.save(); s.bump(); }} /></label>}
    {report.length > 0 && <ul class="small pbem-report">{report.map(r => <li>{r}</li>)}</ul>}
    <p class="small muted">Les fichiers contiennent toute la partie : jouez entre personnes de confiance. Un empire sans ordres pour l'année garde ceux de l'an dernier (ses flottes poursuivent leur route, ses files continuent).</p>
  </Modal>;
}

/** A game with several humans can be hosted by turn files. */
function StartHosting({ g }: { g: GameState }) {
  const s = useStore();
  const humans = PB.pbemHumans(g);
  return <Modal title="Partie par fichiers" width={560} onClose={() => s.close('pbem')} footer={<><span class="sp" /><button onClick={() => s.close('pbem')}>Fermer</button>
    <button class="primary" disabled={humans.length < 2} onClick={() => { s.checkpoint(); PB.startHosting(g); s.save(); s.bump(); }}>Héberger cette partie</button></>}>
    <p>Chacun joue chez soi, comme dans Stars! par courrier : ce navigateur héberge la partie, envoie à chaque joueur humain son fichier de tour et reçoit ses ordres.</p>
    {humans.length < 2 ? <p class="small yellow">Il faut au moins deux joueurs humains : créez une partie avec des adversaires humains (onglet Adversaires de la nouvelle partie).</p>
      : <p class="small muted">{`${humans.length} empires joueront par fichiers : ${humans.map(id => g.players[id].name).join(', ')}.`}</p>}
  </Modal>;
}
