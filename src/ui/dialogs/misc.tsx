// Battle plans, relations, colony planner, find, templates, help, about, game over.
import { useState } from 'preact/hooks';
import { store, useStore, fmt, fmtPop } from '../store';
import { popScale } from '../../engine/words';
import { Modal, Row, Tabs, PlanetImg, MineralLine, useSorted } from '../components';
import type { AttackWho, BattlePlan, Relation, Tactic, TargetClass, QueueKind, GameState, Player } from '../../engine/types';
import { ORIGIN_WINS } from '../../engine/originwins';
import { habitability, raceSpec, PRT_INFO } from '../../engine/race';
import { terraformedHabValue } from '../../engine/planet';
import { fleetSpec, distance, travelYears } from '../../engine/fleet';
import { QUEUE_LABELS, isAuto, TEMPLATE_CHAIN } from '../../engine/production';
import { VERSION } from '../version';
import { CONSTELLATIONS_RULES } from '../../engine/newgame';
import { RULE_INFO } from '../../engine/rules';
import { OBJ, objectiveText, OBJECTIVE_POINTS } from '../../engine/objectives';
import { ADMIN_RADIUS, ADMIN_LOSS, ADMIN_STEP, ADMIN_FLOOR, REGIONAL_PER_WORLDS, CONQUEST_START, CONQUEST_YEARS, DISORG_YEARS, DISORG_FACTOR } from '../../engine/empire';
import * as A from '../actions';
import { intelOn } from '../../engine/espionage';
import { DossierBlock, IntelLevel } from '../intel';
import { openTutorial } from '../tutorial';
import { ChronicleView, shareChronicle } from '../chronicle';

const TARGETS: Record<TargetClass, string> = { none: 'Aucune / désengagement', any: 'N\'importe laquelle', starbase: 'Stations orbitales', armed: 'Vaisseaux armés', bomberFreighter: 'Bombardiers / cargos', unarmed: 'Vaisseaux non armés', fuelTransport: 'Transports de carburant', freighter: 'Cargos' };
const TACTICS: Record<Tactic, string> = { disengage: 'Se désengager', disengageIfChallenged: 'Se désengager si attaqué', minimizeDamage: 'Minimiser les dégâts subis', maximizeNetDamage: 'Maximiser les dégâts nets', maximizeDamageRatio: 'Maximiser le ratio de dégâts', maximizeDamage: 'Maximiser les dégâts infligés' };

export function BattlePlansDialog() {
  const s = useStore();
  const g = s.game!, me = s.me!;
  const [sel, setSel] = useState(0);
  const plan = me.battlePlans[sel] ?? me.battlePlans[0];
  const upd = (fn: (p: BattlePlan) => void) => { s.checkpoint(); fn(plan); s.bump(); };
  const who: [AttackWho, string][] = [['nobody', 'Personne'], ['enemies', 'Ennemis'], ['enemiesAndNeutrals', 'Ennemis et neutres'], ['everyone', 'Tout le monde'], ...me.intel.met.map(p => [`player:${p}` as AttackWho, g.players[p].name] as [AttackWho, string])];
  return (
    <Modal title="Plans de bataille" onClose={() => s.close('battlePlans')} width={760} footer={<button class="primary" onClick={() => s.close('battlePlans')}>Terminé</button>}>
      <div class="bp">
        <div>
          <ul class="list">{me.battlePlans.map((b, i) => <li class={i === sel ? 'sel' : ''} onClick={() => setSel(i)}>{b.name}</li>)}</ul>
          <button onClick={() => { s.checkpoint(); me.battlePlans.push({ ...plan, id: Math.max(...me.battlePlans.map(b => b.id)) + 1, name: 'Nouveau plan' }); setSel(me.battlePlans.length - 1); s.bump(); }}>Nouveau</button>
          <button disabled={sel === 0} onClick={() => { s.checkpoint(); const id = plan.id; me.battlePlans.splice(sel, 1); for (const f of g.fleets) if (f.owner === me.id && f.battlePlan === id) f.battlePlan = 0; setSel(0); s.bump(); }}>Supprimer</button>
        </div>
        <div class="bp-edit">
          <Row k="Nom" v={<input value={plan.name} disabled={sel === 0} onInput={e => upd(p => { p.name = (e.target as HTMLInputElement).value; })} />} />
          <Row k="Cible principale" v={<select value={plan.primary} onChange={e => upd(p => { p.primary = (e.target as HTMLSelectElement).value as TargetClass; })}>{Object.entries(TARGETS).map(([k, l]) => <option value={k}>{l}</option>)}</select>} />
          <Row k="Cible secondaire" v={<select value={plan.secondary} onChange={e => upd(p => { p.secondary = (e.target as HTMLSelectElement).value as TargetClass; })}>{Object.entries(TARGETS).map(([k, l]) => <option value={k}>{l}</option>)}</select>} />
          <Row k="Tactique" v={<select value={plan.tactic} onChange={e => upd(p => { p.tactic = (e.target as HTMLSelectElement).value as Tactic; })}>{Object.entries(TACTICS).map(([k, l]) => <option value={k}>{l}</option>)}</select>} />
          <Row k="Attaquer" v={<select value={plan.attackWho} onChange={e => upd(p => { p.attackWho = (e.target as HTMLSelectElement).value as AttackWho; })}>{who.map(([k, l]) => <option value={k}>{l}</option>)}</select>} />
          {g.settings.combatRoles && <Row k="Retraite" v={<><select value={plan.retreatAt ?? 0} onChange={e => upd(p => { p.retreatAt = +(e.target as HTMLSelectElement).value; })}>{[...new Set([0, 25, 40, 50, 60, 70, 80, plan.retreatAt ?? 0])].sort((x, y) => x - y).map(v => <option value={v}>{v ? `après ${v} % de blindage perdu` : 'jamais (combat jusqu\'au bout)'}</option>)}</select></>} title="Part du blindage de la flotte perdue au-delà de laquelle elle rompt le combat et se replie vers votre planète la plus proche" />}
          <p class="small muted">Le plan « Par défaut » s'applique aux flottes sans autre plan ; vos stations utilisent son réglage « Attaquer ». {g.settings.diplomacy && g.diplomacy ? 'Diplomatie négociée : quel que soit ce réglage, vos flottes n\'attaquent que les empires avec qui vous êtes en guerre (et les pirates, gardiens et Moissonneurs). ' : ''}{g.settings.combatRoles ? 'Ciblage par la menace : les tirs vont d\'abord aux piles qui infligent le plus de dégâts (un peu plus aux cibles faciles à achever) ; les écrans attirent les tirs, l\'artillerie est visée en dernier. Une flotte en retraite tire encore en se dégageant.' : 'Les cibles sont choisies par attractivité : coût de la cible divisé par la défense qu\'elle oppose à l\'arme.'}</p>
        </div>
      </div>
    </Modal>
  );
}

const LOCKED = 'Active : on peut ajouter une option en cours de partie, pas la retirer';

export function RelationsDialog() {
  const s = useStore();
  const g = s.game!, me = s.me!;
  const set = (p: number, r: Relation) => { s.checkpoint(); me.relations[p] = r; s.bump(); };
  // reached from a report about an empire: its entry is unfolded
  const focus: number | undefined = s.tab === 'diplomacy' ? s.tabData?.playerId : undefined;
  const [open, setOpen] = useState<Record<number, boolean>>(focus !== undefined ? { [focus]: true } : {});
  const known = (pid: number) => me.intel.planets.filter(pi => pi.owner === pid);
  return (
    <Modal title="Diplomatie" sub="Seuls les empires déjà rencontrés apparaissent ici. Cliquez sur un empire pour voir ses colonies connues." actions={<button onClick={() => s.open('battlePlans')}>Plans de bataille…</button>} onClose={() => s.close('relations')} width={760} footer={<button class="primary" onClick={() => s.close('relations')}>Terminé</button>}>
      {me.intel.met.length === 0 ? <p class="muted">Vous n'avez encore rencontré aucun autre empire. Les empires apparaissent ici après un premier contact (scanner pénétrant, colonie découverte ou combat).</p> :
        <table class="report diplo">
          <thead><tr><th>Empire</th><th>Race</th><th>Votre attitude</th><th>Leur attitude</th>{intelOn(g) && <th>Renseignement</th>}</tr></thead>
          <tbody>{me.intel.met.map(pid => {
            const p = g.players[pid];
            const cols = known(pid);
            const isOpen = !!open[pid];
            return <>
              <tr class={'diplo-emp' + (pid === focus ? ' hl' : '')}>
                <td><button class="lnk diplo-name" style={{ color: p.color }} aria-expanded={isOpen} onClick={() => setOpen({ ...open, [pid]: !isOpen })}><span class="caret">{isOpen ? '▾' : '▸'}</span> {p.name}</button>{p.dead ? ' (anéanti)' : ''}
                  <div class="small muted">{cols.length ? `${cols.length} colonie${cols.length > 1 ? 's' : ''} connue${cols.length > 1 ? 's' : ''}` : 'aucune colonie connue'}</div></td>
                <td>{p.race.pluralName} · {PRT_INFO[p.race.prt].name}</td>
                <td>{(['friend', 'neutral', 'enemy'] as Relation[]).map(r => <label class="radio inline"><input type="radio" checked={me.relations[pid] === r} onChange={() => set(pid, r)} /> {r === 'friend' ? 'Ami' : r === 'neutral' ? 'Neutre' : 'Ennemi'}</label>)}</td>
                <td>{p.relations[me.id] === 'friend' ? 'Ami' : p.relations[me.id] === 'neutral' ? 'Neutre' : 'Ennemi'}</td>{intelOn(g) && <td><IntelLevel me={me} pid={pid} /></td>}</tr>
              {isOpen && <tr class="diplo-sub"><td colSpan={intelOn(g) ? 5 : 4}><DossierBlock pid={pid} /><KnownColonies pid={pid} /></td></tr>}
            </>;
          })}</tbody>
        </table>}
      <p class="small muted">Les relations sont unilatérales : déclarer un empire ami évite que vos flottes l'attaquent et permet à vos vaisseaux de se ravitailler à ses stations et d'utiliser ses portes. Les ordinateurs restent hostiles tant qu'ils ne vous considèrent pas eux-mêmes comme amis.</p>
    </Modal>
  );
}

/** What your scanners know of another empire's colonies; a click shows the planet on the map. */
export function KnownColonies({ pid }: { pid: number }) {
  const s = useStore();
  const g = s.game!, me = s.me!;
  const own = g.planets.filter(p => p.owner === me.id);
  const rows = me.intel.planets.filter(pi => pi.owner === pid).map(pi => {
    const pl = g.planets[pi.id];
    const dist = own.length ? Math.min(...own.map(o => distance(o, pl))) : 0;
    const hab = pi.hab ? habitability(me.race, pi.hab) : null;
    return { pi, pl, dist, hab };
  }).sort((a, b) => a.dist - b.dist);
  const { sorted, th } = useSorted(rows, [
    { key: 'name', get: r => r.pl.name }, { key: 'pop', get: r => r.pi.pop ?? -1, num: true }, { key: 'def', get: r => r.pi.defenses ?? -1, num: true },
    { key: 'sb', get: r => r.pi.starbaseName ?? '' }, { key: 'hab', get: r => r.hab ?? -999, num: true }, { key: 'dist', get: r => r.dist, num: true }, { key: 'year', get: r => r.pi.year ?? 0, num: true },
  ], 'dist', 1);
  if (!rows.length) return <p class="small muted">Aucune colonie de cet empire n'a encore été repérée. Un scanner (ou une flotte en orbite) les révèle.</p>;
  return <div class="report-scroll"><table class="report compact known-cols">
    <thead><tr>{th('name', 'Colonie')}{th('pop', 'Population')}{th('def', 'Défenses')}{th('sb', 'Station')}{th('hab', 'Habitabilité', { title: 'pour votre race' })}{th('dist', 'Distance', { title: 'de votre colonie la plus proche' })}{th('year', 'Relevé')}</tr></thead>
    <tbody>{sorted.map(r => <tr class="go" onClick={() => s.focus({ kind: 'planet', id: r.pl.id }, r.pl)} title="Voir sur la carte">
      <td>{r.pl.name}{r.pi.homeworld ? <span class="tag">capitale</span> : ''}</td>
      <td class="num">{r.pi.pop !== undefined ? fmtPop(r.pi.pop) : '?'}</td>
      <td class="num">{r.pi.defenses !== undefined ? fmt(r.pi.defenses) : '?'}</td>
      <td>{r.pi.starbaseName ?? <span class="muted">aucune</span>}</td>
      <td class={'num ' + (r.hab === null ? 'muted' : r.hab > 0 ? 'green' : 'red')}>{r.hab === null ? '?' : `${r.hab} %`}</td>
      <td class="num">{fmt(r.dist)} al</td>
      <td class="num">{r.pi.year ?? '?'}{r.pi.year !== undefined && g.year - r.pi.year > 0 ? <span class="muted small"> ({g.year - r.pi.year} a)</span> : ''}</td>
    </tr>)}</tbody>
  </table></div>;
}

export function FindDialog() {
  const s = useStore();
  const g = s.game!, me = s.me!;
  const [q, setQ] = useState('');
  const ql = q.toLowerCase();
  const planets = g.planets.filter(p => !me.intel.planets[p.id]?.unknown && p.name.toLowerCase().includes(ql)).slice(0, 30);
  const fleets = g.fleets.filter(f => f.owner === me.id && f.name.toLowerCase().includes(ql)).slice(0, 20);
  return (
    <Modal title="Rechercher" onClose={() => s.close('find')} width={520}>
      <input autofocus placeholder="Nom de planète ou de flotte" value={q} onInput={e => setQ((e.target as HTMLInputElement).value)} style={{ width: '100%' }} />
      <ul class="list find">
        {planets.map(p => <li onClick={() => { s.close('find'); s.focus({ kind: 'planet', id: p.id }, p); }}>◉ {p.name} <span class="muted small">{p.owner === me.id ? 'à vous' : ''}</span></li>)}
        {fleets.map(f => <li onClick={() => { s.close('find'); s.focus({ kind: 'fleet', id: f.id }, f); }}>➤ {f.name}</li>)}
      </ul>
    </Modal>
  );
}

export function TemplatesDialog() {
  const s = useStore();
  const g = s.game!, me = s.me!;
  const [sel, setSel] = useState(0);
  const t = me.templates[sel];
  const kinds: QueueKind[] = ['autoFactories', 'autoMines', 'autoDefenses', 'autoMinTerraform', 'autoMaxTerraform', 'autoAlchemy', 'factory', 'mine', 'defenses', 'scanner', 'terraform'];
  return (
    <Modal title="Modèles de production" onClose={() => s.close('templates')} width={760} footer={<button class="primary" onClick={() => s.close('templates')}>Terminé</button>}>
      <div class="bp">
        <div>
          <ul class="list">{me.templates.map((x, i) => <li class={i === sel ? 'sel' : ''} onClick={() => setSel(i)}>{x.name}{me.defaultTemplate === x.id ? ' ★' : ''}</li>)}</ul>
          <button onClick={() => { s.checkpoint(); me.templates.push({ id: Math.max(0, ...me.templates.map(x => x.id)) + 1, name: 'Nouveau modèle', items: [] }); setSel(me.templates.length - 1); s.bump(); }}>Nouveau</button>
          {/* 3.6: the chain of the three default templates */}
          {TEMPLATE_CHAIN.every(c => me.templates.some(x => x.id === c.from) && me.templates.some(x => x.id === c.to)) && <div class="tpl-chain">
            <label class="chk"><input type="checkbox" checked={me.tplChain !== false} onChange={e => { s.checkpoint(); me.tplChain = (e.target as HTMLInputElement).checked; s.bump(); }} /> Faire évoluer les colonies d'un modèle à l'autre</label>
            <p class="small muted">{TEMPLATE_CHAIN.map(c => `« ${me.templates.find(x => x.id === c.from)!.name} » → « ${me.templates.find(x => x.id === c.to)!.name} » à ${Math.round(c.fill * 100)} % de la population maximale${c.factories ? ` et ${Math.round(c.factories * 100)} % des usines possibles` : ''}`).join(' ; ')}. Les éléments automatiques du modèle sont remplacés par ceux du suivant ; vos éléments manuels restent. Une file vidée ou refaite à la main n'est pas touchée.</p>
          </div>}
        </div>
        {t && <div class="bp-edit">
          <Row k="Nom" v={<input value={t.name} onInput={e => { t.name = (e.target as HTMLInputElement).value; s.bump(); }} />} />
          <label class="chk"><input type="checkbox" checked={me.defaultTemplate === t.id} onChange={e => { s.checkpoint(); me.defaultTemplate = (e.target as HTMLInputElement).checked ? t.id : -1; s.bump(); }} /> Appliquer automatiquement aux nouvelles colonies</label>
          <ul class="list">{t.items.map((it, i) => <li>{QUEUE_LABELS[it.kind]} · {isAuto(it.kind) ? 'par an, jusqu\'à ' : ''}{it.qty} <button class="link" onClick={() => { s.checkpoint(); t.items.splice(i, 1); s.bump(); }}>✕</button></li>)}</ul>
          <select onChange={e => { const k = (e.target as HTMLSelectElement).value as QueueKind; if (k) { s.checkpoint(); t.items.push({ kind: k, qty: isAuto(k) ? 50 : 1 }); s.bump(); } (e.target as HTMLSelectElement).value = ''; }}><option value="">Ajouter un élément…</option>{kinds.map(k => <option value={k}>{QUEUE_LABELS[k]}</option>)}</select>
          <div class="btns">
            <button onClick={() => { s.checkpoint(); for (const p of g.planets.filter(p => p.owner === me.id)) for (const it of t.items) if (!p.queue.some(q => q.kind === it.kind)) p.queue.push({ ...it, allocated: { ironium: 0, boranium: 0, germanium: 0, resources: 0 } }); s.notify('Modèle appliqué à toutes vos planètes (sans doublons)'); s.bump(); }}>Appliquer à toutes mes planètes</button>
            <button class="danger" onClick={() => { s.checkpoint(); me.templates.splice(sel, 1); setSel(0); s.bump(); }}>Supprimer</button>
          </div>
        </div>}
      </div>
    </Modal>
  );
}

export function HelpDialog({ tab: t0 }: { tab?: string }) {
  const s = useStore();
  const [tab, setTab] = useState(t0 ?? 'guide');
  return (
    <Modal title="Guide du joueur" sub="Prise en main, règles essentielles et raccourcis." wide onClose={() => s.close('help')}>
      <Tabs tabs={[{ id: 'guide', label: 'Premiers pas' }, { id: 'rules', label: 'Règles essentielles' }, { id: 'c3', label: 'Règles de Constellations' }, { id: 'keys', label: 'Raccourcis' }, { id: 'about', label: 'À propos' }]} value={tab} onChange={setTab} />
      {tab === 'guide' && <div class="guide">
        <div class="tut-callout"><div><b>Nouveau dans le jeu ?</b> Le tutoriel vous guide pas à pas dans une vraie partie : l'essentiel en une vingtaine de minutes, puis des chapitres facultatifs pour aller plus loin.</div>
          <button class="primary" onClick={() => { if (s.game && !s.game.tutorial) s.ask('Ouvrir le tutoriel ? Il se joue dans une partie à part ; celle-ci reste enregistrée dans ce navigateur.', () => void openTutorial(), 'Ouvrir le tutoriel'); else { s.close('help'); void openTutorial(); } }}>{s.game?.tutorial ? 'Reprendre le tutoriel' : 'Ouvrir le tutoriel'}</button></div>
        <p>Vous dirigez un peuple qui part de son monde natal pour coloniser une galaxie partagée avec d'autres empires. Chaque tour représente une année : vous donnez vos ordres, puis « Tour suivant » (<kbd>Entrée</kbd>) calcule l'année.</p>
        <ol>
          <li><b>Explorez.</b> Cliquez sur une planète grise (inexplorée) : le panneau de droite propose « Envoyer un éclaireur ». Vous pouvez aussi sélectionner un vaisseau puis <kbd>Maj</kbd>+clic sur la carte pour lui donner une destination ; gardez <kbd>Maj</kbd> enfoncée pour ajouter des étapes, <kbd>Ctrl</kbd>+<kbd>Maj</kbd>+clic pour prolonger un itinéraire existant. Glissez une étape (losange) pour la déplacer, ou un chevron du trajet pour insérer une étape. Une étape dans l'espace (losange creux) est franchie sans ralentir : un virage ne coûte aucun temps, et un scanner pénétrant balaie tout le trajet de l'année. Cochez « S'arrêter à cette étape » pour y marquer une pause. Une planète, elle, est toujours un arrêt : il faut se mettre en orbite pour l'analyser sans scanner pénétrant. Les éclaireurs de départ ont une autonomie limitée : prévoyez leur retour au chantier. L'exploration automatique s'obtient par la recherche, vers Électronique 9 (de 7 à 11 selon la partie, comme les composants) ; un peu plus tard, la traversée des trous de ver (« Navigation des anomalies », Propulsion 10 et Électronique 10). Survolez une technologie dans l'onglet Recherche pour savoir à quoi elle sert.</li>
          <li><b>Colonisez.</b> Sur la carte, les points verts sont favorables à votre race, les rouges hostiles ; plus le point est gros, plus l'effet est fort. Le Planificateur de colonies classe tous les mondes analysés : « Envoyer une arche » part avec l'arche prête la plus rapide, « Construire et envoyer » la fait construire au meilleur chantier et l'envoie dès qu'elle est prête.</li>
          <li><b>Développez vos colonies.</b> La file de production se déplie en haut du panneau de la planète. Les éléments automatiques (usines, mines) restent dans la file et construisent chaque année ce que la population peut exploiter.</li>
          <li><b>Exploitez les mondes libres.</b> Un vaisseau de minage (robots foreurs) en orbite d'une planète inhabitée extrait chaque année des minerais. « Créer la navette » envoie ensuite un cargo les chercher en allers-retours vers la capitale (ou le port de votre choix), ou en fait construire un. Le Planificateur de minage classe ces mondes par rendement et indique leur habitabilité : un monde favorable mérite plutôt une colonie.</li>
          <li><b>Recherchez et concevez.</b> L'onglet Recherche fixe le domaine et le budget. Les percées sont aléatoires : les durées sont des estimations, et le niveau exact qui débloque chaque technologie varie d'une partie à l'autre ; le tableau « Technologies à portée » donne les chances et permet de cibler une technologie. L'onglet Conception permet de dessiner vos vaisseaux sur les coques débloquées.</li>
          <li><b>Lisez les rapports.</b> Le bandeau sous la carte résume l'année ; les noms soulignés mènent à l'objet concerné. La liste « à faire » rappelle les éclaireurs sans ordre, les files vides ou les flottes presque à sec.</li>
        </ol>
        <p>Les ordres se défont avec « Annuler » (<kbd>Ctrl</kbd>+<kbd>Z</kbd>) jusqu'au tour suivant. La partie est enregistrée automatiquement dans ce navigateur ; « Exporter » en fait un fichier à conserver ailleurs. Dans Chrome et Edge, le jeu peut aussi écrire les cinq derniers tours de chaque partie dans un dossier de votre choix (menu « ⋯ », Sauvegardes de secours) : si le navigateur perd ses parties (données effacées, autre navigateur), le jeu reprend au lancement la plus récente de ces sauvegardes. À plusieurs sur le même appareil : « Nouvelle partie », onglet Adversaires, « Humain (même appareil) ».</p>
      </div>}
      {tab === 'rules' && <div class="guide">
        <h4>Population et ressources</h4>
        <p>La valeur d'une planète (−45 à 100 %) dépend de sa gravité, de sa température et de sa radiation par rapport aux plages de votre race. À 100 %, un monde accueille {!s.game || popScale(s.game) === 1000 ? 'un milliard d\'habitants' : 'un million d\'habitants'}. La croissance est forte tant que la planète est peu remplie, puis ralentit ; au-delà de la capacité, la population meurt. Les ressources viennent de la population et des usines qu'elle fait tourner.{(!s.game || popScale(s.game) === 1000) && ' Les colons voyagent en hibernation : un kt de soute en emporte cent mille.'}</p>
        <h4>Minerais</h4>
        <p>Ironium, boranium et germanium sont extraits par les mines selon la concentration de la planète, qui baisse lentement. Vaisseaux et installations les consomment.</p>
        <h4>Carburant</h4>
        <p>La consommation dépend de la masse (vaisseaux et cargaison), du moteur et de la vitesse. Un vaisseau parcourt chaque année le carré de son Warp en années-lumière. Le plein se fait automatiquement en orbite d'une de vos stations, ou de celle d'un empire ami, avec ou sans chantier. Les statoréacteurs récupèrent un peu de carburant en route. Dans la jauge de la flotte, la partie hachurée montre ce que l'itinéraire va consommer (jusqu'au prochain plein) ; elle passe au rouge si le réservoir ne suffit pas. À sec, un vaisseau se traîne à Warp 1 : le panneau de la flotte affiche la consommation et la réserve à l'arrivée de chaque étape, et la vitesse est réduite d'office si le carburant ne suffit pas.</p>
        <h4>Scanners</h4>
        <p>Rouge : portée de détection, qui révèle la présence des flottes. Jaune : portée d'analyse (scanner pénétrant), qui mesure les planètes et identifie les flottes. Au début, il faut se mettre en orbite d'une planète pour l'analyser. Un scanner ordinaire ne voit qu'un contact anonyme, dont il estime la masse (voir Règles de Constellations).</p>
        <h4>Combat</h4>
        <p>Une bataille éclate quand des flottes hostiles se retrouvent au même endroit. Chaque modèle forme une pile sur un plateau 10 × 10, tire selon son initiative et manœuvre selon le plan de bataille de sa flotte. Les rayons perdent de la puissance à longue portée ; les torpilles peuvent manquer.</p>
        <p>Les dégâts se répartissent sur toute la pile : un vaisseau n'est détruit que si un coup dépasse le blindage qui lui reste, et une flotte sort souvent d'une bataille entière mais abîmée. Une flotte attaquée riposte, quels que soient ses ordres. Pour rompre le combat, une pile doit dépenser sept cases de mouvement, même acculée dans un coin. La cargaison des vaisseaux détruits reste sur place : en épave dans l'espace, sur la planète en orbite.</p>
        <h4>Mines</h4>
        <p>Une flotte qui traverse un champ de mines ennemi trop vite risque d'être touchée à chaque année-lumière ; des champs superposés de même type ne comptent qu'une fois. Les dégâts d'une mine se partagent entre tous les vaisseaux de la pile, dont les boucliers en absorbent jusqu'à la moitié : une grosse flotte en sort abîmée, une petite (cinq vaisseaux ou moins) passe ou disparaît d'un coup.</p>
        <h4>Bombardement et invasion</h4>
        <p>Des bombardiers en orbite d'une planète ennemie sans station tuent la population et détruisent les installations. Tous les bombardiers d'un empire frappent ensemble, une fois par an, contre les défenses du début de leur frappe ; les bombes intelligentes n'achèvent jamais les 100 derniers colons.</p>
        <p>Pour conquérir, déchargez des colons : ils affrontent les défenseurs pendant le tour, avec tous ceux qui débarquent la même année sur ce monde (le camp le plus fort l'emporte). Une planète vidée par les bombes peut être prise par des troupes débarquées la même année : elle garde ses mines et ses usines.</p>
      </div>}
      {tab === 'c3' && <div class="guide">
        <p>Constellations garde le cœur de Stars! et ajoute des règles qui rendent l'espace, la taille et la guerre plus intéressants. Chacune se désactive à la création de la partie (onglet « Règles Constellations ») ; en cours de partie, « Paramètres de la partie » permet d'en ajouter, pas d'en retirer. Toutes réunies, elles se retrouvent dans l'onglet <b>Empire</b>.</p>
        <h4>Terrain</h4>
        <p>Les <b>nébuleuses</b> divisent par deux la portée des scanners (pour ce qui s'y cache comme pour ce qui y cherche) et limitent la vitesse à Warp 6. Les <b>amas denses</b> abritent des planètes plus riches mais imposent Warp 5. Les <b>tempêtes ioniques</b> dérivent chaque année et divisent les boucliers par deux dans les combats qui s'y déroulent. Embuscades, routes lentes et approches cachées naissent de ce relief.</p>
        <h4>Effet de serre</h4>
        <p>Les usines au travail rejettent des gaz à effet de serre, et leur monde se réchauffe lentement vers un niveau fixé par son industrie : chaque doublement de la production ajoute à peu près le même réchauffement (environ +11 °C pour 400 ressources d'usines par an, +20 °C pour 1 000). Il se refroidit plus lentement encore quand ses usines deviennent plus propres, s'arrêtent ou disparaissent. Trois technologies réduisent les rejets : Énergie décarbonée (Énergie 6, −40 %), Captage du carbone (Biotechnologie 8, la moitié du reste) et Régulation climatique (Biotechnologie 14 et Énergie 12, encore la moitié, et un refroidissement cinq fois plus rapide). La terraformation de température compense le reste, dans ses limites ; un monde trop froid pour votre race peut même y gagner. Le panneau de la planète indique le réchauffement atteint et celui vers lequel elle va.</p>
        <h4>Région de la galaxie</h4>
        <p>Stars! répartit ses planètes uniformément dans un carré. Une carte de Constellations couvre de 400 à 2 000 années-lumière : bien trop peu pour voir une galaxie entière (la Voie lactée en fait cent mille). Une nouvelle partie se déroule donc dans une région d'une galaxie, comme le voisinage du Soleil : un <b>bras spiral</b> (des milliers d'années-lumière de large : la carte en montre un bord, dense d'un côté, plus clairsemé vers le vide entre les bras, avec sa bande de poussière coupée de quelques passages), une <b>pouponnière d'étoiles</b> (des amas jeunes entre des nuages sombres : des couloirs à tenir) ou une <b>superbulle</b> (une cavité soufflée par des supernovae, entourée d'un anneau d'étoiles). La forme carrée reste au choix. Même nombre de planètes, mêmes écarts minimaux ; les mondes de départ ont des voisins et un peu de place avant le premier nuage. Pour retrouver le jeu d'origine d'un coup, cochez « Expérience proche de Stars! » à la création : galaxie carrée, aucune règle Constellations, flottes identifiées dès qu'elles sont vues, trous de ver franchissables sans recherche, victoire au plus tôt après 50 ans.</p>
        <p><b>Nuages sombres.</b> Des nuages moléculaires aux noms peu engageants (le Linceul, la Gueule de Charbon, la Tombe des Pilotes...). Comme autour du Soleil, ils couvrent quelques pour cent d'une carte : la bande de poussière d'un bras et un ou deux grands nuages, ou des arcs sur la coquille d'une superbulle ; seule une pouponnière d'étoiles en est pleine, fermée et découpée par eux. Ils sont infranchissables : à vitesse Warp, chaque grain de leur poussière frappe comme un obus. Les flottes les contournent d'elles-mêmes : la route passe par des points de l'espace (« Contournement »), comptés dans la distance, le carburant et la durée affichés. Une étape posée dans un nuage glisse à son bord ; un paquet de minerais lancé à travers est perdu. Aucun trou de ver ne s'y trouve, et aucun monde n'est enfermé derrière ; une seule étoile peut s'y cacher (voir Étoiles cachées). Les passages entre deux nuages sont les points à tenir d'une carte.</p>
        <h4>Coût de la taille</h4>
        <p>Un empire se gouverne depuis sa capitale. Au-delà de {ADMIN_RADIUS} années-lumière d'une capitale, une planète perd {Math.round(ADMIN_LOSS * 100)} % de sa production et de sa recherche tous les {ADMIN_STEP} al (sans descendre sous {Math.round(ADMIN_FLOOR * 100)} % de rendement). Une <b>capitale régionale</b> (élément de production, une par tranche de {REGIONAL_PER_WORLDS} planètes) rend le plein rendement autour d'elle. Un monde conquis démarre à {Math.round(CONQUEST_START * 100)} % et met {CONQUEST_YEARS} ans à produire pleinement. Perdre sa capitale désorganise tout l'empire pendant {DISORG_YEARS} ans (×{DISORG_FACTOR}).</p>
        <h4>Réseau logistique</h4>
        <p>Plus besoin de pomper la population à la main. Dans le panneau d'une planète, réglez sa <b>politique migratoire</b> (émigration au-delà d'un pourcentage de sa capacité, immigration jusqu'à un pourcentage) et sa <b>politique minière</b> (exporter au-delà d'une réserve, importer). Les émigrants vont aux planètes en Immigration et, par défaut, à vos colonies habitables sans politique encore peu peuplées, les plus vides d'abord (réglage dans Empire, Réseau logistique). Cochez « Réseau logistique » sur des cargos : ils font les convois tout seuls. Ce sont de vrais vaisseaux : un raid peut les intercepter, et le réseau évite les routes où des navires ennemis viennent d'être vus.</p>
        <h4>Rôles et ciblage</h4>
        <p>Chaque modèle armé a un <b>rôle</b> : écran (en avant, il attire les tirs), ligne, ou artillerie (en retrait, visée en dernier). Sans choix de votre part, le rôle suit les armes : torpilles et missiles en artillerie, rayons en ligne. Les tirs vont d'abord aux piles qui infligent le plus de dégâts : les coques bon marché qui servaient de leurres ne protègent plus rien. Un plan de bataille peut fixer un <b>seuil de retraite</b> : passé ce pourcentage de blindage perdu, la flotte rompt le combat et se replie. Le <b>simulateur</b> de l'onglet Conception joue 40 combats avec le vrai moteur, et la <b>comparaison</b> place deux modèles côte à côte, caractéristique par caractéristique. Dans le replay d'une bataille, un clic sur une pile montre son équipement, sa puissance de feu et sa défense ; son nom ouvre le modèle dans Conception.</p>
        <h4>Débris</h4>
        <p>Qui tient le terrain après une bataille étudie les épaves ennemies : quand elles portaient des composants que vous ne connaissez pas, vos scientifiques progressent vers le plus avancé (environ un tiers du niveau suivant dans son domaine). Plus il y a d'épaves, plus les chances sont bonnes (12 % par vaisseau détruit, 60 % au plus).</p>
        <h4>Interceptions et patrouilles</h4>
        <p>Une patrouille ne se jette pas dans un massacre : si une flotte identifiée est plus de deux fois et demie plus forte qu'elle, elle ne la poursuit pas (rapport), et une poursuite qui découvre en route un adversaire trop fort revient à son poste. Un contact inconnu est approché : c'est ainsi qu'on apprend ce qu'il vaut. Un ordre d'interception donné à la main est toujours exécuté. Une flotte qui croise un gardien rapporte ce que vaut votre marine face à lui.</p>
        <h4>Doctrines</h4>
        <p>À certains niveaux de recherche, il faut choisir entre deux doctrines exclusives (boucliers ou armes, endurance ou vitesse, blindage ou coût…). Le choix est définitif : deux empires au même niveau ne se battent plus de la même façon.</p>
        <h4>Mégaprojets</h4>
        <p>Des années de travaux pour un effet durable. Comme les technologies, un grand projet n'apparaît (onglets Recherche et Empire) que lorsque vos sciences sont à moins de 5 niveaux de ce qu'il demande. L'un d'eux donne la victoire une fois achevé, mais toute la galaxie est prévenue de son avancement et les ordinateurs se liguent contre son constructeur. Un projet en cours est perdu si sa planète est prise.</p>
        <h4>Objectifs secrets</h4>
        <p>Chaque empire, ordinateurs compris, reçoit deux objectifs cachés (explorer, conquérir, livrer des colons, prendre des planètes à un rival désigné…). Chacun accompli vaut {OBJECTIVE_POINTS} points de score. Vous savez seulement qu'un rival a réussi l'un des siens ; tout est révélé en fin de partie.</p>
        <h4>Leurres et incertitude</h4>
        <p>Sans scanner pénétrant, la masse et le nombre de vaisseaux d'une flotte repérée ne sont qu'une estimation (±30 %). Le <b>leurre holographique</b> (Électronique 4) ajoute à vos vaisseaux une masse et des vaisseaux fantômes : de quoi faire hésiter un adversaire, ordinateurs compris.</p>
        <p><b>Brouillard de guerre.</b> Une flotte identifiée (scanner pénétrant, rencontre) reste identifiée tant que vos scanners ordinaires la suivent sans interruption : sa position est à jour, sa composition date de l'identification (l'âge de l'information est indiqué). Perdue de vue un an, elle redevient un contact inconnu.</p>
        <h4>Interception</h4>
        <p>Sélectionnez une de vos flottes, cliquez sur une flotte étrangère, puis « Intercepter ». La destination adverse n'étant jamais connue, le point de rencontre est calculé d'après la trajectoire observée : c'est la première position de fin d'année que votre flotte peut atteindre à temps. Elle s'y arrête et attend. L'ordre est permanent : le point est recalculé chaque année tant que la cible reste visible, et quand elle est à moins d'un an, votre flotte fonce droit sur elle. Un combat n'a lieu que si l'un des camps attaque l'autre.</p>
        <h4>Ravitaillement en vol</h4>
        <p>Une flotte presque à sec, qui rampe à Warp 1 ou 2, affiche « Ravitailler la flotte » quand une de vos flottes sans ordre a du carburant à céder. Celle-ci calcule le rendez-vous sur l'itinéraire de la flotte à sec, lui donne ce qu'elle peut en gardant de quoi rentrer, puis retourne au chantier le plus proche ; la flotte ravitaillée repart à sa meilleure vitesse.</p>
        <h4>Anomalies et archéologie</h4>
        <p>Analyser une planète peut révéler une <b>anomalie</b> (marquée « ? » sur la carte). Un vaisseau équipé d'un scanner, laissé en orbite sans autre destination, l'étudie ; votre colonie aussi, si la planète est à vous. Le premier empire qui termine obtient le résultat : recherche, minerais, colons, un vaisseau d'une technologie supérieure, une carte des environs... ou des ennuis. Certaines se concluent par un choix. Les <b>sites archéologiques</b> (« ✦ ») se fouillent en trois chapitres et livrent une <b>relique</b>, un bonus permanent de 10 à 15 %. Des <b>fragments</b> d'une carte des Anciens sont dispersés dans la galaxie : réunissez-en assez pour découvrir leur sanctuaire, gardé, et sa relique majeure.</p>
        <h4>Étoiles cachées</h4>
        <p>Avec les anomalies, certaines étoiles ne figurent sur aucune carte au début de la partie. Elles apparaissent (marquées ★ dans les découvertes) quand vous les trouvez, et restent invisibles pour les empires qui ne les ont pas trouvées eux-mêmes. Une <b>naine brune</b>, trop froide pour briller, se voit en infrarouge (« Relevé infrarouge profond », Électronique 6, à moins de 450 al de vos colonies) ; on fait le plein de carburant dans son atmosphère. Un <b>essaim de Dyson</b> enferme son étoile mais rayonne fort en infrarouge (700 al) ; son Esprit le garde, et une colonie installée là reçoit 200 ressources de plus par an. Un <b>trou noir isolé</b> ne se voit qu'à la lumière qu'il dévie (« Interférométrie gravitationnelle », Électronique 14 et Énergie 8, 600 al ; le Grand Observatoire, 1 000 al) : une de vos flottes qui part de moins de 40 al de lui gagne une demi-année de route, et l'étude de son horizon livre une relique. Un <b>pulsar muet</b> se trahit par les horloges d'une station voisine (une anomalie) ou par ses éruptions ; près de lui les boucliers ne tiennent qu'à moitié. L'<b>étoile des Anciens</b> apparaît quand leur carte est complète : leur sanctuaire s'y trouve. Une <b>étoile voilée</b>, au cœur d'un nuage sombre, se signale par un écho (une anomalie voisine) ; pour l'atteindre, un vaisseau équipé d'un scanner doit stationner dans la zone indiquée et chercher le couloir de poussière raréfiée qui y mène (Warp 3 au plus, connu de vous seul) ; un Berger de poussière la garde. Enfin un <b>trou de ver scellé</b>, qui ne bouge jamais, mène à un <b>amas caché</b> hors de la galaxie : un vaisseau avec scanner, resté à son embouchure, l'ouvre en quelques années (il faut « Navigation des anomalies ») ; ce qui attend de l'autre côté change d'une partie à l'autre. Toutes, enfin, se découvrent en passant à moins de 20 à 30 al.</p>
        <h4>Gardiens</h4>
        <p>Des flottes immobiles et redoutables veillent sur des mondes riches, loin des capitales (anneau violet en pointillé sur la carte). Elles sont visibles de loin et attaquent tout ce qui s'arrête chez elles. Trois paliers, du milieu de partie à la fin. La victoire rapporte de la recherche, les minerais entassés sur la planète, souvent une relique, et libère le monde pour la colonisation.</p>
        <h4>Culture et territoires</h4>
        <p>Chaque colonie <b>rayonne</b> autour d'elle. Sa culture vient de sa population (racine carrée : un monde surpeuplé n'écrase pas tout), de son rôle de capitale, d'une station en orbite et de ses <b>bâtiments culturels</b> (Centre culturel, Université planétaire, Réseau holographique, débloqués par la recherche), et s'érode de 0,5 % par an. Le rayon part d'une vingtaine d'années-lumière et croît de plus en plus lentement : une soixantaine d'al pour une capitale au bout de dix ans, environ 120 à cinquante ans, 180 au plus. En chaque point, l'empire à la plus forte influence possède le territoire (frontières sur la carte, case « Frontières »), et chaque monde colonisé garde toujours son noyau de 2 al.</p>
        <p><b>Personne ne peut fonder de colonie dans le territoire d'un autre empire</b> : pour s'y installer, il faut conquérir, ou affaiblir l'influence adverse. Un monde dont la culture étrangère pèse plus de 1,25 fois la sienne s'en rapproche peu à peu, et après quelques décennies (25 ans au moins, une cinquantaine quand elle pèse le double) il rejoint cet empire avec sa population. Jamais une capitale ; une station en orbite ralentit ce basculement de moitié ; un monde fondé, conquis ou basculé a des années de répit. Pour le retenir : bâtiments culturels, <b>mécénat</b> (des ressources changées en points de culture, aussi en automatique en fin de file, l'emploi idéal des planètes qui ont tout construit), ou la guerre.</p>
        <p><b>Forage</b> dans le territoire d'un autre empire : permis si vous êtes neutre ou en guerre avec lui, interdit si vous l'avez déclaré ami. <b>Balise de souveraineté</b> : un vaisseau qui porte le kit (modèle « Porte-balise »), envoyé sur un monde libre (bouton « Revendiquer » de la planète), devient un fort armé et immobile qui revendique ce monde et 50 al autour. Un autre empire doit le détruire avant de pouvoir y coloniser ; quand vous colonisez vous-même, il devient la station du monde. Vous pouvez avoir autant de balises que de colonies, et au moins deux dans tous les cas.</p>
        <p><b>Frontières fermées</b> (avec la Diplomatie négociée) : dans l'onglet Diplomatie, on peut fermer ses frontières à chaque empire avec qui l'on est en paix. Ses vaisseaux ne peuvent plus entrer dans votre territoire sans vous déclarer la guerre ; ceux qui s'y trouvent déjà peuvent en sortir. Les trajets contournent les territoires qui vous sont fermés, comme les nuages sombres (hachurés en rouge sur la carte) ; quand il n'y a pas d'autre chemin, ou que la destination est dedans, l'itinéraire prévient qu'y entrer sera une déclaration de guerre. Les ordres automatiques (exploration, missions, réseau logistique, poursuites) s'arrêtent à la frontière. Une politique décide pour les empires rencontrés ensuite. Les ordinateurs mesurent ce que des frontières fermées leur barrent : plus elles les enferment, plus ils en veulent à qui les ferme, plus ils demandent qu'on les rouvre, et plus ils sont prêts à la guerre. Entre alliés, les frontières restent ouvertes.</p>
        <p><b>Flottes prises à l'intérieur</b> : une flotte qui se trouve dans un territoire fermé à son empire (les frontières se ferment autour d'elle, le territoire grandit jusqu'à elle) a un délai pour en sortir, calculé d'après la distance de la frontière la plus proche, sa vitesse et son carburant ; son panneau l'indique, avec un bouton pour sortir par le plus court chemin. Passé ce délai, un avertissement ; si elle y est encore l'année suivante, c'est la guerre. Une flotte qui n'a pas assez de carburant pour sortir à temps doit être ravitaillée (par un ravitailleur) avant la fin du délai, sinon elle est démantelée sur place. Les ordinateurs et les ordres automatiques font sortir leurs flottes d'eux-mêmes. Une flotte en orbite de l'une de vos planètes est chez elle : elle n'a pas à partir.</p>
        <p><b>Frontières et renseignement</b> (avec la règle Renseignement) : des frontières fermées coupent les échanges dans les deux sens. Chaque fermeture, que ce soit vous qui fermiez les vôtres ou eux les leurs, retire 15 points au renseignement de chacun des deux empires sur l'autre (30 quand chacun a fermé les siennes), et le contre-espionnage de l'empire qui ferme ses frontières démasque une fois et demie plus souvent les espions de celui à qui il les ferme. Les chiffres déjà connus restent, datés : ce sont les nouvelles qui ne passent plus. Les ordinateurs, qui jugent votre force à travers ce qu'ils savent de vous, la jugent alors plus mal.</p>
        <h4>Diplomatie négociée</h4>
        <p>Entre deux empires : <b>guerre</b>, <b>paix</b> ou <b>alliance</b>. Tout le monde commence en paix ; on ne combat, n'envahit et ne bombarde que ceux avec qui l'on est en guerre, et les champs de mines épargnent les autres. En paix, deux accords : <b>commercial</b> (+4 % de ressources chacun) et <b>scientifique</b> (+5 % de recherche chacun), trois partenaires au plus pour chacun. L'alliance ajoute le ravitaillement aux stations, les portes, la vision des flottes et la défense mutuelle : déclarer la guerre à l'allié d'un ordinateur fait entrer cet ordinateur en guerre contre vous.</p>
        <p>Chaque ordinateur a une <b>opinion</b> de vous, de −100 à +100, détaillée ligne par ligne dans l'onglet Diplomatie : tempérament (selon sa race), frontières communes, guerres passées, mondes pris, accords, ennemi commun, cadeaux, exigences, trahisons. À côté de chaque proposition s'affiche sa réponse probable, avec ses raisons : « très probablement », « probablement », « peut-être »... Elle garde une part d'incertitude, mais redemander la même chose dans l'année ne change rien, sauf une meilleure offre. Exiger un tribut fait nettement baisser leur opinion, qu'ils paient ou non, et ne se fait qu'une fois tous les trois ans auprès d'un même empire ; le rapport dit ce qui a été versé, minerai par minerai, et où. La paix s'obtient avec la lassitude (années de guerre, pertes, mondes perdus), le rapport de forces et quelques minerais. Déclarer la guerre malgré un accord est une <b>trahison</b> : la victime et tous ceux qui vous connaissent s'en souviennent. Les ordinateurs proposent, exigent des tributs, s'allient, déclarent la guerre aux voisins qu'ils détestent et font la paix entre eux.</p>
        <p><b>Ennemi commun.</b> Quand un empire écrase la partie (ordinateur ou joueur, d'après les scores que chacun connaît), les autres se rapprochent contre lui, d'autant plus que son avance est grande : leur opinion les uns des autres monte, même entre empires qui se détestent (pas envers celui qui a juré votre perte), une alliance contre lui leur demande moins d'opinion qu'en temps normal, et ils la proposent en priorité, aux joueurs aussi. Ils lui déclarent plus volontiers la guerre, même déjà engagés ailleurs ; quand l'un l'attaque, ses alliés qui le craignent autant le suivent. L'opinion de l'empire qui domine baisse d'autant. L'onglet Diplomatie signale cette domination quand elle commence. Les ordinateurs faciles ne se liguent jamais contre un joueur, mais s'allient à lui contre un ordinateur qui domine.</p>
        <h4>Renseignement</h4>
        <p>Ce que vous savez d'un autre empire tient en un <b>niveau de renseignement</b> de 0 à 100, recalculé chaque année et détaillé source par source dans son dossier (onglet Diplomatie, ou un clic sur sa ligne dans le Score). Sources : ses mondes analysés cette année par vos scanners pénétrants ou vos vaisseaux en orbite (jusqu'à 35, +5 pour sa capitale), ses vaisseaux identifiés (10), des <b>ambassades</b> (25, réciproques : il en apprend autant sur vous), un accord commercial ou scientifique (10 chacun), une alliance (20), un <b>réseau d'espions</b> (jusqu'à 45), les combats et les mondes pris récemment, et ce que vos alliés savent de lui (jusqu'à 20). Une race Furtivité naît espionne (+10, réseaux plus forts et plus discrets).</p>
        <p>Le niveau révèle d'abord des <b>estimations</b> (« ≈ », à ±30 % au premier palier), puis les chiffres exacts : planètes (estimées à 10, exactes à 40), score et niveaux de technologie (20), ressources et stations (30), flotte (40, exacte à 80), technologie domaine par domaine (55), score exact (60), recherches en cours (65), conditions de victoire remplies (75), objectifs secrets (90). Ce qui a été appris reste dans le dossier, daté. Le <b>réseau d'espions</b> s'achète en production (150 R l'unité, chez l'empire visé), s'use de 20 % par an et peut être démasqué, ce qui le ruine en partie et fâche la victime. L'<b>Agence de renseignement</b> (une par empire, Électronique 5) renforce vos réseaux, démasque deux fois plus souvent ceux des autres et ajoute 5 partout ; ses archives sont une aubaine pour qui prend la planète. Les ordinateurs jugent votre flotte à travers ce qu'ils savent de vous (à ±35 % s'ils ne savent rien) : leurs réponses annoncent « votre force estimée ».</p>
        <h4>Pirates</h4>
        <p>Une quinzaine d'années après le début, des bandes de pirates s'installent dans des <b>repaires</b> loin des capitales (anneau orange, ☠). Tous les quelques années, un repaire lance un <b>raid</b> sur une colonie riche et mal défendue : vos informateurs vous préviennent de la cible et de la date d'arrivée. Une flotte armée en orbite ou une station armée les arrête ; les défenses planétaires réduisent le pillage (minerais emportés, usines et mines détruites, quelques colons tués, jamais un monde vidé). Une <b>prime</b> (élément de production, anonyme) les pousse à viser un rival. Un repaire détruit rapporte de la recherche, le trésor de la bande et parfois une relique ; sans repaire, les pirates disparaissent.</p>
        <h4>Crise de fin de partie</h4>
        <p>Vers 2480 (2490 dans une galaxie moyenne, 2500 à 2510 dans une grande), un signal annonce qu'une <b>Brèche</b> s'ouvrira dix ans plus tard sur un monde éloigné (✹ magenta). Son gardien, le <b>Nexus</b> (vaisseaux de guerre et Remparts blindés, d'une technologie d'avance), tient tête à la plus grande marine de la galaxie et répare 30 % de ses dégâts par an. Tous les quatre ou cinq ans, une <b>vague de Moissonneurs</b> en sort, vise surtout l'empire en tête et moissonne ses mondes un à un. À moins de 80 al de la Brèche, les empires ne se combattent pas entre eux ; les ordinateurs font la paix, s'y rassemblent et frappent ensemble. <b>L'empire qui abat le Nexus</b> (celui qui a le plus de vaisseaux sur place) <b>remporte la partie</b>. Un empire qui écrase tous les autres attire la crise plus tôt.</p>
        <h4>Origines</h4>
        <p>Chaque empire choisit une origine à la création de la partie : monde condamné (le climat natal se dégrade à partir de 2430, il faut déménager), monde-relique, colonie perdue, lignée d'explorateurs, protégés des Anciens. Chacune a un avantage et un prix. Les ordinateurs tirent la leur au sort.</p>
      </div>}
      {tab === 'keys' && <div class="guide keys">
        <table>{[
          ['Entrée ou F9', 'Tour suivant'], ['Maj+F9', 'Générer 10 ans'], ['F1', 'Guide'], ['F2', 'Catalogue des technologies'], ['F3', 'Colonies'], ['F4', 'Conception'], ['F5', 'Recherche'], ['F6', 'Plans de bataille'], ['F7', 'Diplomatie'], ['F8', 'Ma race'], ['F10', 'Score'],
          ['m / c / x', 'Carte / Planificateur de colonies / Planificateur de minage'], ['Glisser une étape', 'Déplacer l\'étape (la flotte doit être sélectionnée)'], ['Glisser un chevron', 'Insérer une étape à cet endroit du trajet'], ['Étape sur un chevron orange', 'Point d\'interception aimanté sur la trajectoire estimée d\'une flotte étrangère'], ['Clic droit sur une flotte étrangère', 'Intercepter avec la flotte sélectionnée'], ['1 à 8', 'Affichage de la carte : habitabilité, minerais, concentrations, valeur, population, épuré, statut des empires, radar'], ['9 / Maj+9', 'Scanners / trajets'], ['0 / Maj+0', 'Noms / nombre de vaisseaux'],
          ['Maj+clic', 'Nouvelle destination de la flotte sélectionnée (Maj maintenue : étapes suivantes)'], ['Ctrl+Maj+clic', 'Ajouter une étape à la fin de l\'itinéraire'], ['Ctrl+clic', 'Choisir où iront les vaisseaux construits sur la planète sélectionnée'], ['Clic droit', 'Objets à cet endroit, « Aller ici »'], ['Molette', 'Zoom'], ['Glisser', 'Déplacer la carte'], ['Ctrl+glisser', 'Mesurer une distance en années-lumière (d\'une planète ou d\'une flotte à une autre, ou n\'importe quel point) ; Maj+Alt+glisser marche aussi'],
          ['n / p', 'Planète ou flotte suivante / précédente'], ['i', 'Flotte sans ordre suivante'], ['t / Maj+t', 'Chose suivante / précédente à traiter (décisions, propositions, flottes, colonies)'], ['w', 'Course à la victoire'], ['h', 'Chronique de la partie'], ['f', 'Basculer entre planètes et flottes'], ['q', 'Production de la planète'], ['v', 'Centrer sur la sélection'], ['Début', 'Toute la galaxie'],
          [', / .', 'Warp de l\'étape sélectionnée −1 / +1'], ['Suppr', 'Supprimer l\'étape sélectionnée'], ['↑ ↓', 'Rapport précédent / suivant'], ['g', 'Aller à l\'objet du rapport'], ['Ctrl+Z', 'Annuler'], ['Ctrl+S', 'Sauvegarder'], ['Ctrl+F', 'Rechercher'], ['Échap', 'Fermer, puis revenir à la carte'],
        ].map(([k, l]) => <tr><td><kbd>{k}</kbd></td><td>{l}</td></tr>)}</table>
      </div>}
      {tab === 'about' && <div class="guide">
        <p>Constellations s'inspire de <i>Stars!</i> (1995), dont il reprend l'essentiel des mécaniques : races personnalisables, six domaines de recherche, coques et composants, carburant, scanners, champs de mines, paquets de minerais, portails, combats sur plateau. Le vocabulaire, les noms des vaisseaux et des technologies, l'interface et une partie des règles sont propres à Constellations.</p>
        <ul>
          <li>Contacts anonymes : un scanner ordinaire ne révèle qu'une présence ; l'identité et la composition d'une flotte demandent un scanner pénétrant (option de partie).</li>
          <li>Trajectoires estimées des flottes étrangères d'après deux observations, alertes quand l'une semble viser vos planètes.</li>
          <li>Missions en un clic (éclaireur, arche, construction puis départ automatique), exploration automatique, vitesse calculée selon le carburant.</li>
          <li>Planificateur de colonies, modèles de production, objectifs de recherche, rapports cliquables, liste « à faire », annulation.</li>
          <li>Multijoueur sur le même appareil uniquement ; l'IA est originale.</li>
        </ul>
      </div>}
    </Modal>
  );
}

export function AboutDialog() {
  const s = useStore();
  return <Modal title="À propos de Constellations" onClose={() => s.close('about')} width={560}>
    <p><b>Constellations {VERSION}</b> : stratégie spatiale au tour par tour, inspirée de <i>Stars!</i> de Jeff Johnson et Jeff McBride (1995).</p>
    <p class="small">Moteur, interface et graphismes originaux, entièrement générés dans le navigateur. Les formules de jeu ont été recoupées avec l'aide d'origine, le clone libre craig-stars (licence MIT) et une partie réelle sous Windows 3.11.</p>
    <p class="small muted">Aucun fichier, image ou texte de Stars! n'est inclus.</p>
  </Modal>;
}

/** How the game was won, in a full sentence. */
function victoryLine(g: GameState, w: Player): string {
  const n = w.name;
  switch (g.victoryKind) {
    case 'megaproject': return `Les ${n} ont gagné en achevant le Portail de l'Ascension.`;
    case 'crisis': return `Les ${n} ont gagné en abattant le Nexus des Moissonneurs.`;
    case 'seal': return `Les ${n} ont gagné en scellant la Brèche avec le Sceau des Anciens.`;
    case 'origin': { const o = w.origin ? ORIGIN_WINS[w.origin] : undefined; return o ? `Les ${n} ont gagné par la victoire de leur origine, ${o.name}. ${o.text(g)}` : `Les ${n} ont gagné par la victoire de leur origine.`; }
    case 'lastStanding': return `Les ${n} ont gagné en restant les derniers debout.`;
    default: return `Les ${n} ont gagné en atteignant les conditions de victoire.`;
  }
}

export function GameOverDialog() {
  const s = useStore();
  const g = s.game!, me = s.me!;
  const won = g.victor === me.id;
  return <Modal title={me.dead ? 'Défaite' : won ? 'Victoire !' : 'Un empire a gagné'} onClose={() => s.close('gameOver')} wide footer={<><button onClick={() => s.open('score')}>Voir les scores</button><button onClick={() => shareChronicle(g)}>Page à partager…</button><span class="sp" /><button class="primary" onClick={() => s.close('gameOver')}>Continuer</button></>}>
    <p>{me.dead ? 'Votre empire a été anéanti.' : g.victor !== null ? victoryLine(g, g.players[g.victor]) : ''}</p>
    {g.settings.secretObjectives && g.victor !== null && <details class="go-obj"><summary>Objectifs secrets révélés</summary>
      <table class="report compact"><tbody>{g.players.filter(p => !p.monster).map(p => <tr><td style={{ color: p.color }}>{p.name}</td><td class="small">{(p.objectives ?? []).map(o => <div>{o.done !== undefined ? '✓' : '✗'} <b>{OBJ[o.id]?.name}</b> : {objectiveText(g, o)}{o.done !== undefined ? ` (${o.done})` : ''}</div>)}</td></tr>)}</tbody></table></details>}
    <ChronicleView initial="epilogue" />
    <p class="muted small">Vous pouvez continuer à jouer cette partie ; la chronique reste dans le menu ⋯.</p>
  </Modal>;
}

export function SettingsDialog() {
  const s = useStore();
  const g = s.game!;
  const set = g.settings;
  return <Modal title="Paramètres de la partie" onClose={() => s.close('settings')} width={560}>
    <Row k="Nom" v={<input value={g.name} onInput={e => { g.name = (e.target as HTMLInputElement).value; s.bump(); }} />} />
    <Row k="Univers" v={`${set.size} · ${g.planets.length} planètes · ${g.width} al`} />
    <Row k="Graine" v={set.seed} />
    {/* 3.6: an option can be added during a game, never taken away */}
    <label class={'chk' + (set.anonymousContacts ? ' locked' : '')} title={set.anonymousContacts ? LOCKED : undefined}><input type="checkbox" checked={set.anonymousContacts} disabled={set.anonymousContacts} onChange={e => { if (!(e.target as HTMLInputElement).checked) return; set.anonymousContacts = true; s.bump(); }} /> Contacts anonymes hors scanner pénétrant (effet au prochain tour)</label>
    {/* 3.6: display only, changes nothing to the rules: either way, any time */}
    <label class="chk"><input type="checkbox" checked={set.popUnits === 'millions'} onChange={e => { if ((e.target as HTMLInputElement).checked) set.popUnits = 'millions'; else delete set.popUnits; s.bump(); }} /> Populations en millions <span class="muted small">(un colon des règles = mille habitants ; affichage seulement, les nouveaux rapports suivent)</span></label>
    <label class={'chk' + (set.publicScores ? ' locked' : '')} title={set.publicScores ? LOCKED : undefined}><input type="checkbox" checked={set.publicScores} disabled={set.publicScores} onChange={e => { if (!(e.target as HTMLInputElement).checked) return; set.publicScores = true; s.bump(); }} /> Scores publics</label>
    <h4>Règles de Constellations</h4>
    <p class="small muted">Décochées, la partie suit les règles de Stars! d'origine. En cours de partie, on peut en ajouter (effet immédiat : une règle activée en route prépare ce qu'il faut, terrain, objectifs, capitales), mais plus en retirer.</p>
    <div class="rules-list">{CONSTELLATIONS_RULES.map(k => { const on = !!(set as any)[k]; return <label class={'chk rule' + (on ? ' locked' : '')} title={on ? LOCKED : undefined}><input type="checkbox" checked={on} disabled={RULE_INFO[k].creationOnly || on} onChange={e => { if ((e.target as HTMLInputElement).checked) A.toggleRule(k, true); }} /> <span class="rule-txt"><b>{RULE_INFO[k].name}</b><small class="muted">{RULE_INFO[k].text}{RULE_INFO[k].creationOnly ? ' (ne se choisit qu\'à la création de la partie)' : ''}</small></span></label>; })}</div>
  </Modal>;
}

export { store };
