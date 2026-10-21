// Ship & starbase designer and technology browser.
import { useEffect, useState } from 'preact/hooks';
import { partBrief } from '../techtext';
import { upgradeTargets } from '../../engine/upgrade';
import { store, useStore, fmt, fmtPop } from '../store';
import { Modal, Row, HullImg, CompIcon, Cost, Tabs } from '../components';
import { hullSvg } from '../art';
import type { DesignSlot, ShipDesign, Player, ShipRole } from '../../engine/types';
import { simulateBattle, type SimResult } from '../../engine/battle';
import { Num } from '../components';
import * as A from '../actions';
import { HULLS, TECHS, hasTech, partFitsSlot, playerCost, slotLabel, CATEGORY_NAMES, techRequirementText, FIELD_NAMES, reqLevels, canLearn, mainField } from '../../engine/tech';
import { designSpec, validateDesign, availableHulls, autoRole, type DesignSpec , isScoutDesign } from '../../engine/design';
import { addDesign } from '../../engine/newgame';
import type { HullData, TechData } from '../../data/types';
import { TECH_DATA } from '../../data/techs';
import { HULL_DATA } from '../../data/hulls';
import { FIELDS } from '../../engine/types';
import { tl } from '../../data/labels';
import { TechTip, techInfo } from '../techinfo';
import { EngineChart } from '../enginechart';
import { PRT_INFO, LRT_INFO } from '../../engine/race';
import { techOdds } from '../../engine/research';
import { knownState } from './research';
import { gapOf, GAP_WORDS } from '../../engine/espionage';

const MAX_DESIGNS = { ship: 30, starbase: 15 };

export function DesignerDialog(props: { designId?: number; view?: boolean; /** 0.3.8: open the editor on a new design of this hull (tutorial) */ newHull?: string }) {
  const s = useStore();
  const g = s.game!, me = s.me!;
  const initial = props.designId !== undefined ? g.designs.find(d => d.id === props.designId) : undefined;
  const [starbase, setStarbase] = useState(initial?.starbase ?? false);
  // 3.6: a foreign design (opened from a battle) shows in the "Ennemis" tab
  const [tab, setTab] = useState<'designs' | 'hulls' | 'enemy' | 'components'>(initial && initial.owner !== me.id && me.intel.designs[initial.id] ? 'enemy' : 'designs');
  const [selId, setSelId] = useState<number | undefined>(initial?.id);
  const [selHull, setSelHull] = useState<string | undefined>();
  const [draft, setDraft] = useState<ShipDesign | null>(() => props.newHull && HULLS.get(props.newHull) ? { id: -1, owner: me.id, name: nextName(me, g.designs, props.newHull), hull: props.newHull, slots: [], starbase: !!HULLS.get(props.newHull)!.starbase, built: 0 } : null);
  const designs = g.designs.filter(d => d.owner === me.id && !d.deleted && d.starbase === starbase);
  const sel = designs.find(d => d.id === selId) ?? designs[0];
  const count = (d: ShipDesign) => g.fleets.filter(f => f.owner === me.id).reduce((a, f) => a + f.tokens.filter(t => t.designId === d.id).reduce((b, t) => b + t.qty, 0), 0) + g.planets.filter(p => p.owner === me.id && p.starbase?.designId === d.id).length;
  if (draft) return <DesignEditor draft={draft} onCancel={() => setDraft(null)} onSave={d => {
    s.checkpoint();
    if (d.id >= 0) { const ex = g.designs.find(x => x.id === d.id)!; ex.name = d.name; ex.slots = d.slots; ex.hull = d.hull; ex.role = d.role; ex.scout = d.scout; setSelId(ex.id); }
    else { const nd = addDesign(g, { ...d, owner: me.id, built: 0 }); setSelId(nd.id); }
    setDraft(null); setTab('designs'); s.bump();
  }} />;
  const startNew = (hull: string) => {
    // 0.3.9.21: the same cap as for a copy (a new design on a hull went past it)
    const sb = !!HULLS.get(hull)?.starbase;
    if (g.designs.filter(d => d.owner === me.id && !d.deleted && d.starbase === sb).length >= (sb ? MAX_DESIGNS.starbase : MAX_DESIGNS.ship)) { s.notify('Nombre maximal de modèles atteint'); return; }
    setDraft({ id: -1, owner: me.id, name: nextName(me, g.designs, hull), hull, slots: [], starbase: sb, built: 0 });
  };
  return (
    <Modal title="Conception" sub="Modèles de vaisseaux et de stations orbitales, coques disponibles, modèles ennemis repérés." wide onClose={() => s.close('designer')} footer={<button class="primary" onClick={() => s.close('designer')}>Terminé</button>}>
      <div class="designer">
        <div class="ds-left">
          <Tabs tabs={[{ id: 'ships' as const, label: 'Vaisseaux' }, { id: 'starbases' as const, label: 'Stations' }]} value={starbase ? 'starbases' : 'ships'} onChange={v => { setStarbase(v === 'starbases'); setSelId(undefined); }} />
          <Tabs tabs={[{ id: 'designs' as const, label: 'Modèles' }, { id: 'hulls' as const, label: 'Coques' }, { id: 'enemy' as const, label: 'Ennemis' }, { id: 'components' as const, label: 'Composants' }]} value={tab} onChange={setTab} />
          {tab === 'designs' && <ul class="list designs">
            {designs.map(d => <li class={d === sel ? 'sel' : ''} onClick={() => setSelId(d.id)}><HullImg hull={d.hull} color={me.color} w={44} /><span>{d.name}</span><span class="muted small">{count(d)} / {d.built}</span></li>)}
            {designs.length === 0 && <li class="muted">Aucun modèle</li>}
          </ul>}
          {tab === 'hulls' && <ul class="list designs">{availableHulls(me, starbase).map((h, i) => <li class={(selHull ?? availableHulls(me, starbase)[0]?.name) === h.name || (i === 0 && selHull && !availableHulls(me, starbase).some(x => x.name === selHull)) ? 'sel' : ''} onClick={() => setSelHull(h.name)} onDblClick={() => startNew(h.name)}><HullImg hull={h.name} color={me.color} w={44} /><span>{tl(h.name)}</span></li>)}</ul>}
          {tab === 'enemy' && <ul class="list designs">{Object.values(me.intel.designs).filter(d => d.starbase === starbase).map(d => <li class={selId === d.id ? 'sel' : ''} onClick={() => setSelId(d.id)}><HullImg hull={d.hull} color={g.players[d.owner].color} w={44} /><span>{d.name}</span><span class="small" style={{ color: g.players[d.owner].color }}>{g.players[d.owner].name}</span></li>)}{Object.keys(me.intel.designs).length === 0 && <li class="muted">Aucun modèle ennemi connu</li>}</ul>}
        </div>
        <div class="ds-main">
          {tab === 'components' ? <TechBrowserBody /> : tab === 'hulls' ? (() => { const hn = selHull && availableHulls(me, starbase).some(h => h.name === selHull) ? selHull : availableHulls(me, starbase)[0]?.name; return hn ? <HullView player={me} hull={HULLS.get(hn)!} onNew={() => startNew(hn)} /> : <p class="muted">Aucune coque disponible.</p>; })()
            : tab === 'enemy' ? (selId !== undefined && me.intel.designs[selId] ? <EnemyDesign id={selId} /> : <p class="muted">Les modèles ennemis apparaissent quand vous rencontrez leurs vaisseaux. Leur équipement n'est connu qu'après une bataille.</p>)
              : sel ? <>
                <DesignView player={me} design={sel} />
                {!sel.starbase && g.settings.combatRoles && designSpec(me, sel).hasWeapons && <RolePicker design={sel} />}
                {!sel.starbase && designSpec(me, sel).scanRange > 0 && <ScoutPicker design={sel} />}
                {designSpec(me, sel).hasWeapons && <CombatSim design={sel} key={'sim' + sel.id} />}
                <DesignCompare design={sel} key={'cmp' + sel.id} />
                {sel.alien && <p class="small muted">Modèle impossible à reproduire (épave restaurée, technologie des Anciens ou prise de guerre) : ses vaisseaux volent et se battent, mais on ne peut ni le construire, ni le copier, ni le modifier.</p>}
                <div class="btns">
                  <button disabled={!!sel.alien} onClick={() => { if (designs.length >= (starbase ? MAX_DESIGNS.starbase : MAX_DESIGNS.ship)) { s.notify('Nombre maximal de modèles atteint'); return; } setDraft({ ...JSON.parse(JSON.stringify(sel)), id: -1, name: sel.name + ' (copie)', built: 0, deleted: undefined, purpose: sel.purpose === 'beacon' ? undefined : sel.purpose }); }}>Copier le modèle</button>
                  <button disabled={count(sel) > 0 || !!sel.alien} title={sel.alien ? 'Modèle impossible à reproduire' : count(sel) > 0 ? 'Des vaisseaux de ce modèle existent : copiez-le plutôt' : ''} onClick={() => setDraft(JSON.parse(JSON.stringify(sel)))}>Modifier</button>
                  <button class="danger" onClick={() => {
                    const n = count(sel);
                    const ships = n > 1 ? `Les ${n} vaisseaux ou stations déjà construits restent en service` : n === 1 ? 'Le vaisseau ou la station déjà construit reste en service' : '';
                    s.ask(n ? `Retirer le modèle « ${sel.name} » ? On ne pourra plus le construire. ${ships}, marqué${n > 1 ? 's' : ''} « obsolète »${sel.starbase ? '' : ' ; en orbite d\'un chantier, ils peuvent être modernisés vers un modèle de même coque'}.` : `Supprimer le modèle « ${sel.name} » ?`, () => {
                      A.deleteDesign(sel);
                      setSelId(undefined);
                    }, n ? 'Retirer' : 'Supprimer');
                  }}>Supprimer</button>
                </div>
              </> : <p class="muted">Aucun modèle. Onglet « Coques » pour en créer un.</p>}
        </div>
      </div>
    </Modal>
  );
}

function nextName(me: Player, designs: ShipDesign[], hull: string): string {
  let i = 1;
  const base = tl(hull);
  while (designs.some(d => d.owner === me.id && d.name === `${base} ${i}`)) i++;
  return `${base} ${i}`;
}

function EnemyDesign({ id }: { id: number }) {
  const s = store; const g = s.game!; const me = s.me!;
  const d = me.intel.designs[id];
  const owner = g.players[d.owner];
  const h = HULLS.get(d.hull)!;
  return <div>
    <h3>{d.name} <span class="small" style={{ color: owner.color }}>({owner.name})</span></h3>
    <Schematic hull={h} slots={d.slots ?? []} color={owner.color} />
    {d.slots ? <StatsPanel spec={designSpec(owner, { hull: d.hull, slots: d.slots, starbase: d.starbase })} /> : <p class="muted small">Équipement inconnu : il sera révélé lors d'une bataille contre ce modèle.</p>}
    {d.slots && <DesignCompare key={'cmpe' + id} owner={owner} design={{ id: d.id, owner: d.owner, name: d.name, hull: d.hull, slots: d.slots, starbase: d.starbase, built: 0 }} />}
  </div>;
}

function HullView({ player, hull, onNew }: { player: Player; hull: HullData; onNew: () => void }) {
  const spec = designSpec(player, { hull: hull.name, slots: [], starbase: hull.starbase });
  return <div>
    <h3>{tl(hull.name)}</h3>
    <Schematic hull={hull} slots={[]} color={player.color} />
    <div class="ds-stats-row"><StatsPanel spec={spec} /><div><Row k="Prérequis" v={techRequirementText(hull.req)} /><Row k="Initiative" v={hull.init} /><Row k="Blindage de coque" v={hull.armor} /></div></div>
    <button class="primary" onClick={onNew}>Nouveau modèle sur cette coque</button>
  </div>;
}

const ROLES: [ShipRole, string, string][] = [
  ['screen', 'Écran', 'Se place en avant et attire les tirs ennemis : protège les vaisseaux de ligne et l\'artillerie.'],
  ['line', 'Ligne', 'Combat normalement.'],
  ['artillery', 'Artillerie', 'Se place en retrait, garde ses distances et n\'est visée qu\'en dernier : idéal pour les armes à longue portée.'],
];

/** Constellations 3: battle role of a design (can change at any time: it is a doctrine, not hardware). */
function RolePicker({ design }: { design: ShipDesign }) {
  const s = useStore();
  // 3.6: no choice = automatic, from the weapons
  const auto = autoRole(designSpec(s.me!, design));
  const cur = design.role ?? 'auto';
  const name = (r: ShipRole) => ROLES.find(x => x[0] === r)![1].toLowerCase();
  return <div class="role-pick">
    <span class="k">Rôle au combat</span>
    <div class="seg"><button class={cur === 'auto' ? 'on' : ''} title={`Selon les armes : torpilles et missiles en artillerie, rayons en ligne (ici : ${name(auto)})`} onClick={() => { A.setDesignRole(design, undefined); s.bump(); }}>Automatique</button>{ROLES.map(([k, l, t]) => <button class={cur === k ? 'on' : ''} title={t} onClick={() => { A.setDesignRole(design, k); s.bump(); }}>{l}</button>)}</div>
    <span class="small muted">{cur === 'auto' ? `Selon ses armes : ${name(auto)}. ${ROLES.find(r => r[0] === auto)![2]}` : ROLES.find(r => r[0] === cur)![2]}</span>
  </div>;
}

/** 0.3.8.10: counted as a scout or not (only for a design with a scanner; by default, the Scout hull). */
function ScoutPicker({ design }: { design: ShipDesign }) {
  const s = useStore();
  const on = isScoutDesign(design, designSpec(s.me!, design));
  return <div class="role-pick">
    <label class="chk"><input type="checkbox" checked={on} onChange={e => { A.setDesignScout(design, (e.target as HTMLInputElement).checked); s.bump(); }} /> Éclaireur</label>
    <span class="small muted">{on ? 'Ses vaisseaux sont proposés pour les missions d\'exploration et signalés quand ils restent sans ordre.' : 'Ses vaisseaux ne sont ni proposés pour explorer ni signalés comme éclaireurs sans ordre.'} Par défaut, seuls les modèles sur coque Éclaireur le sont.</span>
  </div>;
}

/** Combat simulator: this design against a known design, with the real battle engine, at equal technology. */
function CombatSim({ design }: { design: ShipDesign }) {
  const s = useStore();
  const g = s.game!, me = s.me!;
  const mineIsStation = design.starbase;
  // armed designs only, the most dangerous first: known rival designs (equipment seen in battle), then ours;
  // 3.3.6: stations too (a ship design attacks them in their orbit; a station design defends against ships)
  const armed = (d: ShipDesign) => designSpec(me, d).powerRating;
  const known = (st: boolean) => Object.values(me.intel.designs).filter(d => d.slots && d.starbase === st).map(d => ({ key: (st ? 'se' : 'e') + d.id, label: `${d.name} (${g.players[d.owner].name}${st ? ', station' : ''})`, station: st, d: { id: d.id, owner: d.owner, name: d.name, hull: d.hull, slots: d.slots!, starbase: st, built: 0 } as ShipDesign }));
  const ours = (st: boolean) => g.designs.filter(d => d.owner === me.id && !d.deleted && d.starbase === st && (st || armed(d) > 0)).sort((a, b) => armed(b) - armed(a)).map(d => ({ key: (st ? 'so' : 'o') + d.id, label: `${d.name} (vos ${st ? 'stations' : 'modèles'})`, station: st, d }));
  const foes: { key: string; label: string; station: boolean; d: ShipDesign }[] = mineIsStation
    ? [...known(false).filter(x => armed(x.d) > 0).sort((a, b) => armed(b.d) - armed(a.d)), ...ours(false)]
    : [...known(false).filter(x => armed(x.d) > 0).sort((a, b) => armed(b.d) - armed(a.d)), ...ours(false), ...known(true), ...ours(true)];
  const [foe, setFoe] = useState(foes[0]?.key ?? '');
  const [qa, setQa] = useState(3), [qb, setQb] = useState(3);
  const [res, setRes] = useState<SimResult | null>(null);
  const f = foes.find(x => x.key === foe) ?? foes[0];
  if (!f) return null;
  const run = () => {
    const seed = `sim|${design.id}|${f.key}|${qa}|${qb}|${g.year}`;
    if (mineIsStation) setRes(simulateBattle(g, me.id, [], [{ design: f.d, qty: qb }], 40, undefined, me.battlePlans[0], seed, { side: 0, design }));
    else if (f.station) setRes(simulateBattle(g, me.id, [{ design, qty: qa }], [], 40, undefined, me.battlePlans[0], seed, { side: 1, design: f.d }));
    else setRes(simulateBattle(g, me.id, [{ design, qty: qa }], [{ design: f.d, qty: qb }], 40, undefined, me.battlePlans[0], seed));
  };
  return <section class="combat-sim">
    <h4>Simulateur de combat</h4>
    <div class="sim-row">
      {mineIsStation ? <span>Votre station {design.name}</span> : <><Num value={qa} min={1} max={500} width={56} onChange={v => { setQa(Math.max(1, v)); setRes(null); }} /><span>× {design.name}</span></>}
      <span class="vs">contre</span>
      {f.station ? <span>1 station</span> : <Num value={qb} min={1} max={500} width={56} onChange={v => { setQb(Math.max(1, v)); setRes(null); }} />}
      <select value={f.key} onChange={e => { setFoe((e.target as HTMLSelectElement).value); setRes(null); }}>
        {foes.some(x => !x.station) && <optgroup label="Vaisseaux">{foes.filter(x => !x.station).map(x => <option value={x.key}>{x.label}</option>)}</optgroup>}
        {foes.some(x => x.station) && <optgroup label="Stations (combat en orbite)">{foes.filter(x => x.station).map(x => <option value={x.key}>{x.label}</option>)}</optgroup>}
      </select>
      <button class="small primary" onClick={run}>Simuler 40 combats</button>
    </div>
    {res && <div class="sim-res">
      <div class="sim-bar"><i class="w" style={{ width: res.winA / res.runs * 100 + '%' }} /><i class="d" style={{ width: res.draws / res.runs * 100 + '%' }} /><i class="l" style={{ width: res.winB / res.runs * 100 + '%' }} /></div>
      <div class="sim-nums"><span class="good">{Math.round(res.winA / res.runs * 100)} % de victoires</span><span class="muted">{Math.round(res.draws / res.runs * 100)} % indécis</span><span class="bad">{Math.round(res.winB / res.runs * 100)} % de défaites</span></div>
      <div class="small">Pertes moyennes : <b>{fmt(res.lostA, 1)}</b> {mineIsStation ? 'station' : 'des vôtres'} ({fmt(res.costLostA)} R) contre <b>{fmt(res.lostB, 1)}</b> {f.station ? 'station' : 'adverses'} ({fmt(res.costLostB)} R) · {fmt(res.rounds, 1)} rounds</div>
      {res.stationDamage !== undefined && <div class="small">{mineIsStation ? 'Votre station' : 'La station'} perd en moyenne <b>{Math.round(res.stationDamage * 100)} %</b> de son blindage{res.stationDamage < 0.05 && !mineIsStation ? ' : vos armes n\'entament pas ses boucliers, ou vos vaisseaux restent hors de sa portée (plan de bataille prudent)' : ''}.</div>}
    </div>}
    <p class="small muted">Moteur de combat réel, {mineIsStation || f.station ? 'en orbite de la station (immobile, portée de ses armes +1 ; les défenses planétaires ne tirent pas sur les vaisseaux)' : 'espace libre'}, votre plan « Par défaut » contre un adversaire au plan standard, les deux à votre niveau technologique (celui de l'adversaire est inconnu). {f.station && !mineIsStation ? 'Victoire = station détruite. ' : ''}{mineIsStation ? 'Victoire = assaillants détruits ou repoussés, station intacte. ' : ''}</p>
  </section>;
}

/** 3.6: two designs side by side, metric by metric, as a butterfly chart (where each one is stronger, and by how much). */
interface Metric { k: string; a: number; b: number; lower?: boolean; show: (v: number) => string; tip?: string }
function compareMetrics(sa: DesignSpec, sb: DesignSpec, station: boolean): Metric[] {
  const dmg = (sp: DesignSpec) => sp.weapons.reduce((a, w) => a + w.power * w.qty * (w.torpedo ? w.accuracy + (1 - w.accuracy) * sp.torpedoBonus : 1) /* 0.3.9.21: beam power already has the capacitors */, 0);
  const reach = (sp: DesignSpec) => sp.weapons.reduce((a, w) => Math.max(a, w.range), 0);
  const hp = (sp: DesignSpec) => sp.armor + sp.shields;
  const total = (sp: DesignSpec) => sp.cost.resources + sp.cost.ironium + sp.cost.boranium + sp.cost.germanium;
  const value = (sp: DesignSpec) => sp.powerRating > 0 && total(sp) > 0 ? Math.sqrt(hp(sp) * sp.powerRating) / total(sp) * 100 : 0;
  const pct = (v: number) => `${Math.round(v * 100)} %`;
  const range = (v: number) => Number.isFinite(v) ? `${fmt(v)} al` : 'illimitée';
  const m: Metric[] = [
    { k: 'Puissance de feu', a: sa.powerRating, b: sb.powerRating, show: v => fmt(v), tip: 'Indice de puissance des armes (dégâts, portée, initiative).' },
    { k: 'Dégâts par round', a: dmg(sa), b: dmg(sb), show: v => `≈ ${fmt(v)}`, tip: 'Dégâts attendus par vaisseau et par round, précision des torpilles et bonus des faisceaux compris.' },
    { k: 'Portée des armes', a: reach(sa), b: reach(sb), show: v => String(v) },
    { k: 'Blindage', a: sa.armor, b: sb.armor, show: v => `${fmt(v)} dp` },
    { k: 'Boucliers', a: sa.shields, b: sb.shields, show: v => `${fmt(v)} dp` },
    { k: 'Brouillage', a: sa.torpedoJamming, b: sb.torpedoJamming, show: pct, tip: 'Part des torpilles adverses détournées.' },
    { k: 'Déflecteurs', a: 1 - sa.beamDefense, b: 1 - sb.beamDefense, show: pct, tip: 'Réduction des dégâts des faisceaux adverses.' },
    { k: 'Initiative', a: sa.initiative, b: sb.initiative, show: v => String(v), tip: 'Qui tire en premier à chaque round.' },
  ];
  if (!station) m.push(
    { k: 'Mouvement au combat', a: sa.movement / 4, b: sb.movement / 4, show: v => v.toFixed(2).replace('.', ',') },
    { k: 'Vitesse idéale', a: sa.engine ? sa.idealSpeed : 0, b: sb.engine ? sb.idealSpeed : 0, show: v => v ? `W${v}` : '–' },
    { k: 'Autonomie', a: sa.engine ? sa.estimatedRange : 0, b: sb.engine ? sb.estimatedRange : 0, show: range },
    { k: 'Carburant', a: sa.fuelCapacity, b: sb.fuelCapacity, show: v => `${fmt(v)} mg` },
    { k: 'Soute', a: sa.cargoCapacity, b: sb.cargoCapacity, show: v => `${fmt(v)} kt` },
  );
  m.push(
    { k: 'Scanner', a: Math.max(0, sa.scanRange), b: Math.max(0, sb.scanRange), show: v => `${fmt(v)} al` },
    { k: 'Camouflage', a: sa.cloakPercent, b: sb.cloakPercent, show: v => `${v} %` },
    { k: 'Coût en ressources', a: sa.cost.resources, b: sb.cost.resources, lower: true, show: v => `${fmt(v)} R`, tip: 'Ressources par vaisseau : moins, c\'est mieux.' },
    { k: 'Coût en minerais', a: sa.cost.ironium + sa.cost.boranium + sa.cost.germanium, b: sb.cost.ironium + sb.cost.boranium + sb.cost.germanium, lower: true, show: v => `${fmt(v)} kt`, tip: 'Ironium, boranium et germanium par vaisseau : moins, c\'est mieux.' },
    { k: 'Valeur de combat par coût', a: value(sa), b: value(sb), show: v => v.toFixed(1).replace('.', ','), tip: 'Racine de (structure × puissance de feu) divisée par le coût total (ressources et minerais) : à budget égal, la flotte la plus forte est celle qui a la meilleure valeur (loi de Lanchester). Ne tient compte ni de la portée ni de l\'initiative : le simulateur, si.' },
  );
  return m.filter(x => (x.a || x.b) && (Number.isFinite(x.a) || Number.isFinite(x.b) || x.a !== x.b));
}

function DesignCompare({ design, owner }: { design: ShipDesign; owner?: Player }) {
  const s = useStore();
  const g = s.game!, me = s.me!;
  const own = owner ?? me;
  const st = design.starbase;
  const theirs = Object.values(me.intel.designs).filter(d => d.slots && d.starbase === st && d.id !== design.id).sort((a, b) => designSpec(g.players[b.owner], { hull: b.hull, slots: b.slots!, starbase: st }).powerRating - designSpec(g.players[a.owner], { hull: a.hull, slots: a.slots!, starbase: st }).powerRating).map(d => ({ key: 'e' + d.id, label: `${d.name} (${g.players[d.owner].name})`, owner: g.players[d.owner], d: { id: d.id, owner: d.owner, name: d.name, hull: d.hull, slots: d.slots!, starbase: st, built: 0 } as ShipDesign }));
  const ours = g.designs.filter(d => d.owner === me.id && !d.deleted && d.starbase === st && d.id !== design.id).sort((a, b) => designSpec(me, b).powerRating - designSpec(me, a).powerRating).map(d => ({ key: 'o' + d.id, label: `${d.name} (vos modèles)`, owner: me, d }));
  // an enemy design is compared with ours first; ours with the enemy's first
  const opts = own.id === me.id ? [...theirs, ...ours] : [...ours, ...theirs];
  const [other, setOther] = useState(opts[0]?.key ?? '');
  const o = opts.find(x => x.key === other) ?? opts[0];
  if (!o) return null;
  const sa = designSpec(own, design), sb = designSpec(o.owner, o.d);
  const rows = compareMetrics(sa, sb, st);
  const better = (x: Metric) => x.a === x.b ? 0 : (x.a > x.b) !== !!x.lower ? 1 : -1;
  const width = (v: number, x: Metric) => {
    const fin = (n: number) => Number.isFinite(n) ? n : Math.max(...[x.a, x.b].filter(Number.isFinite), 1) * 1.5;
    const top = Math.max(fin(x.a), fin(x.b));
    return top > 0 ? Math.max(2, fin(v) / top * 100) : 0;
  };
  const wins = rows.filter(x => better(x) > 0).map(x => x.k.toLowerCase());
  const loses = rows.filter(x => better(x) < 0).map(x => x.k.toLowerCase());
  const word = (x: Metric) => { const gap = gapOf(Number.isFinite(x.a) ? x.a * 10 : 1e9, Number.isFinite(x.b) ? x.b * 10 : 1e9); return gap === 'equal' ? 'égalité' : GAP_WORDS[gap]; };
  return <section class="combat-sim cmp">
    <h4>Comparer avec un autre modèle</h4>
    <div class="sim-row">
      <span style={{ color: own.color }}>{design.name}</span><span class="vs">contre</span>
      <select value={o.key} onChange={e => setOther((e.target as HTMLSelectElement).value)}>
        {opts.some(x => x.key[0] === 'e') && <optgroup label="Modèles adverses (équipement connu)">{opts.filter(x => x.key[0] === 'e').map(x => <option value={x.key}>{x.label}</option>)}</optgroup>}
        {opts.some(x => x.key[0] === 'o') && <optgroup label="Vos modèles">{opts.filter(x => x.key[0] === 'o').map(x => <option value={x.key}>{x.label}</option>)}</optgroup>}
      </select>
    </div>
    <div class="cmp-head"><b style={{ color: own.color }}>{design.name}</b><span /><b style={{ color: o.owner.color }}>{o.d.name}</b></div>
    <div class="cmp-grid">
      {rows.map(x => { const w = better(x); return <div class="cmp-row" title={x.tip ? `${x.tip} ${w ? `Avantage ${w > 0 ? design.name : o.d.name}, ${word(x)}.` : ''}` : (w ? `Avantage ${w > 0 ? design.name : o.d.name}, ${word(x)}.` : 'Égalité.')}>
        <span class={'cmp-v l' + (w > 0 ? ' win' : '')}>{x.show(x.a)}</span>
        <span class="cmp-bar l"><i class={w > 0 ? 'win' : ''} style={{ width: width(x.a, x) + '%', background: w >= 0 ? own.color : undefined }} /></span>
        <span class="cmp-k">{x.k}</span>
        <span class="cmp-bar r"><i class={w < 0 ? 'win' : ''} style={{ width: width(x.b, x) + '%', background: w <= 0 ? o.owner.color : undefined }} /></span>
        <span class={'cmp-v r' + (w < 0 ? ' win' : '')}>{x.show(x.b)}</span>
      </div>; })}
    </div>
    <p class="small">{wins.length ? <><b style={{ color: own.color }}>{design.name}</b> l'emporte en {list(wins)}. </> : ''}{loses.length ? <><b style={{ color: o.owner.color }}>{o.d.name}</b> l'emporte en {list(loses)}.</> : ''}{!wins.length && !loses.length ? 'Modèles équivalents.' : ''}</p>
    <p class="small muted">{o.owner.id === me.id && own.id === me.id ? 'Les deux modèles à votre niveau technologique.' : 'Chaque modèle est évalué avec la technologie de son empire ; le simulateur de combat, lui, met les deux camps à votre niveau.'} Une barre pleine et colorée marque le meilleur des deux ; la barre grise, le moins bon.</p>
  </section>;
}

function list(xs: string[]): string {
  return xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} et ${xs[xs.length - 1]}`;
}

function DesignView({ player, design }: { player: Player; design: ShipDesign }) {
  const spec = designSpec(player, design);
  return <div>
    <h3>{design.name} <span class="muted small">{tl(design.hull)}</span></h3>
    <Schematic hull={HULLS.get(design.hull)!} slots={design.slots} color={player.color} />
    <StatsPanel spec={spec} />
  </div>;
}

export function StatsPanel({ spec, habitat = true }: { spec: DesignSpec; habitat?: boolean }) {
  return <div class="ds-stats">
    <div class="col">
      <Row k="Coût" v={<Cost c={spec.cost} />} />
      <Row k="Masse" v={`${fmt(spec.mass)} kt`} />
      <Row k="Carburant max" v={`${fmt(spec.fuelCapacity)} mg`} />
      {spec.cargoCapacity > 0 && <Row k="Soute" v={`${fmt(spec.cargoCapacity)} kt`} />}
      <Row k="Blindage" v={`${fmt(spec.armor)} dp`} />
      <Row k="Boucliers" v={spec.shields ? `${fmt(spec.shields)} dp` : 'aucun'} />
      <Row k="Puissance" v={fmt(spec.powerRating)} />
    </div>
    <div class="col">
      <Row k="Camouflage / brouillage" v={`${spec.cloakPercent} % / ${Math.round(spec.torpedoJamming * 100)} %`} />
      <Row k="Initiative / mouvement" v={`${spec.initiative} / ${(spec.movement / 4).toFixed(2).replace('.', ',')}`} />
      <Row k="Scanner" v={spec.scanRange >= 0 ? `${spec.scanRange} al · pénétrant ${spec.scanRangePen > 0 ? spec.scanRangePen : 0} al` : 'aucun'} />
      {spec.engine && <Row k="Moteur" v={`${tl(spec.engine)} (W${spec.idealSpeed} idéal)`} />}
      {spec.engine && <Row k="Autonomie" v={Number.isFinite(spec.estimatedRange) ? `≈ ${fmt(spec.estimatedRange)} al` : 'illimitée'} />}
      {spec.torpedoBonus > 0 && <Row k="Précision torpilles" v={`+${Math.round(spec.torpedoBonus * 100)} %`} />}
      {spec.beamBonus > 1 && <Row k="Bonus faisceaux" v={`+${Math.round((spec.beamBonus - 1) * 100)} %`} />}
      {spec.beamDefense < 1 && <Row k="Déflecteurs" v={`−${Math.round((1 - spec.beamDefense) * 100)} %`} />}
      {spec.miningRate > 0 && <Row k="Minage" v={`${spec.miningRate} mines robotisées`} />}
      {spec.mineLaying.standard + spec.mineLaying.heavy + spec.mineLaying.speedBump > 0 && <Row k="Pose de mines" v={`${spec.mineLaying.standard + spec.mineLaying.heavy + spec.mineLaying.speedBump} / an`} />}
      {spec.terraformRate > 0 && <Row k="Terraformation" v={`${spec.terraformRate} / an`} />}
      {spec.fuelGeneration > 0 && <Row k="Génération de carburant" v={`${spec.fuelGeneration} mg / an`} />}
      {spec.colonyModule && <Row k="Colonisation" v="oui" />}
      {spec.dock !== 0 && <Row k="Chantier" v={spec.dock === -1 ? 'illimité' : `${spec.dock} kt`} />}
      {spec.gate && <Row k="Porte stellaire" v={<>{spec.gate.safeMass >= 1e9 ? '∞' : spec.gate.safeMass} kt / {spec.gate.safeRange >= 1e9 ? '∞' : spec.gate.safeRange} al{spec.gate.count > 1 && <div class="small warn" title="Comme dans Stars! : un seul portail par station compte, le dernier posé. Le second ne sert à rien.">un seul portail compte (le dernier posé)</div>}</>} />}
      {spec.driver && <Row k="Catapulte" v={<>Warp {spec.driver.safeSpeed}{spec.driver.safeSpeed > spec.driver.speed && <span class="muted small"> ({spec.driver.safeSpeed - spec.driver.speed + 1} × Warp {spec.driver.speed} : +{spec.driver.safeSpeed - spec.driver.speed})</span>}</>} title="Vitesse sûre des paquets. Comme dans Stars! : chaque catapulte identique à la meilleure ajoute +1." />}
      {spec.maxPop > 0 && habitat && <Row k="Habitat (vie orbitale)" v={`${fmtPop(spec.maxPop)} hab.`} />}
      {spec.decoys > 0 && <Row k="Leurres" v={`+${fmt(spec.decoyMass)} kt et +${spec.decoys} vaisseau${spec.decoys > 1 ? 'x' : ''} apparents`} />}
    </div>
  </div>;
}

const UNIT = 66;

export function Schematic({ hull, slots, color, onDrop, onMove, onSlotClick, onSlotRight, highlight }: { hull: HullData; slots: DesignSlot[]; color: string; onDrop?: (slot: number, part: string, e: DragEvent) => void; onMove?: (from: number, to: number, e: DragEvent) => void; onSlotClick?: (slot: number, e: MouseEvent) => void; onSlotRight?: (slot: number) => void; highlight?: (slot: number) => boolean }) {
  const xs = hull.slots.map(s => s.x), ys = hull.slots.map(s => s.y);
  // generous margins so the hull silhouette shows around the slots
  const minX = Math.min(...xs, hull.cargoBox?.x ?? 0) - 1.4, maxX = Math.max(...xs, (hull.cargoBox ? hull.cargoBox.x + hull.cargoBox.w - 1 : 0)) + 1.4;
  const minY = Math.min(...ys, hull.cargoBox?.y ?? 0) - 1.0, maxY = Math.max(...ys, hull.cargoBox ? hull.cargoBox.y + hull.cargoBox.h - 1 : 0) + 1.0;
  const W = (maxX - minX) * UNIT, H = (maxY - minY) * UNIT;
  const px = (x: number) => (x - minX) * UNIT, py = (y: number) => (y - minY) * UNIT;
  return (
    <div class="schematic" style={{ width: W + 'px', height: H + 'px' }}>
      <div class="schem-hull" style={{ backgroundImage: `url("data:image/svg+xml;utf8,${encodeURIComponent(hullSilhouette(hull.name, color))}")` }} />
      {hull.cargoBox && <div class="slot cargo" style={{ left: px(hull.cargoBox.x) - UNIT / 2 + 3 + 'px', top: py(hull.cargoBox.y) - UNIT / 2 + 3 + 'px', width: hull.cargoBox.w * UNIT - 6 + 'px', height: hull.cargoBox.h * UNIT - 6 + 'px' }}><span>Soute<br />{hull.cargo} kt</span></div>}
      {hull.dockBox && <div class="slot cargo dock" style={{ left: px(hull.dockBox.x) - UNIT / 2 + 3 + 'px', top: py(hull.dockBox.y) - UNIT / 2 + 3 + 'px', width: hull.dockBox.w * UNIT - 6 + 'px', height: hull.dockBox.h * UNIT - 6 + 'px' }}><span>Chantier<br />{hull.dock === -1 ? '∞' : hull.dock + ' kt'}</span></div>}
      {hull.slots.map((sl, i) => {
        const idx = i + 1;
        const filled = slots.find(x => x.slot === idx);
        return <div class={'slot' + (filled ? ' filled' : '') + (sl.req && !filled ? ' req' : '') + (highlight?.(idx) ? ' hl' : '')} style={{ left: px(sl.x) - UNIT / 2 + 3 + 'px', top: py(sl.y) - UNIT / 2 + 3 + 'px', width: UNIT - 6 + 'px', height: UNIT - 6 + 'px' }}
          draggable={!!(filled && onMove)}
          onDragStart={e => { if (!filled || !onMove) return; e.dataTransfer?.setData('application/x-slot', String(idx)); e.dataTransfer?.setData('text/plain', 'slot:' + idx); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; }}
          onDragOver={e => { if (onDrop || onMove) e.preventDefault(); }}
          onDrop={e => {
            e.preventDefault();
            // 3.3.6: a component dragged from another slot moves there (it used to drop the icon's image address)
            const txt = e.dataTransfer?.getData('text/plain') ?? '';
            const from = +(e.dataTransfer?.getData('application/x-slot') || (txt.startsWith('slot:') ? txt.slice(5) : '') || 0);
            if (from > 0) { if (onMove && from !== idx) onMove(from, idx, e as DragEvent); return; }
            if (txt && onDrop && TECHS.has(txt)) onDrop(idx, txt, e as DragEvent);
          }}
          onClick={e => onSlotClick?.(idx, e as unknown as MouseEvent)} onContextMenu={e => { e.preventDefault(); onSlotRight?.(idx); }}
          title={filled && TECHS.get(filled.part) ? `${tl(filled.part)} × ${filled.qty} : ${partBrief(TECHS.get(filled.part)!, true)}\n${slotLabel(sl.types)} · jusqu'à ${sl.cap}` : `${slotLabel(sl.types)} · jusqu'à ${sl.cap}${sl.req ? ' (obligatoire)' : ''}`}>
          {filled ? <><CompIcon name={filled.part} size={34} /><span class="sq">{filled.qty}/{sl.cap}</span></> : <span class="st">{slotLabel(sl.types).replace(/\//g, '/\u200b')}<br /><small>{sl.req ? `requis ${sl.cap}` : `jusqu'à ${sl.cap}`}</small></span>}
        </div>;
      })}
    </div>
  );
}

function hullSilhouette(name: string, color: string): string {
  return hullSvg(name, color);
}

function DesignEditor({ draft, onCancel, onSave }: { draft: ShipDesign; onCancel: () => void; onSave: (d: ShipDesign) => void }) {
  const s = useStore();
  const me = s.me!;
  const [d, setD] = useState<ShipDesign>(draft);
  const [cat, setCat] = useState<string>('all');
  const [pick, setPick] = useState<string | null>(null);
  const hull = HULLS.get(d.hull)!;
  // same category order as the Stars! designer ("All" view)
  const CAT_ORDER = ['Engine', 'Scanner', 'Shield', 'Armor', 'BeamWeapon', 'Torpedo', 'Bomb', 'MineRobot', 'MineLayer', 'Electrical', 'Mechanical', 'Orbital'];
  const catRank = (c: string) => { const i = CAT_ORDER.indexOf(c); return i < 0 ? 99 : i; };
  const deception = !!s.game!.settings.deception;
  const parts = TECH_DATA.filter(t => t.slot && hasTech(me, t) && (t.origin !== 'deception' || deception) && (t.origin !== 'culture' || !!s.game!.settings.culture) && hull.slots.some(sl => partFitsSlot(t, sl.types, hull.name))).map((t, i) => ({ t, i })).sort((a, b) => catRank(a.t.cat) - catRank(b.t.cat) || a.i - b.i).map(x => x.t);
  const cats = [...new Set(parts.map(p => p.cat))];
  const shown = parts.filter(p => cat === 'all' || p.cat === cat);
  const spec = designSpec(me, d);
  const errors = validateDesign(me, d);
  const place = (slot: number, part: string, qty: number | 'fill' | 'add') => {
    const sl = hull.slots[slot - 1];
    const t = TECHS.get(part);
    if (!t || !partFitsSlot(t, sl.types, hull.name)) { s.notify(`${tl(part)} ne convient pas à cet emplacement`); return; }
    const slots = d.slots.filter(x => x.slot !== slot);
    const cur = d.slots.find(x => x.slot === slot);
    let q = qty === 'fill' ? sl.cap : qty === 'add' ? Math.min(sl.cap, (cur && cur.part === part ? cur.qty : 0) + 1) : Math.min(sl.cap, qty);
    if (t.stats?.colonizationModule || t.stats?.orbitalConstructionModule || t.tags.includes('Stargate') || t.tags.includes('MassDriver')) q = Math.min(q, t.tags.includes('MassDriver') ? 2 : 1);
    slots.push({ slot, part, qty: q });
    setD({ ...d, slots });
  };
  /** Moves the stack of a slot onto another: into an empty slot, onto the same part (up to its capacity), or swaps two parts. */
  const move = (from: number, to: number) => {
    const a = d.slots.find(x => x.slot === from);
    if (!a) return;
    const b = d.slots.find(x => x.slot === to);
    const sa = hull.slots[from - 1], sb = hull.slots[to - 1];
    const ta = TECHS.get(a.part)!;
    if (!partFitsSlot(ta, sb.types, hull.name)) { s.notify(`${tl(a.part)} ne convient pas à cet emplacement`); return; }
    const cap = (t: typeof ta, sl: typeof sa) => t.tags.includes('MassDriver') ? Math.min(2, sl.cap) : t.stats?.colonizationModule || t.stats?.orbitalConstructionModule || t.tags.includes('Stargate') ? 1 : sl.cap;
    const rest = d.slots.filter(x => x.slot !== from && x.slot !== to);
    if (!b) {
      const q = Math.min(a.qty, cap(ta, sb));
      setD({ ...d, slots: [...rest, { slot: to, part: a.part, qty: q }, ...(a.qty > q ? [{ slot: from, part: a.part, qty: a.qty - q }] : [])] });
    } else if (b.part === a.part) {
      const q = Math.min(cap(ta, sb), b.qty + a.qty);
      const left = a.qty + b.qty - q;
      setD({ ...d, slots: [...rest, { slot: to, part: a.part, qty: q }, ...(left > 0 ? [{ slot: from, part: a.part, qty: left }] : [])] });
    } else {
      const tb = TECHS.get(b.part)!;
      if (!partFitsSlot(tb, sa.types, hull.name)) { s.notify(`Échange impossible : ${tl(b.part)} ne convient pas à l'emplacement de départ`); return; }
      setD({ ...d, slots: [...rest, { slot: to, part: a.part, qty: Math.min(a.qty, cap(ta, sb)) }, { slot: from, part: b.part, qty: Math.min(b.qty, cap(tb, sa)) }] });
    }
  };
  const removeOne = (slot: number) => {
    const cur = d.slots.find(x => x.slot === slot);
    if (!cur) return;
    setD({ ...d, slots: cur.qty > 1 ? d.slots.map(x => x.slot === slot ? { ...x, qty: x.qty - 1 } : x) : d.slots.filter(x => x.slot !== slot) });
  };
  const pickTech = pick ? TECHS.get(pick) : null;
  return (
    <Modal title={`Concepteur : ${d.name || 'nouveau modèle'}`} sub={`Coque ${tl(d.hull)}`} wide keepFooter onClose={onCancel} footer={<>
      {errors.length > 0 && <span class="red small">{errors[0]}{errors.length > 1 ? ` (+${errors.length - 1})` : ''}</span>}
      <span class="sp" />
      <button onClick={onCancel}>Annuler</button>
      <button class="primary" data-tut="ds-save" disabled={errors.length > 0} onClick={() => onSave(d)}>Enregistrer le modèle</button>
    </>}>
      <div class="editor">
        <div class="palette">
          <select value={cat} onChange={e => setCat((e.target as HTMLSelectElement).value)}><option value="all">Toutes catégories</option>{cats.map(c => <option value={c}>{CATEGORY_NAMES[c] ?? c}</option>)}</select>
          <ul class="parts">
            {shown.map(p => <li class={pick === p.name ? 'sel' : ''} draggable onDragStart={e => { e.dataTransfer?.setData('text/plain', p.name); setPick(p.name); }} onClick={() => setPick(p.name)}>
              <CompIcon name={p.name} size={30} /><div><div><TechTip info={() => techInfo(s.game!, me, p)}>{tl(p.name)}</TechTip></div><div class="muted small">{partBrief(p)}</div></div>
            </li>)}
          </ul>
          {pickTech && <div class="part-detail"><b>{tl(pickTech.name)}</b><div class="small"><Cost c={playerCost(me, pickTech)} /> · {pickTech.mass ?? 0} kt</div><div class="small muted">{partBrief(pickTech, !pickTech.engine)}</div>{pickTech.engine && (() => { const cur = d.slots.map(sl => TECHS.get(sl.part)).find(x => x?.engine); return <EngineChart engine={pickTech} compare={cur && cur.name !== pickTech.name ? cur : undefined} compareLabel="dans ce modèle" width={250} height={150} />; })()}</div>}
        </div>
        <div class="ed-main">
          <div class="ed-name"><label>Nom</label><input value={d.name} maxLength={32} onInput={e => setD({ ...d, name: (e.target as HTMLInputElement).value })} /></div>
          <Schematic hull={hull} slots={d.slots} color={me.color}
            highlight={idx => !!pickTech && partFitsSlot(pickTech, hull.slots[idx - 1].types, hull.name)}
            onDrop={(slot, part, e) => place(slot, part, e.ctrlKey ? 'fill' : e.shiftKey ? 4 : 'add')}
            onMove={(from, to) => move(from, to)}
            onSlotClick={(slot, e) => { if (pick) place(slot, pick, e.ctrlKey ? 'fill' : e.shiftKey ? Math.min(hull.slots[slot - 1].cap, (d.slots.find(x => x.slot === slot)?.qty ?? 0) + 4) : 'add'); }}
            onSlotRight={removeOne} />
          <div class="small muted">Glisser-déposer ou cliquer un composant puis un emplacement (Maj : +4, Ctrl : remplir). Glisser un emplacement rempli vers un autre pour déplacer ses composants (ou les échanger). Clic droit : retirer un composant.</div>
          <StatsPanel spec={spec} />
        </div>
      </div>
    </Modal>
  );
}

export { partBrief };

export function TechBrowserBody({ focus }: { focus?: string } = {}) {
  const s = useStore();
  const g = s.game!, me = s.me!;
  // opened from a report: show the category of that technology and point at its line
  const focusCat = focus ? (HULL_DATA.find(h => h.name === focus) ? (HULL_DATA.find(h => h.name === focus)!.starbase ? 'StarbaseHull' : 'ShipHull') : TECH_DATA.find(t => t.name === focus)?.cat) : undefined;
  const [cat, setCat] = useState(focusCat ?? 'Engine');
  useEffect(() => { if (focus) setTimeout(() => document.querySelector('.techbrowser tr.hl')?.scrollIntoView({ block: 'center' }), 60); }, [focus]);
  const [onlyAvail, setOnlyAvail] = useState(false);
  const cats = [...new Set(TECH_DATA.map(t => t.cat)), 'ShipHull', 'StarbaseHull'];
  const items: (TechData | HullData)[] = cat === 'ShipHull' ? HULL_DATA.filter(h => !h.starbase) : cat === 'StarbaseHull' ? HULL_DATA.filter(h => h.starbase) : TECH_DATA.filter(t => t.cat === cat);
  // the Mystery Trader's technologies stay a surprise until obtained
  // 0.3.9.21: the parts of a rule that is off (decoys, sovereignty beacons) are not offered, so not listed either
  const ruleOff = (t: TechData | HullData) => 'origin' in t && ((t.origin === 'deception' && !g.settings.deception) || (t.origin === 'culture' && !g.settings.culture));
  const visible = items.filter(t => !ruleOff(t) && ((canLearn(me.race, t.req) && !t.req.acquirable) || hasTech(me, t)));
  const unknown = visible.filter(t => knownState(g, me, t) === 'unknown');
  const shown = visible.filter(t => knownState(g, me, t) !== 'unknown' && (!onlyAvail || hasTech(me, t)));
  return <div class="techbrowser">
    <div class="tb-head">
      <select value={cat} onChange={e => setCat((e.target as HTMLSelectElement).value)}>{cats.map(c => <option value={c}>{CATEGORY_NAMES[c] ?? c}</option>)}</select>
      <label class="chk"><input type="checkbox" checked={onlyAvail} onChange={e => setOnlyAvail((e.target as HTMLInputElement).checked)} /> Seulement les technologies disponibles</label>
    </div>
    <table class="tb">
      <thead><tr><th></th><th>Nom</th><th>Disponibilité</th><th>Coût (Fe/Bo/Ge · R)</th><th>Masse</th><th>Caractéristiques</th></tr></thead>
      <tbody>{shown.map(t => {
        const have = hasTech(me, t);
        const isHull = 'slots' in t;
        const f = mainField(t.req);
        const odds = !have && f ? techOdds(g, me, t, me.tech[f] + 5) : null;
        return <tr class={(have ? '' : 'na') + (t.name === focus ? ' hl' : '')}>
          <td>{isHull ? <HullImg hull={t.name} color={me.color} w={40} /> : <CompIcon name={t.name} size={26} />}</td>
          <td><TechTip info={() => techInfo(g, me, t)}>{tl(t.name)}</TechTip>{t.req.acquirable && <span class="tag">extraterrestre</span>}{(t.req.prtsRequired || t.req.lrtsRequired) && <span class="muted small"> ({[...(t.req.prtsRequired ?? []).map(x => (PRT_INFO as any)[x]?.name ?? x), ...(t.req.lrtsRequired ?? []).map(x => (LRT_INFO as any)[x]?.name ?? x)].join(', ')})</span>}</td>
          <td class="small">{have ? <><span class="green">disponible</span>{!isHull && (() => { const n = upgradeTargets(g, me, t.name).length; return n > 0 ? <button class="small primary tb-upg" onClick={() => s.open('upgrade', { part: t.name })}>Mettre à jour {n} modèle{n > 1 ? 's' : ''}</button> : null; })()}</> : t.req.acquirable ? 'auprès du Marchand nomade' : odds && f ? <>{FIELD_NAMES[f]} {odds.min}{odds.max !== odds.min ? `–${odds.max}` : ''}{odds.others.length ? <span class="muted"> + {odds.others.map(o => `${FIELD_NAMES[o.field]} ${o.level}`).join(', ')}</span> : ''}</> : '—'}</td>
          <td class="small"><Cost c={playerCost(me, t)} /></td>
          <td class="small">{(t as any).mass ?? 0} kt</td>
          <td class="small">{isHull ? `blindage ${(t as HullData).armor} · carburant ${(t as HullData).fuel} · soute ${(t as HullData).cargo} · ${(t as HullData).slots.length} emplacements` : (t as TechData).engine ? <div class="tb-eng"><EngineChart engine={t as TechData} compact width={150} height={44} /><span>{partBrief(t as TechData)}</span></div> : partBrief(t as TechData, true)}</td>
        </tr>;
      })}
      {unknown.length > 0 && <tr class="na"><td><span class="qm">?</span></td><td>??????</td><td class="small" colSpan={4}>{unknown.length} technologie{unknown.length > 1 ? 's' : ''} encore hors de portée de vos scientifiques (plus de 5 niveaux d'avance)</td></tr>}
      </tbody>
    </table>
  </div>;
}

export function TechBrowserDialog({ focus }: { focus?: string }) {
  return <Modal title="Navigateur technologique" wide onClose={() => store.close('techBrowser')}><TechBrowserBody focus={focus} key={focus ?? ''} /></Modal>;
}
