// A design seen from the map (Constellations 3.3.5): a station clicked in the planet panel, yours or a known enemy's.
// Schematic, armament (one line per weapon), equipment and the usual figures.
import { useStore, fmt } from '../store';
import { Modal, CompIcon } from '../components';
import { designSpec, type DesignSpec } from '../../engine/design';

import { TECHS, HULLS } from '../../engine/tech';
import { tl } from '../../data/labels';
import { TechTip, techInfo } from '../techinfo';
import { partBrief } from '../techtext';
import { Schematic, StatsPanel } from './designer';
import type { DesignSlot } from '../../engine/types';
import { raceSpec } from '../../engine/race';

export function DesignViewDialog({ designId, planetId }: { designId: number; planetId?: number }) {
  const s = useStore();
  const g = s.game!, me = s.me!;
  const close = () => s.close('designView');
  const own = g.designs.find(d => d.id === designId && d.owner === me.id);
  const known = own ? undefined : me.intel.designs[designId];
  const d = own ?? known;
  if (!d) return <Modal title="Modèle inconnu" onClose={close}><p class="muted">Vos scientifiques n'ont aucune information sur ce modèle.</p></Modal>;
  const owner = g.players[d.owner];
  const slots: DesignSlot[] | undefined = own ? own.slots : known?.slots;
  const spec = slots ? designSpec(owner, { hull: d.hull, slots, starbase: d.starbase }) : null;
  const hull = HULLS.get(d.hull)!;
  const pl = planetId !== undefined ? g.planets[planetId] : undefined;
  const damage = pl && pl.owner === me.id && pl.starbase?.designId === d.id ? pl.starbase.damage : 0;
  const sub = <>Coque : {tl(d.hull)}{pl ? <> · en orbite de {pl.name}</> : ''}{own?.deleted ? ' · modèle retiré' : ''}{owner.id !== me.id ? <> · <span style={{ color: owner.color }}>{owner.name}</span></> : ''}</>;
  return <Modal title={d.name} wide onClose={close} footer={<>
    {own && !own.deleted && <button onClick={() => { close(); s.goTab('design', { designId: own.id }); }}>Ouvrir dans Conception</button>}
    {pl && pl.owner === me.id && d.starbase && <button onClick={() => { close(); s.open('production', { planetId: pl.id }); }}>Construire une autre station…</button>}
    <button class="primary" onClick={close}>Fermer</button>
  </>}>
    <div class="dview">
      <p class="muted dv-sub">{sub}</p>
      <Schematic hull={hull} slots={slots ?? []} color={owner.color} />
      {!spec ? <p class="muted small">Équipement inconnu : il sera révélé lors d'une bataille contre ce modèle, ou par un scanner pénétrant.</p> : <>
        {damage > 0 && <p class="alert">Endommagée : {fmt(damage)} dp de dégâts sur {fmt(spec.armor)} dp de blindage. Elle se répare d'elle-même chaque année.</p>}
        <h4>Armement</h4>
        <Armament spec={spec} />
        <h4>Équipement</h4>
        <Equipment slots={slots!} />
        <h4>Caractéristiques</h4>
        <StatsPanel spec={spec} habitat={raceSpec(owner.race).livesOnStarbases} />
      </>}
    </div>
  </Modal>;
}

/** One line per weapon type: number, damage, range, initiative (the order of fire), and what is special about it. */
function Armament({ spec }: { spec: DesignSpec }) {
  const s = useStore();
  const g = s.game!, me = s.me!;
  if (!spec.weapons.length) return <p class="muted small">Aucune arme : {spec.starbase ? 'la station ne peut que résister aux attaques (blindage et boucliers).' : 'le vaisseau ne combat pas.'}</p>;
  const groups = new Map<string, { w: DesignSpec['weapons'][number]; qty: number }>();
  for (const w of spec.weapons) { const k = `${w.part}|${w.range}|${w.initiative}`; const x = groups.get(k); if (x) x.qty += w.qty; else groups.set(k, { w, qty: w.qty }); }
  const rows = [...groups.values()].sort((a, b) => b.w.power * b.qty - a.w.power * a.qty);
  const volley = rows.reduce((a, r) => a + r.w.power * r.qty, 0);
  return <>
    <div class="report-scroll"><table class="report dv-arms">
      <thead><tr><th>Arme</th><th class="num">Nombre</th><th class="num" title="Dégâts de chaque tir, bonus de condensateurs compris">Dégâts</th><th class="num" title="En cases du plateau de combat (portée de la coque comprise)">Portée</th><th class="num" title="Initiative de la coque et de ses ordinateurs + celle de l'arme : plus elle est haute, plus l'arme tire tôt">Initiative</th><th class="num">Précision</th><th>Particularités</th></tr></thead>
      <tbody>{rows.map(({ w, qty }) => {
        const t = TECHS.get(w.part);
        const notes = [w.sapper && 'boucliers seulement', (w.gatling || w.hitsAll) && 'touche toute la case', w.capital && 'dégâts ×2 sur cible sans bouclier'].filter(Boolean).join(' · ');
        return <tr>
          <td><span class="hz-name"><CompIcon name={w.part} size={22} />{t ? <TechTip info={() => techInfo(g, me, t)}>{tl(w.part)}</TechTip> : tl(w.part)}</span></td>
          <td class="num">{qty}</td>
          <td class="num">{fmt(w.power)}</td>
          <td class="num">{w.range}</td>
          <td class="num">{spec.initiative + w.initiative}</td>
          <td class="num">{w.torpedo ? `${Math.round(w.accuracy * 100)} %${spec.torpedoBonus > 0 ? ` +${Math.round(spec.torpedoBonus * 100)} %` : ''}` : '—'}</td>
          <td class="small">{notes || <span class="muted">—</span>}</td>
        </tr>;
      })}</tbody>
    </table></div>
    <p class="small muted">Salve complète : {fmt(volley)} points de dégâts par round si tout touche · puissance {fmt(spec.powerRating)}.</p>
  </>;
}

/** Every component, grouped, with its short description and its tooltip. */
function Equipment({ slots }: { slots: DesignSlot[] }) {
  const s = useStore();
  const g = s.game!, me = s.me!;
  const qty = new Map<string, number>();
  for (const sl of slots) if (sl.qty > 0) qty.set(sl.part, (qty.get(sl.part) ?? 0) + sl.qty);
  if (!qty.size) return <p class="muted small">Coque nue, sans aucun composant.</p>;
  return <ul class="dv-parts">{[...qty.entries()].map(([name, n]) => {
    const t = TECHS.get(name);
    return <li><CompIcon name={name} size={24} /><span class="dv-pn">{t ? <TechTip info={() => techInfo(g, me, t)}>{tl(name)}</TechTip> : tl(name)} <span class="muted">× {n}</span></span><span class="muted small">{t ? partBrief(t) : ''}</span></li>;
  })}</ul>;
}

