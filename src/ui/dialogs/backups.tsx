// 0.3.6.7: the backup files of the last turns, in a folder the player chooses.
import { useEffect, useState } from 'preact/hooks';
import { store, useStore } from '../store';
import { Modal } from '../components';
import { importGame } from '../app';
import { LOCALE } from '../../i18n';
import { backup, backupSupported, chooseFolder, allowFolder, forgetFolder, listBackups, readBackup, onBackupChange, KEEP, type BackupEntry } from '../backup';

const DECLINED = 'constellations.v1.backupDeclined';
const decline = () => { try { localStorage.setItem(DECLINED, '1'); } catch { /* ignore */ } };

/** Re-renders when the state of the backups changes. */
export function useBackup() {
  const [, set] = useState(0);
  useEffect(() => onBackupChange(() => set(v => v + 1)), []);
  return backup;
}

export function BackupsDialog({ intro }: { intro?: boolean }) {
  useStore();
  const b = useBackup();
  const [list, setList] = useState<BackupEntry[] | null>(null);
  useEffect(() => { let live = true; void listBackups().then(l => { if (live) setList(l); }); return () => { live = false; }; }, [b.status, b.last, b.name]);
  const close = () => store.close('backups');
  const open = async (e: BackupEntry) => {
    const g = await readBackup(e.file);
    if (!g) { store.notify('Fichier illisible'); return; }
    const go = () => { store.setGame(g, false); store.notify(`Sauvegarde de secours ouverte : ${e.game}, ${e.year}`); };
    const current = store.game?.id === g.id || store.slots.some(sl => sl.id === g.id);
    if (current) store.ask(`Reprendre « ${e.game} » en ${e.year} ? La sauvegarde de cette partie dans le navigateur sera remplacée par ce fichier.`, go, 'Reprendre');
    else go();
  };
  if (!backupSupported()) {
    return <Modal title="Sauvegardes de secours" width={560} onClose={close} footer={<><span class="sp" /><button onClick={() => { close(); importGame(); }}>Ouvrir un fichier…</button><button class="primary" onClick={close}>Fermer</button></>}>
      <p>Ce navigateur ne permet pas à une page d'écrire dans un dossier (seuls Chrome et Edge le font, et pas depuis une page intégrée à un autre site). Les parties restent dans le stockage du navigateur : pensez à les exporter (bouton Exporter) ; un fichier exporté s'ouvre avec Importer.</p>
    </Modal>;
  }
  const byGame = new Map<string, BackupEntry[]>();
  for (const e of list ?? []) byGame.set(e.id, [...(byGame.get(e.id) ?? []), e]);
  return <Modal title="Sauvegardes de secours" width={640} onClose={close} footer={<>
    {intro && b.status === 'none' && <><button onClick={() => { decline(); close(); }}>Ne plus proposer</button><button onClick={close}>Plus tard</button></>}
    {b.status !== 'none' && <button onClick={() => store.ask(`Ne plus écrire de sauvegardes dans « ${b.name} » ? Les fichiers déjà écrits restent dans le dossier.`, () => void forgetFolder(), 'Arrêter')}>Arrêter</button>}
    <button onClick={() => { close(); importGame(); }}>Ouvrir un fichier…</button>
    <span class="sp" />
    <button class={b.status === 'none' ? 'primary' : ''} onClick={async () => { if (await chooseFolder()) store.notify(`Sauvegardes de secours dans « ${backup.name} »`); }}>{b.status === 'none' ? 'Choisir le dossier…' : 'Changer de dossier…'}</button>
    {b.status === 'needsPermission' && <button class="primary" onClick={() => void allowFolder()}>Autoriser « {b.name} »</button>}
    {b.status !== 'none' && b.status !== 'needsPermission' && <button class="primary" onClick={close}>Fermer</button>}
  </>}>
    <p>Le navigateur garde les parties dans son propre stockage : un autre navigateur, un navigateur qui efface ses données ou, dans Firefox, une copie du jeu dans un autre dossier ne les voient pas. En plus, le jeu peut écrire les <b>{KEEP} derniers tours</b> de chaque partie dans un dossier de votre choix, en fichiers .json (à chaque tour et après vos ordres). Au lancement, si le navigateur n'a plus aucune partie, le jeu reprend la plus récente de ces sauvegardes.</p>
    {b.status === 'none' && <p class="small muted">Choisissez par exemple le dossier du jeu, ou un dossier « Sauvegardes » à côté. Le navigateur demande votre accord ; s'il le propose, choisissez « Autoriser à chaque visite » pour ne pas avoir à le redonner.</p>}
    {b.status === 'needsPermission' && <p class="warn-text">Le navigateur demande de nouveau votre accord pour écrire dans « {b.name} » : cliquez sur « Autoriser » (choisissez « Autoriser à chaque visite » s'il le propose). En attendant, aucune sauvegarde de secours n'est écrite.</p>}
    {b.status === 'error' && <p class="warn-text">Le dossier « {b.name} » ne répond plus (déplacé ou supprimé ?) : choisissez-en un autre.</p>}
    {b.status === 'ok' && <p class="small">Dossier : <b>{b.name}</b>{b.last ? <> · dernier fichier : {b.last}</> : null}</p>}
    {b.status === 'ok' && list && !list.length && <p class="small muted">Aucune sauvegarde pour l'instant : la première s'écrit au prochain tour ou au prochain ordre.</p>}
    {b.status === 'ok' && [...byGame.values()].map(files => <div class="backup-game">
      <h4>{files[0].game}</h4>
      <ul class="backup-files">{files.map(e => <li>
        <span class="by">{e.year}</span>
        <span class="muted small">{new Date(e.modified).toLocaleString(LOCALE, { dateStyle: 'short', timeStyle: 'short' })} · {Math.round(e.size / 1024)} Ko</span>
        <span class="sp" />
        <button class="link" onClick={() => void open(e)}>Ouvrir</button>
      </li>)}</ul>
    </div>)}
  </Modal>;
}
