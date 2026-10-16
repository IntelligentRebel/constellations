// 0.3.9: the window of a game played by turn files: the host's (turn files to send, orders received, the year to
// generate) and the player's (the orders file to send back).
import { useState } from 'preact/hooks';
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

export function PbemDialog() {
  const s = useStore();
  const g = s.game!;
  const P = g.pbem;
  const [report, setReport] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);
  if (!P) return <StartHosting g={g} />;
  if (P.role === 'player') {
    const pid = P.player!;
    const sent = P.sent === P.turn;
    const local = !!P.hostSlot && s.hasSlot(P.hostSlot);
    return <Modal title={`Vos ordres pour ${P.turn}`} width={560} onClose={() => s.close('pbem')} footer={<><span class="sp" /><button onClick={() => s.close('pbem')}>Fermer</button></>}>
      <p>{sent ? `Vos ordres de ${P.turn} sont partis. Vous pouvez encore les modifier et renvoyer le fichier : seul le dernier reçu compte.` : `Vous jouez les ${g.players[pid].name} pour ${P.turn}. Une fois vos ordres donnés, enregistrez le fichier d'ordres et envoyez-le à l'hôte de la partie.`}</p>
      <div class="btns">
        <button class="primary" onClick={() => { P.sent = P.turn; s.save(); void sendFile(PB.ordersFile(g)); s.bump(); }}>Enregistrer le fichier d'ordres</button>
        {local && <button onClick={() => void handToHost(g)}>Remettre les ordres à l'hôte (ce navigateur)</button>}
      </div>
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
    <p class="small">Ce navigateur héberge la partie. Chaque année, envoyez à chaque joueur son fichier de tour ; il donne ses ordres chez lui et vous renvoie un fichier d'ordres ; importez-les, puis générez l'année. Vous pouvez jouer votre propre empire ici (« Jouer ici »), comme les autres : la partie hébergée reste dans sa sauvegarde.</p>
    <table class="report pbem-table"><thead><tr><th>Empire</th><th>Ordres de {P.turn}</th><th /></tr></thead>
      <tbody>{humans.map(id => { const p = g.players[id]; const got = P.received?.[id] === P.turn; return <tr>
        <td><span style={{ color: p.color }}>{p.name}</span></td>
        <td>{got ? <b class="green">reçus</b> : <span class="muted">en attente</span>}</td>
        <td class="row-btns"><button class="small" onClick={() => void sendFile(PB.turnFile(g, id, g.id))}>Fichier de tour</button> <button class="small" onClick={() => playHere(g, id)}>Jouer ici</button></td>
      </tr>; })}</tbody></table>
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
