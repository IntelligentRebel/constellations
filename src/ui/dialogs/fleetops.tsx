// Cargo transfer, split and merge dialogs.
import { viewFleet } from '../memo';
import { useState } from 'preact/hooks';
import { store, useStore, fmt, fmtPop, MINERAL_COLORS, MINERAL_LABELS } from '../store';
import { Modal, Bar, HullImg } from '../components';
import type { Fleet, Planet, TransportKey } from '../../engine/types';
import { TRANSPORT_KEYS } from '../../engine/types';
import { fleetSpec, cargoMass } from '../../engine/fleet';
import { hasOrders } from '../../engine/tasks';
import * as A from '../actions';

export function CargoDialog({ fleetId, planetId, otherId }: { fleetId: number; planetId?: number; otherId?: number }) {
  const s = useStore();
  const g = s.game!, me = s.me!;
  const f = g.fleets.find(x => x.id === fleetId);
  if (!f) return <Modal title="Cargaison" onClose={() => s.close('cargo')}>Flotte introuvable.</Modal>;
  const planet: Planet | undefined = planetId !== undefined ? g.planets[planetId] : undefined;
  const other: Fleet | undefined = otherId !== undefined ? g.fleets.find(x => x.id === otherId) : undefined;
  const spec = viewFleet(g, f);
  const ospec = other ? viewFleet(g, other) : null;
  const salvage = !planet && !other ? g.salvage.find(x => Math.abs(x.x - f.x) < 1 && Math.abs(x.y - f.y) < 1) : undefined;
  const amt = (e: MouseEvent) => (e.shiftKey && e.ctrlKey ? 1000 : e.ctrlKey ? 100 : e.shiftKey ? 10 : 1);
  const have = (k: TransportKey) => k === 'fuel' ? f.fuel : f.cargo[k];
  const otherHave = (k: TransportKey): number | null => {
    if (planet) { if (k === 'fuel') return null; if (planet.owner !== me.id && planet.owner >= 0) return null; return k === 'colonists' ? Math.trunc(planet.pop / 100) : planet.surface[k]; }
    if (other) return k === 'fuel' ? other.fuel : other.cargo[k];
    if (salvage && k !== 'fuel' && k !== 'colonists') return salvage.cargo[k];
    return null;
  };
  const move = (k: TransportKey, n: number) => {
    // n > 0: load into the fleet
    if (planet) A.transferPlanet(f, planet.id, k, n);
    else if (other) { if (n > 0) A.transferFleets(other, f, k, n, f.owner); else A.transferFleets(f, other, k, -n, f.owner); }
    else if (salvage && k !== 'fuel' && k !== 'colonists') {
      s.checkpoint();
      if (n > 0) { const space = spec.cargoCapacity - cargoMass(f.cargo); const a = Math.min(n, salvage.cargo[k], space); salvage.cargo[k] -= a; f.cargo[k] += a; }
      s.bump();
    }
  };
  const jettison = () => {
    s.ask('Larguer toute la cargaison dans l\'espace ? Les minerais formeront une épave et les colons seront perdus.', () => doJettison(), 'Larguer');
  };
  const doJettison = () => {
    s.checkpoint();
    g.salvage.push({ id: g.nextId++, owner: me.id, x: f.x, y: f.y, cargo: { ironium: f.cargo.ironium, boranium: f.cargo.boranium, germanium: f.cargo.germanium }, age: 0 });
    f.cargo = { ironium: 0, boranium: 0, germanium: 0, colonists: 0 };
    s.bump();
  };
  const otherName = planet ? planet.name : other ? other.name : salvage ? 'Épave' : 'Espace';
  return (
    <Modal title={`Transfert : ${f.name} ⇄ ${otherName}`} onClose={() => s.close('cargo')} width={720} footer={<>
      {!planet && !other && <button class="danger" onClick={jettison}>Larguer la cargaison</button>}
      <span class="small muted">Clic : 1 · Maj : 10 · Ctrl : 100 · Maj+Ctrl : 1000</span><span class="sp" /><button class="primary" onClick={() => s.close('cargo')}>OK</button></>}>
      <table class="cargo-x">
        <thead><tr><th></th><th>{f.name}</th><th></th><th>{otherName}</th></tr></thead>
        <tbody>
          {TRANSPORT_KEYS.map(k => {
            const oh = otherHave(k);
            const cap = k === 'fuel' ? spec.fuelCapacity : spec.cargoCapacity;
            if (k !== 'fuel' && spec.cargoCapacity === 0 && (!ospec || ospec.cargoCapacity === 0)) return null;
            return <tr>
              <td style={{ color: (MINERAL_COLORS as any)[k] }}>{(MINERAL_LABELS as any)[k]}</td>
              <td class="cx-bar"><Bar value={have(k)} max={cap || 1} color={(MINERAL_COLORS as any)[k]} label={k === 'colonists' ? fmtPop(have(k) * 100) : `${fmt(have(k))} ${k === 'fuel' ? 'mg' : 'kt'}`} /></td>
              <td class="cx-btn">
                <button title="Tout prendre" onClick={() => move(k, 1e9)} disabled={oh === null}>«</button>
                <button title="Prendre" onClick={e => move(k, amt(e as unknown as MouseEvent))} disabled={oh === null}>‹</button>
                <button title="Donner" onClick={e => move(k, -amt(e as unknown as MouseEvent))} disabled={have(k) <= 0 || (!planet && !other) || (k === 'fuel' && !!planet)}>›</button>
                <button title="Tout donner" onClick={() => move(k, -have(k))} disabled={have(k) <= 0 || (!planet && !other) || (k === 'fuel' && !!planet)}>»</button>
              </td>
              <td>{oh === null ? <span class="muted">—</span> : k === 'colonists' ? fmtPop(oh * 100) : `${fmt(oh)} ${k === 'fuel' ? 'mg' : 'kt'}`}</td>
            </tr>;
          })}
        </tbody>
      </table>
      <div class="small muted">Soute : {fmt(cargoMass(f.cargo))} / {fmt(spec.cargoCapacity)} kt{ospec ? ` · autre flotte : ${fmt(cargoMass(other!.cargo))} / ${fmt(ospec.cargoCapacity)} kt` : ''}.
        {planet && planet.owner >= 0 && planet.owner !== me.id ? ' Décharger des colons sur une planète étrangère les fait débarquer pour l\'envahir : le combat au sol a lieu pendant le tour, avec tous les débarquements de l\'année sur ce monde, et vous en saurez l\'issue au prochain rapport.' : ''}
        {planet && planet.owner < 0 ? ' Pour fonder une colonie, utilisez la tâche « Coloniser ».' : ''}</div>
    </Modal>
  );
}

export function SplitDialog({ fleetId }: { fleetId: number }) {
  const s = useStore();
  const g = s.game!, me = s.me!;
  const f = g.fleets.find(x => x.id === fleetId);
  const [qty, setQty] = useState<Record<number, number>>({});
  if (!f) return null;
  const ships = f.tokens.reduce((a, t) => a + t.qty, 0);
  return (
    <Modal title={`Séparer ${f.name}`} onClose={() => s.close('split')} width={560} footer={<>
      <button onClick={() => { A.splitSingles(f); s.close('split'); }} disabled={ships < 2} title="Chaque vaisseau devient une flotte. La flotte d'origine garde un vaisseau et ses ordres.">Un vaisseau par flotte ({ships})</button>
      <span class="sp" /><button onClick={() => s.close('split')}>Annuler</button>
      <button class="primary" onClick={() => { const parts = Object.entries(qty).map(([d, q]) => ({ designId: +d, qty: q })).filter(p => p.qty > 0); const nf = A.split(f, parts); if (nf) { s.close('split'); s.select({ kind: 'fleet', id: nf.id }); } }}>Séparer</button>
    </>}>
      <p class="small muted">Choisissez combien de vaisseaux de chaque modèle forment la nouvelle flotte (à droite).</p>
      <table class="split">
        <tbody>{f.tokens.map(t => {
          const d = g.designs.find(x => x.id === t.designId)!;
          const q = qty[t.designId] ?? 0;
          return <tr><td><HullImg hull={d.hull} color={me.color} w={40} /></td><td>{d.name}</td><td class="num">{t.qty - q}</td>
            <td><button onClick={() => setQty({ ...qty, [t.designId]: Math.max(0, q - 1) })}>◂</button><button onClick={() => setQty({ ...qty, [t.designId]: Math.min(t.qty, q + 1) })}>▸</button><button onClick={() => setQty({ ...qty, [t.designId]: Math.floor(t.qty / 2) })}>½</button></td>
            <td class="num b">{q}</td></tr>;
        })}</tbody>
      </table>
    </Modal>
  );
}

export function MergeDialog({ fleetId }: { fleetId: number }) {
  const s = useStore();
  const g = s.game!, me = s.me!;
  const f = g.fleets.find(x => x.id === fleetId);
  const [sel, setSel] = useState<Record<number, boolean>>({}); // (0.3.9.21: before the early return, hooks keep their order)
  if (!f) return null;
  // a sovereignty beacon is a fort, not a ship: it merges with nothing
  const others = g.fleets.filter(x => x !== f && x.owner === me.id && x.x === f.x && x.y === f.y && x.beaconOf === undefined);
  return (
    <Modal title={`Fusionner avec ${f.name}`} onClose={() => s.close('merge')} width={520} footer={<>
      <span class="sp" /><button onClick={() => s.close('merge')}>Annuler</button>
      <button class="primary" onClick={() => { for (const o of others.filter(o => sel[o.id])) A.merge(f, o); s.close('merge'); }}>Fusionner</button>
    </>}>
      <p class="small muted">{hasOrders(f) ? `${f.name} garde ses ordres en cours ; ceux des flottes absorbées sont abandonnés.` : `${f.name} n'a pas d'ordre : elle reprendra ceux de la première flotte cochée (dans l'ordre de la liste) qui en a.`}</p>
      <ul class="list">{others.map(o => <li onClick={() => setSel({ ...sel, [o.id]: !sel[o.id] })} class={sel[o.id] ? 'sel' : ''}><input type="checkbox" checked={!!sel[o.id]} /> {o.name} <span class="muted small">({o.tokens.reduce((a, t) => a + t.qty, 0)} vaisseaux{hasOrders(o) ? ' · ordres en cours' : ''})</span></li>)}</ul>
      <button class="link" onClick={() => setSel(Object.fromEntries(others.map(o => [o.id, true])))}>Tout sélectionner</button>
    </Modal>
  );
}

export { store };
