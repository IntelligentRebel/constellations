// Production queue dialog.
import { viewSpec, viewQueue } from '../memo';
import { SPY_UNIT, SPY_MAX, SPY_CAP, SPY_DECAY, AGENCY_COST, spyGain } from '../../engine/espionage';
import { useState } from 'preact/hooks';
import { store, useStore, fmt, fmtPeople } from '../store';
import { Modal, Cost, Row, Num, HullImg, PlanetImg } from '../components';
import { availableItems, unitCost, itemLabel, isAuto, estimateQueue, maxBuildable, applyTemplate, QUEUE_LABELS, queueBottleneck } from '../../engine/production';
import { CULTURE_BUILDING, PATRONAGE, reqText, type CultureBuildingId } from '../../engine/culture';
import { planetSpec } from '../../engine/planet';
import { designSpec, designCost } from '../../engine/design';
import type { QueueKind } from '../../engine/types';
import * as A from '../actions';
import { MEGA, megaProgress, megaYearCap, type MegaId } from '../../engine/megaprojects';
import { ADMIN_RADIUS, REGIONAL_MIN_POP, REGIONAL_MIN_DIST, REGIONAL_PER_WORLDS } from '../../engine/empire';
import { tl } from '../../data/labels';

const DESCRIPTIONS: Partial<Record<QueueKind, string>> = {
  factory: 'Une usine produit des ressources si la population peut l\'exploiter.',
  mine: 'Une mine extrait chaque année des minerais selon la concentration de la planète.',
  defenses: 'Les défenses planétaires arrêtent une partie des bombes, des troupes d\'invasion et des paquets.',
  alchemy: 'Convertit des ressources en 1 kt de chaque minerai (coûteux, mais utile en cas de pénurie).',
  terraform: 'Ajuste d\'un cran une variable d\'environnement vers l\'idéal de votre race.',
  scanner: 'Scanner planétaire : détecte les flottes à distance. Il s\'améliore automatiquement avec l\'Électronique.',
  packetI: 'Lance un paquet d\'Ironium vers la destination de l\'accélérateur.', packetB: 'Lance un paquet de Boranium.', packetG: 'Lance un paquet de Germanium.', packetMixed: 'Lance un paquet contenant les trois minerais.',
  autoFactories: 'Construit chaque année jusqu\'à N usines, dans la limite de ce que la population peut exploiter. Reste dans la file.',
  autoMines: 'Construit chaque année jusqu\'à N mines exploitables. Reste dans la file.',
  autoDefenses: 'Construit chaque année jusqu\'à N défenses (une pour 2 500 habitants).',
  autoAlchemy: 'Placée avant un élément : fournit les minerais manquants. En fin de file : convertit toutes les ressources restantes.',
  autoMinTerraform: 'Terraforme seulement si la planète est hostile ou si la population décroît.',
  autoMaxTerraform: 'Terraforme jusqu\'au maximum permis par votre technologie.',
  autoPackets: 'Lance chaque année jusqu\'à N paquets mixtes.',
  genesis: 'Remodèle complètement la planète (environnement et concentrations aléatoires).',
  patronage: `Mécénat : chaque unité transforme ${PATRONAGE.cost.resources} ressources en ${PATRONAGE.points} points de culture pour la planète (son rayonnement s'étend, et elle résiste mieux à une culture étrangère).`,
  autoPatronage: `Mécénat automatique : en fin de file, les ressources qui restent deviennent de la culture (${PATRONAGE.points} points pour ${PATRONAGE.cost.resources} ressources, au plus la quantité indiquée par an). L'emploi idéal des planètes qui ont tout construit.`,
  capital: `Siège d'un gouvernement régional : les planètes à moins de ${ADMIN_RADIUS} al retrouvent leur plein rendement. Il faut ${fmtPeople(REGIONAL_MIN_POP)} habitants et être à au moins ${REGIONAL_MIN_DIST} al de toute autre capitale ; une capitale régionale par tranche de ${REGIONAL_PER_WORLDS} planètes.`,
};

/** Hover explanation of a production item. */
export function itemTip(g: import('../../engine/types').GameState, me: import('../../engine/types').Player, it: { kind: QueueKind; designId?: number; megaId?: string; cultureId?: string; bountyOn?: number }): string {
  if (it.kind === 'spy') return `Agents infiltrés chez les ${g.players[it.bountyOn ?? -1]?.name ?? '?'} (${SPY_UNIT} R l'unité) : chaque unité ajoute ${spyGain(g, me)} à la force de votre réseau (force maximale ${SPY_MAX} ; le réseau vous apporte au plus ${SPY_CAP} points de renseignement). Le réseau s'use de ${Math.round(SPY_DECAY * 100)} % par an et peut être démasqué : il perd alors l'essentiel de sa force et leur opinion de vous baisse.`;
  if (it.kind === 'agency') return `Agence de renseignement (une par empire, ${AGENCY_COST.resources} R, ${AGENCY_COST.ironium} kt d'ironium, ${AGENCY_COST.germanium} kt de germanium) : vos réseaux d'espions se renforcent moitié plus vite, ceux des autres chez vous sont démasqués deux fois plus souvent, +5 de renseignement sur chaque empire. Si la planète tombe, ses archives livrent beaucoup à son conquérant.`;
  if (it.kind === 'bounty') return `Prime versée aux pirates (100 R l'unité, anonyme) : ils viseront en priorité les ${g.players[it.bountyOn ?? -1]?.name ?? '?'}. Chaque raid contre eux en consomme jusqu'à 400 R et frappe plus fort.`;
  if (it.kind === 'culture') { const b = CULTURE_BUILDING[it.cultureId as CultureBuildingId]; return b ? `${b.name} : ${b.text}\nUn seul par planète. Il faut ${reqText(b.req)}.` : ''; }
  if (it.kind === 'mega') {
    const m = MEGA[it.megaId as MegaId];
    if (!m) return '';
    return `${m.name} : ${m.effect}\nAu moins ${m.minYears} ans de travaux : chaque année, la planète y consacre au plus 1/${m.minYears} du coût, le reste de la file continue.${m.victory ? '\nTous les empires sont prévenus de son avancement.' : ''}`;
  }
  if ((it.kind === 'ship' || it.kind === 'starbase') && it.designId !== undefined) {
    const d = g.designs.find(x => x.id === it.designId);
    if (!d) return '';
    const sp = designSpec(me, d);
    const bits = [tl(d.hull), `${fmt(sp.mass)} kt`, `blindage ${fmt(sp.armor)}`];
    if (sp.idealSpeed && !d.starbase) bits.push(`Warp ${sp.idealSpeed}`);
    if (sp.cargoCapacity) bits.push(`soute ${fmt(sp.cargoCapacity)} kt`);
    if (sp.colonyModule) bits.push('module de colonisation');
    if (sp.scanRange > 0) bits.push(`scanner ${sp.scanRange} al${sp.scanRangePen > 0 ? ` (pénétrant ${sp.scanRangePen})` : ''}`);
    if (sp.hasWeapons) bits.push(`puissance ${fmt(sp.powerRating)}`);
    return `${d.name} : ${bits.join(' · ')}.\n${it.kind === 'ship' ? 'Vaisseau construit au chantier de la station orbitale ; chaque ligne forme une flotte.' : 'Construit ou remplace la station orbitale (le coût tient compte de l\'ancienne).'}`;
  }
  return DESCRIPTIONS[it.kind] ?? QUEUE_LABELS[it.kind];
}

/** 3.6: kinds of construction, to filter the list of items. */
const ITEM_CATS: { id: string; label: string }[] = [
  { id: 'all', label: 'Tout' }, { id: 'ships', label: 'Vaisseaux' }, { id: 'stations', label: 'Stations' }, { id: 'build', label: 'Installations' },
  { id: 'auto', label: 'Automatique' }, { id: 'minerals', label: 'Minerais' }, { id: 'culture', label: 'Culture et projets' }, { id: 'other', label: 'Divers' },
];
function catOf(kind: QueueKind): string {
  if (kind === 'ship') return 'ships';
  if (kind === 'starbase') return 'stations';
  if (isAuto(kind)) return 'auto';
  if (['factory', 'mine', 'defenses', 'scanner', 'terraform', 'capital'].includes(kind)) return 'build';
  if (['alchemy', 'packetI', 'packetB', 'packetG', 'packetMixed', 'genesis'].includes(kind)) return 'minerals';
  if (['culture', 'patronage', 'mega'].includes(kind)) return 'culture';
  return 'other';
}
/** A line taking this many years (or more) says what holds it back. */
const SLOW = 5;

/** What holds a queue line back, and where to find the missing mineral. */
function SlowWhy({ planetId, index, est }: { planetId: number; index: number; est: ReturnType<typeof estimateQueue> }) {
  const s = useStore();
  const g = s.game!;
  const planet = g.planets[planetId];
  const b = queueBottleneck(g, planet, index, est);
  if (b.key === 'none') return null;
  const mineral = b.key === 'ironium' || b.key === 'boranium' || b.key === 'germanium' ? b.key : null;
  return <div class="alert small slow-box">
    <b>Ce qui la retarde :</b> {b.text}.
    {b.key === 'resources' && ' Plus d\'usines, une part de recherche plus basse (onglet Recherche) ou des capitales régionales accélèrent la production.'}
    {mineral && <> Apportez-en d'ailleurs (cargo, réseau logistique en « Importer »), forez un monde voisin, ou convertissez des ressources (alchimie minérale).
      <div class="btns"><button class="small primary" onClick={() => { s.close('production'); s.goTab('mining', { focus: { from: planet.id, mineral, short: Math.max(1, Math.round(b.need - b.have)) } }); }}>Trouver {mineral === 'ironium' ? 'de l\'' : 'du '}{mineral} près de {planet.name}</button></div></>}
  </div>;
}

export function ProductionDialog({ planetId }: { planetId: number }) {
  const s = useStore();
  const g = s.game!, me = s.me!;
  const [pid, setPid] = useState(planetId);
  const planet = g.planets[pid];
  const [selAvail, setSelAvail] = useState(0);
  const [selQueue, setSelQueue] = useState(-1);
  const [qty, setQty] = useState(1);
  const [tplName, setTplName] = useState<string | null>(null);
  const [cat, setCat] = useState<string>('all');
  if (!planet || planet.owner !== me.id) return <Modal title="Production">Planète indisponible.</Modal>;
  const allItems = availableItems(g, planet);
  // 3.6: the list filtered by kind of construction
  const cats = ITEM_CATS.filter(c => c.id === 'all' || allItems.some(it => catOf(it.kind) === c.id));
  const items = cat === 'all' || !cats.some(c => c.id === cat) ? allItems : allItems.filter(it => catOf(it.kind) === cat);
  const avail = items[Math.min(selAvail, items.length - 1)];
  const spec = viewSpec(g, planet, me);
  const est = viewQueue(g, planet, 80);
  const mine = g.planets.filter(p => p.owner === me.id);
  const cyc = (d: number) => { const i = mine.findIndex(p => p.id === pid); const p = mine[(i + d + mine.length) % mine.length]; setPid(p.id); setSelQueue(-1); s.select({ kind: 'planet', id: p.id }, true); };
  const add = (e?: MouseEvent) => {
    if (!avail || avail.disabled) return;
    const mult = e ? (e.shiftKey && e.ctrlKey ? 1000 : e.ctrlKey ? 100 : e.shiftKey ? 10 : 1) : 1;
    const n = qty * mult;
    const at = selQueue >= 0 ? selQueue + 1 : undefined;
    A.queueAdd(planet.id, avail.kind, avail.designId, avail.kind === 'starbase' || avail.kind === 'scanner' || avail.kind === 'genesis' || avail.kind === 'capital' || avail.kind === 'mega' || avail.kind === 'culture' || avail.kind === 'agency' ? 1 : n, at, avail.megaId, avail.cultureId, avail.bountyOn);
    if (at !== undefined) setSelQueue(at);
  };
  const qi = planet.queue[selQueue];
  const availCost = avail ? unitCost(g, planet, me, avail) : null;
  const queueCostSel = qi ? unitCost(g, planet, me, qi) : null;
  const design = avail?.designId !== undefined ? g.designs.find(d => d.id === avail.designId) : undefined;
  const oldSb = planet.starbase ? g.designs.find(d => d.id === planet.starbase!.designId) : undefined;
  return (
    <Modal title={<span class="prod-title"><PlanetImg id={planet.id} hab={planet.hab} size={28} owned /> File de production · {planet.name}</span>} wide onClose={() => s.close('production')}
      footer={<>
        <button onClick={() => cyc(-1)}>◀ Planète précédente</button><button onClick={() => cyc(1)}>Planète suivante ▶</button>
        <span class="sp" />
        <select onChange={e => { const v = +(e.target as HTMLSelectElement).value; if (v) { s.checkpoint(); applyTemplate(g, planet, v); s.bump(); } (e.target as HTMLSelectElement).value = ''; }}>
          <option value="">Appliquer un modèle…</option>{me.templates.map(t => <option value={t.id}>{t.name}</option>)}
        </select>
        {tplName === null ? <button onClick={() => setTplName(`Modèle ${me.templates.length + 1}`)}>Enregistrer comme modèle</button> : <>
          <input id="tpl-name" value={tplName} onInput={e => setTplName((e.target as HTMLInputElement).value)} style={{ width: '150px' }} />
          <button onClick={() => { if (tplName.trim()) { s.checkpoint(); me.templates.push({ id: Math.max(0, ...me.templates.map(t => t.id)) + 1, name: tplName.trim(), items: planet.queue.filter(q => !['ship', 'starbase', 'refit', 'mega', 'capital', 'culture', 'bounty', 'spy', 'agency'].includes(q.kind)).map(q => ({ kind: q.kind, designId: q.designId, qty: q.qty })) }); s.notify('Modèle enregistré'); setTplName(null); s.bump(); } }}>Enregistrer</button>
        </>}
        <button class="primary" data-tut="prod-ok" onClick={() => s.close('production')}>OK</button>
      </>}>
      <div class="prod">
        <div class="prod-col">
          <h4>Éléments disponibles</h4>
          <div class="chips prod-cats">{cats.map(c => <button class={cat === c.id || (c.id === 'all' && !cats.some(x => x.id === cat)) ? 'on' : ''} onClick={() => { setCat(c.id); setSelAvail(0); }}>{c.label}</button>)}</div>
          <ul class="list avail" data-tut="prod-avail">
            {items.map((it, i) => (
              <li class={(i === selAvail ? 'sel ' : '') + (it.disabled ? 'dis ' : '') + (isAuto(it.kind) ? 'auto ' : '') + (it.kind === 'ship' || it.kind === 'starbase' ? 'design' : '')} data-tut={it.designId !== undefined ? 'avail-d' + it.designId : 'avail-' + it.kind} title={it.disabled ?? ''}
                onClick={() => setSelAvail(i)} onDblClick={e => { setSelAvail(i); add(e as unknown as MouseEvent); }}><span title={itemTip(g, me, it) + (it.disabled ? `\nIndisponible : ${it.disabled}` : '')}>{it.label}</span>{it.kind === 'starbase' && <span class="muted small"> (station)</span>}{it.kind === 'mega' && <span class="muted small"> (mégaprojet)</span>}{it.kind === 'culture' && <span class="muted small"> (culture)</span>}</li>
            ))}
          </ul>
        </div>
        <div class="prod-mid" data-tut="prod-add">
          <label class="small">Quantité</label>
          <Num value={qty} min={1} onChange={v => setQty(Math.max(1, v))} width={70} />
          <button class="primary" onClick={e => add(e as unknown as MouseEvent)} disabled={!avail || !!avail.disabled}>Ajouter ▸</button>
          <div class="small muted">Maj ×10 · Ctrl ×100</div>
          <div class="small muted">{selQueue >= 0 ? 'Inséré après la ligne choisie' : 'Ajouté en fin de file'}</div>
          <button onClick={() => { A.queueClear(planet.id); setSelQueue(-1); }} disabled={!planet.queue.length}>Vider la file</button>
        </div>
        <div class="prod-col">
          <h4>File ({planet.queue.length})</h4>
          <table class="queue" data-tut="prod-queue">
            <thead><tr><th>Élément</th><th>Qté</th><th>Fin</th><th></th></tr></thead>
            <tbody>
              {planet.queue.length === 0 && <tr><td colSpan={4} class="muted">File vide : la planète ne produit rien.</td></tr>}
              {planet.queue.map((it, i) => {
                const e = est[i];
                const cls = (i === selQueue ? 'sel ' : '') + (isAuto(it.kind) ? 'auto ' : '') + (e?.blocked ? 'blocked' : e?.doneThisYear ? 'done' : '');
                return <tr class={cls} data-tut={'q-' + i} onClick={() => setSelQueue(i)}>
                  <td title={itemTip(g, me, it)}>{itemLabel(g, it)}{it.mission && <span class="tag">{it.mission.kind === 'logistics' ? 'réseau logistique' : `${it.mission.kind === 'colonize' ? 'colonise' : it.mission.kind === 'mine' ? 'fore' : it.mission.kind === 'haul' ? 'navette' : 'explore'} ${g.planets[it.mission.planetId].name}`}</span>}{it.kind === 'starbase' && planet.starbase && planet.starbase.designId !== it.designId && <span class="tag">mise à niveau</span>}{it.kind === 'mega' ? <span class="tag mega">{Math.floor(megaProgress(it) * 100)} %</span> : it.allocated.resources + it.allocated.ironium > 0 && <span class="muted small"> (entamé)</span>}</td>
                  <td><Num value={it.qty} min={0} onChange={v => A.queueSetQty(planet.id, i, v)} width={64} />{isAuto(it.kind) && <span class="muted small">/an</span>}</td>
                  <td class="small">{isAuto(it.kind) ? (maxBuildable(g, planet, it.kind) === 0 ? 'terminé' : 'chaque année') : e?.blocked ? <span class="red slow-why" title={`Bloqué : ${queueBottleneck(g, planet, i, est).text || 'rien ne le retient, sinon la file'}`}>bloqué ?</span> : e?.lastYear ? (e.lastYear >= SLOW ? <span class="yellow slow-why" title={`Ce qui le retarde : ${queueBottleneck(g, planet, i, est).text}`}>{e.lastYear} ans ?</span> : e.lastYear === 1 ? 'cette année' : `${e.lastYear} ans`) : '…'}</td>
                  <td class="pq-arrows" onClick={ev => ev.stopPropagation()}>
                    <button class="ar" title="Tout en haut" disabled={i === 0} onClick={() => { A.queueMove(planet.id, i, 0); setSelQueue(0); }}>⤒</button>
                    <button class="ar" title="Monter" disabled={i === 0} onClick={() => { A.queueMove(planet.id, i, i - 1); setSelQueue(i - 1); }}>↑</button>
                    <button class="ar" title="Descendre" disabled={i === planet.queue.length - 1} onClick={() => { A.queueMove(planet.id, i, i + 1); setSelQueue(i + 1); }}>↓</button>
                    <button class="ar" title="Tout en bas" disabled={i === planet.queue.length - 1} onClick={() => { A.queueMove(planet.id, i, planet.queue.length - 1); setSelQueue(planet.queue.length - 1); }}>⤓</button>
                    <button class="ar del" title="Retirer" onClick={() => { A.queueRemove(planet.id, i); setSelQueue(-1); }}>✕</button>
                  </td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div class="prod-info">
        <div class="pi">
          {avail && <>
            <h4>{avail.label}</h4>
            {design && <div class="pi-design"><HullImg hull={design.hull} color={me.color} w={64} /><div class="small">{tl(design.hull)} · {fmt(designSpec(me, design).mass)} kt · blindage {fmt(designSpec(me, design).armor)}</div></div>}
            {availCost && <Row k={avail.kind === 'mega' ? 'Coût total' : avail.kind === 'starbase' && oldSb ? 'Coût de la mise à niveau' : 'Coût unitaire'} v={<Cost c={availCost} />} />}
            {avail.kind === 'starbase' && oldSb && design && <Row k="Station neuve (pour comparer)" v={<span class="muted"><Cost c={designCost(me, design)} /></span>} />}
            {avail.kind === 'mega' && MEGA[avail.megaId as MegaId] && <Row k="Par an au plus" v={<Cost c={megaYearCap(MEGA[avail.megaId as MegaId])} />} />}
            <p class="small muted">{avail.kind === 'mega' || avail.kind === 'culture' ? itemTip(g, me, avail) : DESCRIPTIONS[avail.kind] ?? (avail.kind === 'ship' ? 'Vaisseau construit au chantier de la station orbitale. Les vaisseaux d\'une même ligne forment une flotte.' : avail.kind === 'starbase' ? (oldSb ? `Mise à niveau de la station actuelle (${oldSb.name}), comme dans Stars! : les composants conservés sont gratuits, ceux qui changent ne coûtent qu'une partie de leur prix, et une nouvelle coque coûte son prix diminué de la moitié de celui de l'ancienne. La station reste en service pendant les travaux et garde la même part de dégâts.` : 'Construit la station orbitale de la planète.') : '')}</p>
            {avail.disabled && <div class="alert small">{avail.disabled}</div>}
          </>}
        </div>
        <div class="pi">
          <h4>Planète</h4>
          <Row k="Ressources / an" v={`${fmt(spec.resourcesAvailable)} (sur ${fmt(spec.resources)} ; le reste va à la recherche)`} />
          <Row k="Minerais en surface" v={<Cost c={{ ...planet.surface, resources: 0 }} />} />
          <Row k="Extraction / an" v={<Cost c={{ ...spec.mining, resources: 0 }} />} />
          {qi && queueCostSel && <><h4>Ligne sélectionnée</h4><Row k={`${itemLabel(g, qi)} · coût`} v={<Cost c={queueCostSel} />} />
            {qi.kind === 'mega' && <Row k="Déjà investi" v={<><Cost c={qi.allocated} /> <span class="muted small">({Math.floor(megaProgress(qi) * 100)} % ; les ressources investies sont perdues si vous le retirez)</span></>} />}
            {!isAuto(qi.kind) && est[selQueue] && <Row k="Achèvement" v={est[selQueue].blocked ? 'pas avant 80 ans au rythme actuel' : `${est[selQueue].firstYear === est[selQueue].lastYear ? '' : `premier dans ${est[selQueue].firstYear} a, `}tout dans ${est[selQueue].lastYear} a`} />}
            {!isAuto(qi.kind) && est[selQueue] && (est[selQueue].blocked || (est[selQueue].lastYear ?? 0) >= SLOW) && <SlowWhy planetId={planet.id} index={selQueue} est={est} />}</>}
          <label class="chk"><input type="checkbox" checked={planet.leftoverOnly} onChange={e => { s.checkpoint(); planet.leftoverOnly = (e.target as HTMLInputElement).checked; s.bump(); }} /> Seulement les ressources restantes vont à la recherche</label>
        </div>
      </div>
    </Modal>
  );
}
