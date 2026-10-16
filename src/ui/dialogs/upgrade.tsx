// Putting a newly found component in your designs (3.2.5): every design it improves, all ticked by default.
import { useState } from 'preact/hooks';
import { store, useStore, fmt } from '../store';
import { Modal, HullImg } from '../components';
import { upgradeTargets, nextDesignName } from '../../engine/upgrade';
import { tl } from '../../data/labels';
import * as A from '../actions';

export function UpgradeDialog({ part }: { part: string }) {
  const s = useStore();
  const g = s.game!, me = s.me!;
  const plans = upgradeTargets(g, me, part);
  const [off, setOff] = useState<Record<number, boolean>>({});
  const close = () => s.close('upgrade');
  const chosen = plans.filter(p => !off[p.design.id]);
  const ships = (id: number) => g.fleets.filter(f => f.owner === me.id).reduce((a, f) => a + f.tokens.filter(t => t.designId === id).reduce((b, t) => b + t.qty, 0), 0)
    + g.planets.filter(p => p.owner === me.id && p.starbase?.designId === id).length;
  const queued = (id: number) => g.planets.filter(p => p.owner === me.id).reduce((a, p) => a + p.queue.filter(q => (q.kind === 'ship' || q.kind === 'starbase') && q.designId === id).reduce((b, q) => b + q.qty, 0), 0);
  const all = chosen.length === plans.length;
  return <Modal title={`Mettre à jour avec ${tl(part)}`} width={880} onClose={close} footer={<>
    <button class="link" onClick={() => setOff(all ? Object.fromEntries(plans.map(p => [p.design.id, true])) : {})}>{all ? 'Tout décocher' : 'Tout cocher'}</button>
    <span class="sp" /><button onClick={close}>Annuler</button>
    <button class="primary" disabled={!chosen.length} onClick={() => { close(); A.upgradeWith(part, chosen.map(p => p.design.id)); }}>Mettre à jour {chosen.length} modèle{chosen.length > 1 ? 's' : ''}</button>
  </>}>
    {plans.length === 0 ? <p class="muted">Aucun de vos modèles en production ne serait amélioré par cette technologie.</p> : <>
      <p class="small muted">Chaque modèle coché devient une nouvelle version. L'ancien est retiré de la production ; les vaisseaux déjà construits restent en service (obsolètes, modernisables) et les constructions en cours passent au nouveau modèle.</p>
      <div class="report-scroll"><table class="report upg-list">
        <thead><tr><th></th><th>Modèle</th><th>Nouvelle version</th><th>Remplace</th><th class="num" title="vaisseaux et stations de ce modèle en service">En service</th><th class="num" title="unités dans les files de production">En file</th></tr></thead>
        <tbody>{plans.map(p => {
          const on = !off[p.design.id];
          const flip = () => setOff({ ...off, [p.design.id]: on });
          return <tr class={'go' + (on ? '' : ' off')} onClick={flip}>
            <td><input type="checkbox" checked={on} onClick={e => e.stopPropagation()} onChange={flip} aria-label={`Mettre à jour ${p.design.name}`} /></td>
            <td><span class="hz-name"><HullImg hull={p.design.hull} color={me.color} w={30} /><span>{p.design.name}{p.design.starbase ? <span class="tag dim">station</span> : ''}</span></span></td>
            <td>{on ? nextDesignName(g, me, p.design.name) : <span class="muted">inchangé</span>}</td>
            <td class="small">{p.replaced.map(x => tl(x)).join(', ')} → {tl(part)}</td>
            <td class="num">{fmt(ships(p.design.id))}</td>
            <td class="num">{queued(p.design.id) || <span class="muted">0</span>}</td>
          </tr>;
        })}</tbody>
      </table></div>
    </>}
  </Modal>;
}

export { store };
