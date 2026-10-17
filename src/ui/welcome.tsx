// Opening screen.
import { useEffect, useRef } from 'preact/hooks';
import { store, useStore } from './store';
import { importGame } from './app';
import { quickGame } from '../engine/newgame';
import { planetImage } from './art';
import { LangPicker } from './langpick';
import { unlockedCount, ACHIEVEMENTS } from './achievements';
import { backup, backupSupported, backupInFrame, allowFolder, chooseFolder } from './backup';
import { useBackup } from './dialogs/backups';
import { openTutorial } from './tutorial';
import { useUpdate } from './update';
import { VERSION } from './version';

/** A click on the welcome screen is the moment to let the browser ask again for the backup folder (it needs one). */
function renewFolder() { if (backup.status === 'needsPermission') void allowFolder(); }

/** 0.3.6.7: where the backup files are, and what to do when the browser lost the games. */
function BackupLine() {
  const s = useStore();
  const b = useBackup();
  const restore = async () => {
    if ((b.status === 'none' || b.status === 'error') && !await chooseFolder()) return;
    if (b.status === 'needsPermission' && !await allowFolder()) return;
    if (!s.saved && !await s.restoreLatestBackup()) s.notify('Aucune sauvegarde de secours dans ce dossier');
  };
  if (backupInFrame()) return <p class="small muted backup-line">Pas de sauvegardes de secours dans cette page intégrée à un autre site : ouvrez index.html directement pour en avoir, ou exportez vos parties.</p>;
  if (!backupSupported()) return <p class="small muted backup-line">Pas de sauvegardes de secours dans ce navigateur (seuls Chrome et Edge peuvent écrire dans un dossier) : exportez vos parties.</p>;
  return <div class="backup-line small">
    {s.restoredFrom && <p class="ok-text">Partie retrouvée dans la sauvegarde de secours « {s.restoredFrom} ».</p>}
    {b.status === 'ok' && <p class="muted">Sauvegardes de secours : les 5 derniers tours de chaque partie dans « {b.name} ». <button class="link" onClick={() => s.open('backups')}>Voir les sauvegardes</button></p>}
    {b.status === 'needsPermission' && <p>Sauvegardes de secours dans « {b.name} » : le navigateur demande votre accord. {s.saved ? <button class="link" onClick={() => void allowFolder()}>Autoriser</button> : <button class="link" onClick={() => void restore()}>Autoriser et reprendre la dernière partie</button>}</p>}
    {(b.status === 'none' || b.status === 'error') && <p>{s.saved ? 'Aucun dossier de sauvegardes de secours.' : 'Aucune partie dans ce navigateur.'} <button class="link" onClick={() => void restore()}>{s.saved ? 'Choisir un dossier…' : 'Reprendre depuis un dossier de sauvegardes…'}</button> · <button class="link" onClick={() => s.open('backups')}>En savoir plus</button></p>}
  </div>;
}

/** 0.3.9.18: a newer version is out (local copy). */
function UpdateBanner() {
  const list = useUpdate();
  if (!list.length) return null;
  return <div class="update-banner">{`Nouvelle version ${list[0].version} disponible (vous avez la ${VERSION}).`} <button class="link" onClick={() => store.open('update')}>Voir les nouveautés et la télécharger</button></div>;
}

export function Welcome() {
  const s = useStore();
  const saved = s.saved;
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = cv.current; if (!c) return;
    const ctx = c.getContext('2d')!;
    let raf = 0; let t = 0;
    const stars = Array.from({ length: 420 }, () => ({ x: Math.random(), y: Math.random(), z: Math.random() }));
    const loop = () => {
      c.width = c.clientWidth; c.height = c.clientHeight;
      ctx.fillStyle = '#02040a'; ctx.fillRect(0, 0, c.width, c.height);
      t += 0.0006;
      for (const st of stars) {
        const x = ((st.x + t * st.z * 0.6) % 1) * c.width, y = st.y * c.height;
        ctx.fillStyle = `rgba(200,220,255,${0.25 + st.z * 0.6})`;
        ctx.fillRect(x, y, st.z > 0.85 ? 2 : 1, st.z > 0.85 ? 2 : 1);
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div class="welcome">
      <canvas ref={cv} class="welcome-bg" />
      <div class="welcome-card">
        <img class="welcome-planet" src={planetImage(42, [55, 48, 70], 220)} alt="" />
        <h1>✦ Constellations</h1>
        <p class="sub">Stratégie spatiale au tour par tour</p>
        <div class="welcome-btns">
          {saved && <button class="primary big" onClick={() => { renewFolder(); s.setGame(saved, false); }}>Continuer · {saved.name} ({saved.year})</button>}
          {s.slots.some(sl => sl.id === 'tutorial') ? <div class="tut-row">
            <button class="big tut-start" onClick={() => { renewFolder(); void openTutorial(); }} title="Reprendre le tutoriel là où vous l'aviez laissé">✦ Tutoriel<small>reprendre où vous en étiez</small></button>
            <button class="link small" onClick={() => { renewFolder(); void openTutorial(true); }}>Recommencer le tutoriel</button>
          </div> : <button class={'big tut-start' + (saved ? '' : ' primary')} onClick={() => { renewFolder(); void openTutorial(); }} title="Apprendre à jouer, pas à pas, dans une vraie partie">✦ Tutoriel<small>apprendre à jouer pas à pas</small></button>}
          <button class="big" onClick={() => { renewFolder(); s.open('newGame'); }}>Nouvelle partie…</button>
          <button class="big" onClick={() => { renewFolder(); s.setGame(quickGame(undefined, 'Small', 3, 'standard', undefined, { shape: 'arm', popUnits: 'millions' })); s.notify('Partie rapide : Terriens contre trois empires, dans un bras spiral (petite carte)'); }}>Partie rapide</button>
          <button onClick={importGame}>Importer une partie…</button>
          <button onClick={() => s.open('raceWizard', { standalone: true })}>Assistant de race…</button>
          <button onClick={() => s.open('help')}>Guide du joueur</button>
          <button onClick={() => s.open('prefs')}>Affichage et son…</button>
          <button onClick={() => s.open('achievements')}>Succès ({unlockedCount()} sur {ACHIEVEMENTS.length})</button>
        </div>
        {s.slots.some(sl => sl.id !== saved?.id) && <div class="slots">
          <h4>Autres parties de ce navigateur</h4>
          <ul>{s.slots.filter(sl => sl.id !== saved?.id).map(sl => <li>
            <button class="link" onClick={async () => { const g = await s.readSlot(sl.id); if (g) s.setGame(g, false); else s.notify('Partie illisible'); }}>{sl.name}</button>
            <span class="muted small">{sl.race} · {sl.year}{sl.humans > 1 ? ` · ${sl.humans} joueurs` : ''}</span>
            <button class="link del" title="Supprimer cette sauvegarde" onClick={() => s.ask(`Supprimer définitivement la partie « ${sl.name} » (${sl.year}) de ce navigateur ?`, () => s.deleteSlot(sl.id), 'Supprimer')}>✕</button>
          </li>)}</ul>
        </div>}
        <UpdateBanner />
        <BackupLine />
        <p class="small muted">Tout se déroule dans votre navigateur, hors ligne. Sauvegarde automatique locale (huit parties au plus).</p>
        <LangPicker />
      </div>
    </div>
  );
}

export { store };
