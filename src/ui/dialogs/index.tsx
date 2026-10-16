// Renders the stack of open dialogs.
import { DiplomacyDialog } from '../diplomacy';
import { useState } from 'preact/hooks';
import { store, useStore, saveFile, saveMode } from '../store';
import { Modal } from '../components';
import { saveRace } from './race';
import { ProductionDialog } from './production';
import { ResearchDialog } from './research';
import { DesignerDialog, TechBrowserDialog } from './designer';
import { ReportsDialog, ScoreDialog } from './reports';
import { VictoryDialog } from '../victory';
import { PrefsDialog } from './prefs';
import { ChronicleDialog, AchievementsDialog } from '../chronicle';
import { PbemDialog } from '../pbemui';
import * as PB from '../../engine/pbem';
import { DilemmaDialog } from '../destiny';
import { BattleDialog } from './battle';
import { CargoDialog, SplitDialog, MergeDialog } from './fleetops';
import { UpgradeDialog } from './upgrade';
import { DesignViewDialog } from './designview';
import { RaceWizard, RaceView } from './race';
import { NewGameDialog } from './newgame';
import { BackupsDialog } from './backups';
import { BattlePlansDialog, RelationsDialog, FindDialog, TemplatesDialog, HelpDialog, AboutDialog, GameOverDialog, SettingsDialog } from './misc';

export function Dialogs() {
  const s = useStore();
  return <>{s.dialogs.map(d => {
    if (!s.game && !['newGame', 'raceWizard', 'about', 'help', 'import', 'export', 'confirm', 'backups', 'prefs', 'achievements'].includes(d.kind)) return null;
    switch (d.kind) {
      case 'production': return <ProductionDialog planetId={d.data?.planetId} />;
      case 'research': return <ResearchDialog />;
      case 'designer': return <DesignerDialog designId={d.data?.designId} view={d.data?.view} />;
      case 'techBrowser': return <TechBrowserDialog focus={d.data?.name} />;
      case 'reports': return <ReportsDialog tab={d.data?.tab} />;
      case 'score': return <ScoreDialog />;
      case 'victory': return <VictoryDialog />;
      case 'prefs': return <PrefsDialog />;
      case 'chronicle': return <ChronicleDialog tab={d.data?.tab} />;
      case 'achievements': return <AchievementsDialog />;
      case 'dilemma': return <DilemmaDialog id={d.data?.id} />;
      case 'pbem': return <PbemDialog />;
      case 'battle': return <BattleDialog battleId={d.data?.battleId} />;
      case 'cargo': return <CargoDialog fleetId={d.data?.fleetId} planetId={d.data?.planetId} otherId={d.data?.otherId} />;
      case 'split': return <SplitDialog fleetId={d.data?.fleetId} />;
      case 'merge': return <MergeDialog fleetId={d.data?.fleetId} />;
      case 'raceWizard': return <RaceWizard onCancel={() => s.close('raceWizard')} onDone={r => { s.close('raceWizard'); saveRace(r); s.open('export', { title: 'Race enregistrée', text: JSON.stringify(r, null, 1), file: `race-${r.name}.json`, note: 'La race est aussi mémorisée dans ce navigateur (liste des races de « Nouvelle partie »). Conservez ce texte pour la réutiliser ailleurs : « Nouvelle partie » puis « Importer une race ».' }); }} />;
      case 'confirm': return <ConfirmDialog {...d.data} />;
      case 'upgrade': return <UpgradeDialog part={d.data?.part} />;
      case 'designView': return <DesignViewDialog designId={d.data?.designId} planetId={d.data?.planetId} key={'dv' + d.data?.designId} />;
      case 'warn': return <WarnDialog {...d.data} />;
      case 'export': return <ExportDialog {...d.data} />;
      case 'import': return <ImportDialog {...d.data} />;
      case 'backups': return <BackupsDialog intro={d.data?.intro} />;
      case 'raceView': return <RaceView />;
      case 'newGame': return <NewGameDialog />;
      case 'battlePlans': return <BattlePlansDialog />;
      case 'relations': return store.game?.settings.diplomacy && store.game.diplomacy ? <DiplomacyDialog /> : <RelationsDialog />;
      case 'find': return <FindDialog />;
      case 'templates': return <TemplatesDialog />;
      case 'help': return <HelpDialog tab={d.data?.tab} />;
      case 'about': return <AboutDialog />;
      case 'gameOver': return <GameOverDialog />;
      case 'settings': return <SettingsDialog />;
      default: return null;
    }
  })}</>;
}

/** Blocking warning with a choice of actions (each closes the window). */
function WarnDialog({ title, message, actions }: { title: string; message: string; actions: { label: string; primary?: boolean; run: () => void }[] }) {
  return <Modal title={<><span class="warn-ico" aria-hidden="true">⚠</span>{title}</>} width={520} cls="warn-dlg" onClose={() => store.close('warn')} footer={<><span class="sp" />{actions.map(a => <button class={a.primary ? 'primary' : ''} onClick={() => { store.close('warn'); a.run(); }}>{a.label}</button>)}</>}>
    <p>{message}</p>
  </Modal>;
}

function ConfirmDialog({ message, onYes, yesLabel }: { message: string; onYes: () => void; yesLabel?: string }) {
  return <Modal title="Confirmation" width={480} onClose={() => store.close('confirm')} footer={<><span class="sp" /><button onClick={() => store.close('confirm')}>Annuler</button><button class="primary" onClick={() => { store.close('confirm'); onYes(); }}>{yesLabel ?? 'Confirmer'}</button></>}>
    <p>{message}</p>
  </Modal>;
}

export function ExportDialog({ title, text, file, note }: { title: string; text: string; file: string; note?: string }) {
  const [copied, setCopied] = useState(false);
  let ta: HTMLTextAreaElement | null = null;
  return <Modal title={title} width={680} onClose={() => store.close('export')} footer={<>
    {saveMode() !== 'none' && <button disabled={saveMode() === 'pending'} onClick={() => { void saveFile(file, text); }}>Télécharger le fichier</button>}
    <span class="sp" />
    <button class="primary" onClick={() => { navigator.clipboard?.writeText(text).then(() => setCopied(true), () => { ta?.select(); setCopied(false); }); if (!navigator.clipboard) ta?.select(); }}>{copied ? 'Copié' : 'Copier le texte'}</button>
  </>}>
    {note && <p class="small muted">{note}</p>}
    <textarea id="export-text" class="export-text" readOnly ref={el => { ta = el; }} onFocus={e => (e.target as HTMLTextAreaElement).select()}>{text}</textarea>
    <p class="small muted">Vous pouvez aussi copier ce texte dans un fichier .json : il se réimporte par « Importer » ou en le collant.</p>
  </Modal>;
}

function ImportDialog({ kind, onRace }: { kind?: 'game' | 'race'; onRace?: (r: any) => void }) {
  const [txt, setTxt] = useState('');
  const [err, setErr] = useState('');
  const load = (raw: string) => {
    try {
      const g = JSON.parse(raw);
      if (kind === 'race') { if (!g.prt || !g.habLow) throw new Error('ce n\'est pas une race'); store.close('import'); saveRace(g); onRace?.(g); store.notify('Race importée'); return; }
      // 0.3.9: a turn file opens the turn; an orders file goes to the hosted game open here
      if (g.format === PB.TURN_FORMAT || g.format === PB.ORDERS_FORMAT) {
        const r = PB.readPbem(raw)!;
        if (r.file.format === PB.TURN_FORMAT) { store.close('import'); store.setGame(PB.openTurn(r.file, r.game)); store.notify(`Tour ${r.file.year} des ${r.game.players[r.file.player].name} : donnez vos ordres, puis envoyez-les.`); return; }
        const host = store.game;
        if (!host?.pbem || host.pbem.role !== 'host') throw new Error('ouvrez d\'abord la partie hébergée (écran d\'accueil, sauvegardes), puis importez ces ordres');
        store.checkpoint();
        const err = PB.mergeOrders(host, r.file, r.game);
        if (err) throw new Error(err);
        store.close('import'); store.save(); store.open('pbem'); store.notify(`Ordres des ${host.players[r.file.player].name} reçus.`);
        return;
      }
      if (g.format !== 'constellations-1') throw new Error('format inconnu');
      delete g.id; // a fresh save slot, never overwrite another game
      store.close('import'); store.setGame(g); store.notify('Partie importée');
    } catch (e) { setErr('Contenu invalide : ' + (e as Error).message); }
  };
  return <Modal title={kind === 'race' ? 'Importer une race' : 'Importer une partie'} width={640} onClose={() => store.close('import')} footer={<>
    <label class="filebtn">Choisir un fichier…<input id="import-file" type="file" accept=".json,application/json" onChange={async e => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) load(await f.text()); }} /></label>
    <span class="sp" /><button class="primary" disabled={!txt.trim()} onClick={() => load(txt)}>Importer le texte collé</button>
  </>}>
    <p class="small muted">Choisissez un fichier exporté, ou collez son contenu ci-dessous.</p>
    <textarea id="import-text" class="export-text" value={txt} onInput={e => setTxt((e.target as HTMLTextAreaElement).value)} placeholder="Collez ici le texte de la sauvegarde" />
    {err && <div class="alert">{err}</div>}
  </Modal>;
}
