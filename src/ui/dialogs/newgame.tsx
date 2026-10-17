// New game (simple + advanced settings).
import { useState } from 'preact/hooks';
import { store, useStore } from '../store';
import { Modal, Row, Num, Tabs } from '../components';
import type { AIDifficulty, Density, GalaxyShape, GameSettings, PlayerPositions, Race, UniverseSize } from '../../engine/types';
import { createGame, defaultSettings, classicPreset, constellationsPreset, STARS_LAST, type NewPlayerConfig } from '../../engine/newgame';
import { SHAPE_LABELS, SHAPE_TEXT, SHAPES_OFFERED } from '../../engine/shape';
import { PREDEFINED_RACES, PREDEFINED_ORDER, PREDEFINED_LABELS, advantagePoints, PRT_INFO } from '../../engine/race';
import { AI_RACES } from '../../engine/airaces';
import { SIZE_LABELS, DENSITY_LABELS, POSITION_LABELS, planetCount } from '../../engine/universe';
import { RaceWizard, savedRaces, saveRace } from './race';
import { Rng, seedFromString } from '../../engine/rng';
import { RULE_INFO } from '../../engine/rules';
import { CONSTELLATIONS_RULES } from '../../engine/newgame';
import { originsFor } from '../../engine/origins';
import { startHosting } from '../../engine/pbem';
import { originUnlocked, originAchievement } from '../achievements';

type Opp = { race: number; diff: AIDifficulty | 'human'; hrace?: string };
const DIFF: Record<AIDifficulty, string> = { easy: 'Facile', standard: 'Standard', harder: 'Difficile', expert: 'Expert' };
/** 0.3.9.14: what each level of the computers does (aiskill.ts). */
const DIFF_TIP: Record<AIDifficulty, string> = {
  easy: 'Économie et guerre simples, peu de recherche, des guerres tardives.',
  standard: 'Entretient son économie et sa défense : modernise ses vaisseaux et ses stations, défend ses mondes menacés, garde ses flottes groupées, s\'étend plus vite et ne gaspille pas ses minerais.',
  harder: 'Comme Standard, et prépare ses invasions, conçoit ses navires contre ceux de l\'ennemi et s\'allie aux autres contre l\'empire qui écrase la partie. Recherche plus rapide, guerres plus précoces.',
  expert: 'Comme Difficile, avec la recherche la plus rapide et les guerres les plus précoces.',
};
const NAMES = ['Une promenade pieds nus', 'Le grand bazar stellaire', 'Les confins du zénith', 'La valse des comètes', 'Le dernier phare', 'Opération Tournesol', 'Les nébuleuses perdues', 'Croisière en eaux noires'];

export function NewGameDialog() {
  const s = useStore();
  // 3.6: a natural galaxy by default
  const [settings, setSettings] = useState<GameSettings>(() => ({ ...defaultSettings(), shape: 'arm', popUnits: 'millions' }));
  const [race, setRace] = useState<Race>(PREDEFINED_RACES.Humanoid());
  const [raceKey, setRaceKey] = useState('Humanoid');
  const [wizard, setWizard] = useState(false);
  const saved = savedRaces();
  const [tab, setTab] = useState<'simple' | 'advanced' | 'rules' | 'players' | 'victory'>('simple');
  const [name, setName] = useState(NAMES[Math.floor(Math.random() * NAMES.length)]);
  const [opponents, setOpponents] = useState<Opp[]>([{ race: 0, diff: 'standard' }, { race: 1, diff: 'standard' }, { race: 7, diff: 'standard' }]);
  const [origin, setOrigin] = useState('standard');
  const [byFiles, setByFiles] = useState(false);
  const set = (fn: (x: GameSettings) => void) => { const c = JSON.parse(JSON.stringify(settings)); fn(c); setSettings(c); };
  if (wizard) return <RaceWizard initial={race} onCancel={() => setWizard(false)} onDone={r => { saveRace(r); setRace(r); setRaceKey('saved:' + r.name); setWizard(false); }} />;
  const start = () => {
    const players: NewPlayerConfig[] = [{ race, ai: null, origin }];
    const rng = new Rng(seedFromString(settings.seed + 'races'));
    const used = new Set<number>();
    const names = new Set<string>([race.pluralName]);
    const unique = (n: string) => { let x = n, k = 2; while (names.has(x)) x = `${n} ${k++}`; names.add(x); return x; };
    for (const o of opponents) {
      if (o.diff === 'human') {
        const key = o.hrace ?? 'Humanoid';
        const r = key.startsWith('saved:') ? JSON.parse(JSON.stringify(saved.find(x => x.name === key.slice(6)) ?? PREDEFINED_RACES.Humanoid())) : PREDEFINED_RACES[key]();
        players.push({ race: r, ai: null, name: unique(r.pluralName) });
        continue;
      }
      let ri = o.race;
      if (ri < 0) { do { ri = rng.int(AI_RACES.length); } while (used.has(ri) && used.size < AI_RACES.length); }
      used.add(ri);
      const r = AI_RACES[ri]();
      players.push({ race: r, ai: o.diff, name: unique(r.pluralName) });
    }
    const g = createGame({ name, settings, players });
    s.close('newGame');
    // 0.3.9: each human at home, by turn files: this browser hosts
    const hosted = byFiles && players.filter(p => p.ai === null).length > 1;
    if (hosted) startHosting(g);
    s.setGame(g);
    if (hosted) { s.open('pbem'); s.notify('Partie hébergée : envoyez à chaque joueur son fichier de tour.'); }
    else s.notify('Nouvelle partie créée. Bonne chance !');
  };
  const pts = advantagePoints(race);
  return (
    <Modal title="Nouvelle partie" wide onClose={() => s.close('newGame')} footer={<>
      <span class="muted small">{planetCount(settings.size, settings.density)} planètes · {opponents.length + 1} joueurs</span><span class="sp" />
      <button onClick={() => s.close('newGame')}>Annuler</button>
      <button class="primary" disabled={pts < 0} onClick={start}>Commencer la partie</button>
    </>}>
      <Tabs tabs={[{ id: 'simple' as const, label: 'Partie' }, { id: 'advanced' as const, label: 'Options avancées' }, { id: 'rules' as const, label: 'Règles Constellations' }, { id: 'players' as const, label: `Adversaires (${opponents.length})` }, { id: 'victory' as const, label: 'Conditions de victoire' }]} value={tab} onChange={setTab} />
      {tab === 'simple' && <ClassicPreset settings={settings} set={set} />}
      {tab === 'simple' && <div class="ng">
        <div>
          <h4>Votre race</h4>
          <select value={raceKey} onChange={e => { const k = (e.target as HTMLSelectElement).value; setRaceKey(k); if (k.startsWith('saved:')) { const r = saved.find(x => x.name === k.slice(6)); if (r) setRace(JSON.parse(JSON.stringify(r))); } else setRace(PREDEFINED_RACES[k]()); }}>
            {PREDEFINED_ORDER.map(k => <option value={k}>{PREDEFINED_LABELS[k]} · {PRT_INFO[PREDEFINED_RACES[k]().prt].name}</option>)}
            {saved.length > 0 && <optgroup label="Vos races">{saved.map(r => <option value={'saved:' + r.name}>{r.name} · {PRT_INFO[r.prt].name}</option>)}</optgroup>}
          </select>
          <div class="btnrow"><button onClick={() => setWizard(true)}>Personnaliser la race…</button>
          <button onClick={() => s.open('import', { kind: 'race', onRace: (r: Race) => { setRace(r); setRaceKey('saved:' + r.name); } })}>Importer une race…</button>
          <button onClick={() => s.open('export', { title: 'Exporter la race', text: JSON.stringify(race, null, 1), file: `race-${race.name}.json` })}>Exporter</button></div>
          <p class="small muted">{PRT_INFO[race.prt].desc}</p>
          <p class="small">{race.lrts.length ? 'Traits : ' + race.lrts.join(', ') : 'Aucun trait secondaire'} · points restants {pts}</p>
          {settings.origins && <>
            <h4>Origine</h4>
            <div class="origin-pick">{originsFor({ settings }, race).map(o => { const free = originUnlocked(o.id), a = originAchievement(o.id); return <button class={(origin === o.id ? 'on' : '') + (free ? '' : ' locked-origin')} disabled={!free} onClick={() => setOrigin(o.id)} aria-pressed={origin === o.id}>
              <b>{o.name}</b>{!free && <small class="gold">{a?.secret ? 'À débloquer par un succès secret.' : `À débloquer par le succès « ${a?.name ?? '?'} ».`}</small>}<small>{o.text}</small>
              {o.pros.length > 0 && <small><span class="green">+</span> {o.pros.join(' ; ')}</small>}
              {o.cons.length > 0 && <small><span class="red">−</span> {o.cons.join(' ; ')}</small>}
            </button>; })}</div>
            <p class="small muted">Les ordinateurs tirent leur origine au sort.</p>
          </>}
        </div>
        <div>
          <h4>Taille de l'univers</h4>
          {(Object.keys(SIZE_LABELS) as UniverseSize[]).map(k => <label class="radio"><input type="radio" checked={settings.size === k} onChange={() => set(x => { x.size = k; })} /> {SIZE_LABELS[k]} <span class="muted small">({planetCount(k, settings.density)} planètes)</span></label>)}
          <h4>Région de la galaxie</h4>
          {SHAPES_OFFERED.map(k => <label class="radio" title={SHAPE_TEXT[k]}><input type="radio" checked={(settings.shape ?? 'square') === k} onChange={() => set(x => { x.shape = k; })} /> {SHAPE_LABELS[k]}</label>)}
          <p class="small muted">{SHAPE_TEXT[settings.shape ?? 'square']}</p>
          <h4>Difficulté des adversaires</h4>
          {(Object.keys(DIFF) as AIDifficulty[]).map(k => <label class="radio" title={DIFF_TIP[k]}><input type="radio" checked={opponents.filter(o => o.diff !== 'human').every(o => o.diff === k)} onChange={() => setOpponents(opponents.map(o => o.diff === 'human' ? o : { ...o, diff: k }))} /> {DIFF[k]}</label>)}
          {(() => { const ds = [...new Set(opponents.filter(o => o.diff !== 'human').map(o => o.diff as AIDifficulty))]; return ds.length === 1 ? <p class="small muted">{DIFF_TIP[ds[0]]}</p> : null; })()}
          {opponents.some(o => o.diff === 'human') && <>
            <p class="small muted">{byFiles ? `Partie par fichiers : ${opponents.filter(o => o.diff === 'human').length + 1} joueurs humains jouent chacun chez soi ; ce navigateur héberge la partie.` : `Partie à plusieurs sur cet appareil : ${opponents.filter(o => o.diff === 'human').length + 1} joueurs humains jouent chacun leur tour.`}</p>
            <label class="chk"><input type="checkbox" checked={byFiles} onChange={e => setByFiles((e.target as HTMLInputElement).checked)} /> Chacun joue chez soi, par fichiers de tour (comme Stars! par courrier)</label>
          </>}
          <Row k="Nombre d'adversaires" v={<Num value={opponents.length} min={1} max={15} onChange={v => { const n = Math.max(1, Math.min(15, v)); const arr = [...opponents]; while (arr.length < n) arr.push({ race: -1, diff: opponents[0]?.diff ?? 'standard' }); arr.length = n; setOpponents(arr); }} width={60} />} />
        </div>
      </div>}
      {tab === 'advanced' && <div class="ng">
        <div>
          <Row k="Nom de la partie" v={<input value={name} onInput={e => setName((e.target as HTMLInputElement).value)} />} />
          <Row k="Graine (univers reproductible)" v={<input value={settings.seed} onInput={e => set(x => { x.seed = (e.target as HTMLInputElement).value; })} />} />
          <h4>Densité</h4>
          {(Object.keys(DENSITY_LABELS) as Density[]).map(k => <label class="radio"><input type="radio" checked={settings.density === k} onChange={() => set(x => { x.density = k; })} /> {DENSITY_LABELS[k]}</label>)}
          <h4>Positions des joueurs</h4>
          {(Object.keys(POSITION_LABELS) as PlayerPositions[]).map(k => <label class="radio"><input type="radio" checked={settings.positions === k} onChange={() => set(x => { x.positions = k; })} /> {POSITION_LABELS[k]}</label>)}
        </div>
        <div>
          <h4>Options</h4>
          <label class="chk"><input type="checkbox" checked={settings.maxMinerals} onChange={e => set(x => { x.maxMinerals = (e.target as HTMLInputElement).checked; })} /> Débutant : minerais maximaux</label>
          <label class="chk"><input type="checkbox" checked={settings.slowTech} onChange={e => set(x => { x.slowTech = (e.target as HTMLInputElement).checked; })} /> Progrès technologique plus lent</label>
          <label class="chk"><input type="checkbox" checked={settings.accelerated} onChange={e => set(x => { x.accelerated = (e.target as HTMLInputElement).checked; })} /> Partie accélérée (départ plus riche)</label>
          <label class="chk"><input type="checkbox" checked={!settings.randomEvents} onChange={e => set(x => { x.randomEvents = !(e.target as HTMLInputElement).checked; })} /> Pas d'événements aléatoires (comètes, Marchand…)</label>
          <label class="chk"><input type="checkbox" checked={settings.aiAlliances} onChange={e => set(x => { x.aiAlliances = (e.target as HTMLInputElement).checked; })} /> Les ordinateurs forment des alliances</label>
          <label class="chk"><input type="checkbox" checked={settings.publicScores} onChange={e => set(x => { x.publicScores = (e.target as HTMLInputElement).checked; })} /> Scores publics</label>
          <label class="chk"><input type="checkbox" checked={settings.clumping} onChange={e => set(x => { x.clumping = (e.target as HTMLInputElement).checked; })} /> Galaxie en amas</label>
          <label class="chk"><input type="checkbox" checked={settings.anonymousContacts} onChange={e => set(x => { x.anonymousContacts = (e.target as HTMLInputElement).checked; })} /> Contacts anonymes hors scanner pénétrant <span class="muted small">(décoché : toute flotte détectée est identifiée)</span></label>
        </div>
      </div>}
      {tab === 'players' && <div>
        <table class="report">
          <thead><tr><th>#</th><th>Race</th><th>Joueur</th><th></th></tr></thead>
          <tbody>
            <tr><td>1</td><td><b>Vous</b> : {race.name}</td><td>Humain</td><td></td></tr>
            {opponents.map((o, i) => <tr><td>{i + 2}</td>
              <td>{o.diff === 'human'
                ? <select value={o.hrace ?? 'Humanoid'} onChange={e => { const arr = [...opponents]; arr[i] = { ...o, hrace: (e.target as HTMLSelectElement).value }; setOpponents(arr); }}>{PREDEFINED_ORDER.map(k => <option value={k}>{PREDEFINED_LABELS[k]}</option>)}{saved.map(r => <option value={'saved:' + r.name}>{r.name}</option>)}</select>
                : <select value={o.race} onChange={e => { const arr = [...opponents]; arr[i] = { ...o, race: +(e.target as HTMLSelectElement).value }; setOpponents(arr); }}><option value={-1}>Aléatoire</option>{AI_RACES.map((r, k) => { const rr = r(); return <option value={k}>{rr.pluralName} ({rr.prt})</option>; })}</select>}</td>
              <td><select value={o.diff} onChange={e => { const arr = [...opponents]; arr[i] = { ...o, diff: (e.target as HTMLSelectElement).value as Opp['diff'] }; setOpponents(arr); }}>{(Object.keys(DIFF) as AIDifficulty[]).map(k => <option value={k} title={DIFF_TIP[k]}>Ordinateur {DIFF[k].toLowerCase()}</option>)}<option value="human">Humain (même appareil)</option></select></td>
              <td><button class="link" onClick={() => setOpponents(opponents.filter((_, k) => k !== i))} disabled={opponents.length <= 1}>✕</button></td></tr>)}
          </tbody>
        </table>
        <button onClick={() => opponents.length < 15 && setOpponents([...opponents, { race: -1, diff: 'standard' }])}>Ajouter un adversaire</button>
      </div>}
      {tab === 'rules' && <div class="rules-tab">
        <p class="small muted">Constellations ajoute ces règles à celles de Stars!. Toutes sont actives par défaut ; décochez-les pour retrouver le jeu d'origine (ou cochez « Expérience proche de Stars! » dans l'onglet Partie). En cours de partie (Paramètres de la partie), on peut en ajouter mais plus en retirer ; les origines se choisissent au départ.</p>
        <div class="btnrow"><button class="small" onClick={() => set(x => { for (const k of CONSTELLATIONS_RULES) (x as any)[k] = true; })}>Toutes</button><button class="small" onClick={() => set(x => { for (const k of CONSTELLATIONS_RULES) (x as any)[k] = false; })}>Aucune (Stars! classique)</button></div>
        <div class="rules-list">{CONSTELLATIONS_RULES.map(k => <label class="chk rule"><input type="checkbox" checked={!!(settings as any)[k]} onChange={e => set(x => { (x as any)[k] = (e.target as HTMLInputElement).checked; })} /> <span class="rule-txt"><b>{RULE_INFO[k].name}</b><small class="muted">{RULE_INFO[k].text}</small></span></label>)}</div>
      </div>}
      {tab === 'victory' && <VictoryEditor settings={settings} set={set} />}
    </Modal>
  );
}

function VictoryEditor({ settings, set }: { settings: GameSettings; set: (fn: (x: GameSettings) => void) => void }) {
  const v = settings.victory;
  const tog = (on: boolean, fn: (x: GameSettings) => void) => set(fn);
  return <div class="victory-ed">
    <p>La victoire est déclarée quand un joueur :</p>
    <label class="chk"><input type="checkbox" checked={v.ownPlanets !== null} onChange={e => tog(true, x => { x.victory.ownPlanets = (e.target as HTMLInputElement).checked ? 60 : null; })} /> possède <Num value={v.ownPlanets ?? 60} min={20} max={100} step={5} onChange={n => set(x => { x.victory.ownPlanets = n; })} width={60} /> % des planètes</label>
    <label class="chk"><input type="checkbox" checked={v.attainTech !== null} onChange={e => tog(true, x => { x.victory.attainTech = (e.target as HTMLInputElement).checked ? { level: 22, fields: 4 } : null; })} /> atteint le niveau <Num value={v.attainTech?.level ?? 22} min={8} max={26} onChange={n => set(x => { x.victory.attainTech = { level: n, fields: x.victory.attainTech?.fields ?? 4 }; })} width={60} /> dans <Num value={v.attainTech?.fields ?? 4} min={2} max={6} onChange={n => set(x => { x.victory.attainTech = { level: x.victory.attainTech?.level ?? 22, fields: n }; })} width={50} /> domaines</label>
    <label class="chk"><input type="checkbox" checked={v.exceedScore !== null} onChange={e => tog(true, x => { x.victory.exceedScore = (e.target as HTMLInputElement).checked ? 11000 : null; })} /> dépasse un score de <Num value={v.exceedScore ?? 11000} min={1000} max={20000} step={1000} onChange={n => set(x => { x.victory.exceedScore = n; })} width={80} /></label>
    <label class="chk"><input type="checkbox" checked={v.exceedSecond !== null} onChange={e => tog(true, x => { x.victory.exceedSecond = (e.target as HTMLInputElement).checked ? 100 : null; })} /> a un score supérieur d'au moins <Num value={v.exceedSecond ?? 100} min={20} max={300} step={10} onChange={n => set(x => { x.victory.exceedSecond = n; })} width={60} /> % à celui du deuxième</label>
    <label class="chk"><input type="checkbox" checked={v.production !== null} onChange={e => tog(true, x => { x.victory.production = (e.target as HTMLInputElement).checked ? 100 : null; })} /> produit <Num value={v.production ?? 100} min={10} max={500} step={10} onChange={n => set(x => { x.victory.production = n; })} width={60} /> milliers de ressources par an</label>
    <label class="chk"><input type="checkbox" checked={v.capitalShips !== null} onChange={e => tog(true, x => { x.victory.capitalShips = (e.target as HTMLInputElement).checked ? 100 : null; })} /> possède <Num value={v.capitalShips ?? 100} min={10} max={300} step={10} onChange={n => set(x => { x.victory.capitalShips = n; })} width={60} /> vaisseaux capitaux</label>
    <label class="chk"><input type="checkbox" checked={v.highestAfter !== null} onChange={e => tog(true, x => { x.victory.highestAfter = (e.target as HTMLInputElement).checked ? 100 : null; })} /> a le meilleur score après <Num value={v.highestAfter ?? 100} min={30} max={900} step={10} onChange={n => set(x => { x.victory.highestAfter = n; })} width={60} /> ans</label>
    <Row k="Nombre de critères requis" v={<Num value={v.numCriteria} min={1} max={7} onChange={n => set(x => { x.victory.numCriteria = n; })} width={50} />} />
    <Row k="Années minimales avant victoire" v={<Num value={v.minYears} min={10} max={500} step={10} onChange={n => set(x => { x.victory.minYears = n; })} width={60} />} />
  </div>;
}

export { store };

/** 3.6: one switch for an experience close to the original Stars! (its last version). */
function ClassicPreset({ settings, set }: { settings: GameSettings; set: (fn: (x: GameSettings) => void) => void }) {
  const on = !!settings.classic;
  const changed = on && ((settings.shape ?? 'square') !== 'square' || CONSTELLATIONS_RULES.some(k => !!(settings as any)[k]));
  return <label class={'preset' + (on ? ' on' : '')}>
    <input type="checkbox" checked={on} onChange={e => set(x => { if ((e.target as HTMLInputElement).checked) classicPreset(x); else constellationsPreset(x); })} />
    <span><b>Expérience proche de Stars! {STARS_LAST.version} ({STARS_LAST.year}){changed ? ' · modifiée' : ''}</b>
      <small>{on
        ? 'Les règles du jeu d\'origine : galaxie carrée, aucune règle Constellations, flottes identifiées dès qu\'elles sont vues, trous de ver franchissables d\'emblée, modèles de production qui ne s\'enchaînent pas, victoire au plus tôt après 50 ans. Les aides d\'interface (automatisations, planificateurs, rapports, simulateur) restent.'
        : `Pour retrouver Stars! tel qu'il était dans sa dernière version (${STARS_LAST.version}, ${STARS_LAST.year}) : toutes les règles Constellations retirées, galaxie carrée.`}</small></span>
  </label>;
}
