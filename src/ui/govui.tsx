// 0.3.9: the interface of the sector governors (Empire page, planet panel) and of the operations (fleet panel).
import { viewFleet, viewSpec } from './memo';
import { useState } from 'preact/hooks';
import { useStore, store, fmt } from './store';
import { Bar, Num } from './components';
import type { Fleet, GameState, Governor, Planet, Player } from '../engine/types';
import { planetSpec } from '../engine/planet';
import { distance, fleetSpec } from '../engine/fleet';
import { capitalOf } from '../engine/empire';
import * as G from '../engine/governors';
import * as O from '../engine/operations';

const PlanetLink = ({ p }: { p: Planet }) => <button class="lnk" onClick={() => store.focus({ kind: 'planet', id: p.id }, p)}>{p.name}</button>;
const stars = (g: Governor) => '★'.repeat(G.levelOf(g));

function GovLine({ g }: { g: Governor }) {
  return <span class="gov-line"><b>{g.name}</b> <span class="gov-trait" title={`Niveau ${G.levelOf(g)} sur 5, ${g.xp} ans de service. Le talent grandit à 8, 20, 35 et 55 ans de service.`}>{G.GOV_TRAITS[g.trait].name} <i>{stars(g)}</i></span> <span class="small muted">{G.traitText(g)}</span></span>;
}

/** Empire page: the sectors, their governors and orders, the candidates. */
export function GovernorsSection({ g, me }: { g: GameState; me: Player }) {
  const s = useStore();
  const seats = G.sectorSeats(g, me);
  const govs = me.governors ?? [];
  const waiting = govs.filter(x => x.seat === undefined);
  const pool = me.govPool ?? [];
  const act = (f: () => string | null | void) => { s.checkpoint(); const err = f(); if (typeof err === 'string') { s.notify(err); s.undo.pop(); } s.bump(); };
  const choices = [...waiting, ...pool];
  const kindOf = (seat: Planet) => seat.id === capitalOf(g, me)?.id ? 'capitale' : seat.regionalCapital ? 'capitale régionale' : 'siège de secteur';
  return <>
    <p class="small muted">Chaque siège gouverne les mondes dont il est le plus proche. La capitale reste entre vos mains ; sur les autres mondes, le gouverneur applique sa consigne aux lignes automatiques de la file, sans toucher à celles que vous ajoutez.</p>
    {!g.settings.distanceCost && <p class="small muted">{`Sans la règle « Coût de la taille », un monde sur ${G.WORLDS_PER_SEAT} peut devenir siège de secteur, depuis sa fiche (encore ${G.seatsLeft(g, me)}).`}</p>}
    <div class="sectors">{seats.map(seat => {
      const gov = govs.find(x => x.seat === seat.id);
      const worlds = G.sectorWorlds(g, me, seat.id);
      const res = worlds.reduce((a, pl) => a + viewSpec(g, pl, me).resources, 0);
      return <div class="sector">
        <div class="sector-head"><PlanetLink p={seat} /> <span class="small muted">{worlds.length > 1 ? `${kindOf(seat)} · ${worlds.length} mondes · ${fmt(res)} R/an` : `${kindOf(seat)} · un monde · ${fmt(res)} R/an`}</span></div>
        {gov ? <>
          <GovLine g={gov} />
          <div class="sector-row">
            <select value={gov.policy} onChange={e => act(() => { gov.policy = (e.target as HTMLSelectElement).value as G.GovPolicy; })}>{G.policiesFor(g).map(p => <option value={p}>{G.GOV_POLICIES[p].name}</option>)}</select>
            <span class="small muted">{G.GOV_POLICIES[gov.policy].text}</span>
            <span class="sp" />
            <button class="small ghost" onClick={() => act(() => G.dismiss(me, gov.id))} title="Le gouverneur quitte ses fonctions pour de bon">Démettre</button>
          </div>
        </> : <div class="sector-row"><span class="small yellow">Aucun gouverneur.</span>
          {choices.length > 0 && <select value="" onChange={e => { const id = +(e.target as HTMLSelectElement).value; if (id) act(() => G.appoint(g, me, id, seat.id)); }}>
            <option value="">Nommer…</option>
            {choices.map(c => <option value={c.id}>{govs.includes(c) ? `${c.name}, ${G.GOV_TRAITS[c.trait].name} ${stars(c)} (sans affectation)` : `${c.name}, ${G.GOV_TRAITS[c.trait].name} ${stars(c)}`}</option>)}
          </select>}
        </div>}
      </div>;
    })}</div>
    {waiting.length > 0 && <><h4>Sans affectation</h4><ul class="gov-list">{waiting.map(w => <li><GovLine g={w} /> <button class="small ghost" onClick={() => act(() => G.dismiss(me, w.id))}>Congédier</button></li>)}</ul></>}
    <h4>Candidats</h4>
    {pool.length ? <ul class="gov-list">{pool.map(c => <li><GovLine g={c} /></li>)}</ul> : <p class="small muted">Aucun candidat cette année.</p>}
    <p class="small muted">{`Nouveaux candidats en ${(me.govPoolYear ?? g.year) + G.POOL_YEARS} ; une place laissée libre par une nomination se comble l'année suivante.`}</p>
  </>;
}

/** Planet panel: the sector, its governor, and whether the governor runs this world. */
export function SectorBlock({ g, me, p }: { g: GameState; me: Player; p: Planet }) {
  const s = useStore();
  if (!G.governorsOn(g) || p.owner !== me.id) return null;
  const seat = p.sector !== undefined ? g.planets[p.sector] : undefined;
  const gov = G.governorOf(g, p);
  const cap = capitalOf(g, me)?.id === p.id;
  const blocker = G.seatBlocker(g, me, p);
  const act = (f: () => void) => { s.checkpoint(); f(); G.computeSectors(g, me); s.bump(); };
  return <section class="blk rows sector-blk">
    <div class="blk-head"><h3>Secteur</h3></div>
    <div class="small">{seat ? (seat.id === p.id ? 'Siège du secteur.' : <>Secteur de <PlanetLink p={seat} />.</>) : 'Hors de tout secteur.'}</div>
    {seat && <div class="small">{gov ? `Gouverneur : ${gov.name}, ${G.GOV_TRAITS[gov.trait].name} ${stars(gov)}.` : 'Sans gouverneur.'}</div>}
    {gov && <div class="small muted">{G.traitText(gov)}.</div>}
    {gov && !cap && gov.policy !== 'manual' && (p.manual
      ? <div class="sector-row"><span class="small">Vous gardez la main sur ce monde.</span><button class="small" onClick={() => act(() => { p.manual = false; })}>Le confier au gouverneur</button></div>
      : <div class="sector-row"><span class="small">{`Le gouverneur gère sa file (consigne : ${G.GOV_POLICIES[gov.policy].name}).`}</span><button class="small" onClick={() => act(() => { p.manual = true; })}>Garder la main</button></div>)}
    {cap && gov && <div class="small muted">La capitale reste entre vos mains.</div>}
    {!g.settings.distanceCost && (p.sectorSeat
      ? <div class="btns"><button class="small ghost" onClick={() => act(() => { p.sectorSeat = false; })}>Ce monde n'est plus un siège</button></div>
      : !cap && <div class="btns"><button class="small" disabled={!!blocker} title={blocker ?? ''} onClick={() => act(() => { p.sectorSeat = true; })}>En faire un siège de secteur</button></div>)}
  </section>;
}

/** Fleet panel: the operation this fleet leads or reinforces, or the form to start one. */
export function OperationBlock({ g, me, f }: { g: GameState; me: Player; f: Fleet }) {
  const s = useStore();
  const [edit, setEdit] = useState(false);
  if (f.owner !== me.id) return null;
  const ops = g.fleets.filter(x => x.owner === me.id && x.op && x !== f);
  if (f.joinOp !== undefined) {
    const op = g.fleets.find(x => x.id === f.joinOp);
    return <section class="blk op-blk"><div class="blk-head"><h3>Opération</h3></div>
      <div class="sector-row"><span class="small">En renfort de {op ? <button class="lnk" onClick={() => s.select({ kind: 'fleet', id: op.id })}>{op.name}</button> : '?'}.</span>
        <button class="small ghost" onClick={() => { s.checkpoint(); f.joinOp = undefined; f.waypoints = [f.waypoints[0]]; s.bump(); }}>Détacher</button></div>
    </section>;
  }
  const armed = viewFleet(g, f).hasWeapons;
  if (!f.op && !armed) return null;
  if (f.op && !edit) {
    const op = f.op, st = O.opStatus(g, f), t = g.planets[op.planetId], d = g.designs.find(x => x.id === op.designId);
    return <section class="blk op-blk"><div class="blk-head"><h3>{op.kind === 'defend' ? <>Opération : défendre <PlanetLink p={t} /></> : <>Opération : prendre <PlanetLink p={t} /></>}</h3></div>
      <Bar value={st.ships} max={op.target} color="#4fd6e3" label={`${st.ships} vaisseaux sur ${op.target}`} segments={[{ value: st.enRoute, color: '#4fd6e388' }]} />
      <div class="small muted">{st.enRoute || st.queued ? `${st.enRoute} en route, ${st.queued} en chantier${st.yards.length ? ` (${st.yards.map(y => y.name).join(', ')})` : ''}.` : st.missing ? 'Aucun chantier ne peut construire les renforts pour l\'instant.' : 'La flotte est au complet.'} {d ? `Renforts : ${d.name}.` : ''}</div>
      {op.kind === 'attack' && op.launch && <div class="small">{op.launched !== undefined ? `Partie pour ${t.name} en ${op.launched}.` : 'Elle partira quand elle sera au complet.'}</div>}
      <div class="btns"><button class="small" onClick={() => setEdit(true)}>Modifier…</button><button class="small ghost" onClick={() => { s.checkpoint(); O.endOperation(g, f); s.bump(); }}>Terminer l'opération</button></div>
    </section>;
  }
  return <OperationForm g={g} me={me} f={f} ops={ops} onDone={() => setEdit(false)} editing={!!f.op} />;
}

function OperationForm({ g, me, f, ops, onDone, editing }: { g: GameState; me: Player; f: Fleet; ops: Fleet[]; onDone: () => void; editing: boolean }) {
  const s = useStore();
  const [open, setOpen] = useState(editing);
  const designs = O.opDesigns(g, me);
  const main = [...f.tokens].sort((a, b) => b.qty - a.qty)[0]?.designId;
  const [kind, setKind] = useState<'defend' | 'attack'>(f.op?.kind ?? 'defend');
  const [designId, setDesign] = useState<number>(f.op?.designId ?? (designs.some(d => d.id === main) ? main : designs[0]?.id ?? -1));
  const [target, setTarget] = useState<number>(f.op?.target ?? O.shipsIn(f) + 4);
  const [launch, setLaunch] = useState<boolean>(f.op?.launch ?? true);
  const [sectorOnly, setSectorOnly] = useState<boolean>(f.op?.sectorOnly ?? false);
  const mine = g.planets.filter(p => p.owner === me.id).sort((a, b) => distance(a, f) - distance(b, f));
  const foes = g.planets.filter(p => { const o = me.intel.planets[p.id]?.owner; return o !== undefined && o >= 0 && o !== me.id; }).sort((a, b) => distance(a, f) - distance(b, f)).slice(0, 40);
  const list = kind === 'defend' ? mine : foes;
  const [planetId, setPlanet] = useState<number>(f.op?.planetId ?? list[0]?.id ?? -1);
  const pid = list.some(p => p.id === planetId) ? planetId : list[0]?.id ?? -1;
  if (!open) return <section class="blk op-blk"><div class="btns">
    <button class="small" onClick={() => setOpen(true)} title="Défendre un de vos mondes ou en prendre un, avec une flotte que les chantiers les plus proches tiennent au nombre de vaisseaux voulu">Lancer une opération…</button>
    {ops.length > 0 && <select value="" onChange={e => { const id = +(e.target as HTMLSelectElement).value; const op = g.fleets.find(x => x.id === id); if (!op) return; s.checkpoint(); const err = O.joinOperation(g, f, op); if (err) s.notify(err); s.bump(); }}>
      <option value="">Renforcer une opération…</option>
      {ops.map(o => <option value={o.id}>{o.op!.kind === 'defend' ? `${o.name} (défense de ${g.planets[o.op!.planetId].name})` : `${o.name} (attaque de ${g.planets[o.op!.planetId].name})`}</option>)}
    </select>}
  </div></section>;
  const ok = pid >= 0 && designId >= 0;
  const apply = () => {
    s.checkpoint();
    const err = O.setOperation(g, f, { kind, planetId: pid, designId, target, launch: kind === 'attack' ? launch : undefined, sectorOnly: kind === 'defend' && G.governorsOn(g) ? sectorOnly : undefined });
    if (err) { s.notify(err); s.undo.pop(); } else { onDone(); setOpen(false); }
    s.bump();
  };
  return <section class="blk op-blk"><div class="blk-head"><h3>{editing ? 'Modifier l\'opération' : 'Nouvelle opération'}</h3></div>
    <div class="op-form">
      <label>Mission <select value={kind} onChange={e => setKind((e.target as HTMLSelectElement).value as 'defend' | 'attack')}><option value="defend">Défendre un de vos mondes</option><option value="attack">Prendre un monde</option></select></label>
      <label>Cible <select value={pid} onChange={e => setPlanet(+(e.target as HTMLSelectElement).value)}>{list.map(p => <option value={p.id}>{p.name} ({fmt(distance(p, f))} al)</option>)}</select></label>
      <label>Renforts <select value={designId} onChange={e => setDesign(+(e.target as HTMLSelectElement).value)}>{designs.map(d => <option value={d.id}>{d.name}</option>)}</select></label>
      <label>Vaisseaux voulus <Num value={target} min={1} max={200} onChange={setTarget} /></label>
      {kind === 'attack' && <label class="chk"><input type="checkbox" checked={launch} onChange={e => setLaunch((e.target as HTMLInputElement).checked)} /> Partir seulement quand la flotte est au complet</label>}
      {kind === 'defend' && G.governorsOn(g) && <label class="chk"><input type="checkbox" checked={sectorOnly} onChange={e => setSectorOnly((e.target as HTMLInputElement).checked)} /> Renforts construits dans le secteur de ce monde seulement</label>}
      {!designs.length && <div class="small yellow">Aucun de vos chantiers ne peut construire un modèle armé.</div>}
      {kind === 'attack' && !foes.length && <div class="small muted">Vous ne connaissez aucun monde étranger habité.</div>}
    </div>
    <div class="btns"><button class="small primary" disabled={!ok} onClick={apply}>Valider</button><button class="small ghost" onClick={() => { onDone(); setOpen(false); }}>Annuler</button></div>
  </section>;
}
