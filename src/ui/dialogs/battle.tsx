// Battle VCR: replays recorded battles on the 10x10 board.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { useStore, fmt } from '../store';
import { Modal, Row } from '../components';
import { hullDataUrl } from '../art';
import { tl } from '../../data/labels';
import type { BattleAction, BattleRecord, BattleTokenRecord, GameState, Player } from '../../engine/types';
import { specOf, designSpec } from '../../engine/design';

/** Stars! shows a token's initiative including its best weapon's own initiative */
function weaponInitiative(g: GameState, designId: number): number {
  if (!g.designs.some(d => d.id === designId)) return 0;
  const w = specOf(g, designId).weapons;
  return w.length ? Math.max(...w.map(x => x.initiative)) : 0;
}

interface TokState { x: number; y: number; qty: number; shields: number; damage: number; qtyDamaged: number; gone: boolean }

function stateAt(rec: BattleRecord, step: number) {
  const st = new Map<number, TokState>();
  for (const t of rec.tokens) st.set(t.id, { x: t.x, y: t.y, qty: t.qty, shields: t.shields * t.qty, damage: t.damage, qtyDamaged: t.qtyDamaged, gone: false });
  let round = 0;
  let last: BattleAction | null = null;
  // 0.3.9.21: at the last phase, the bookkeeping that follows it too (the final losses and shields were never shown)
  let end = step;
  if (step >= 0) {
    let k = rec.actions.length - 1;
    while (k >= 0 && rec.actions[k].t === 'state') k--;
    if (step >= k) end = rec.actions.length - 1;
  }
  for (let i = 0; i <= end && i < rec.actions.length; i++) {
    const a = rec.actions[i];
    if (a.t !== 'state' || i <= step) last = a;
    if (a.t === 'round') round = a.round;
    else if (a.t === 'move') { const s = st.get(a.id)!; s.x = a.x; s.y = a.y; }
    else if (a.t === 'leave') { st.get(a.id)!.gone = true; }
    else if (a.t === 'state') { const s = st.get(a.id)!; s.qty = a.qty; s.shields = a.shields; s.damage = a.damage; s.qtyDamaged = a.qtyDamaged ?? (a.damage ? a.qty : 0); if (a.qty <= 0) s.gone = true; }
    else if (a.t === 'fire') { const s = st.get(a.target)!; s.qty = Math.max(0, s.qty - a.killed); s.shields = Math.max(0, s.shields - a.shieldDmg); if (s.qty <= 0) s.gone = true; }
  }
  return { st, round, last };
}

/** 3.6: the ship picked on the board: its design (name opens it in Conception), equipment, firepower and defence. */
function ShipCard({ g, me, tok, st, onClose }: { g: GameState; me: Player; tok: BattleTokenRecord; st: { qty: number; shields: number; damage: number; qtyDamaged: number }; onClose: () => void }) {
  const s = useStore();
  const d = g.designs.find(x => x.id === tok.designId);
  const known = tok.owner === me.id || !!me.intel.designs[tok.designId]?.slots;
  const sp = d ? designSpec(g.players[tok.owner], d) : null;
  // grouped by component (a design often carries the same weapon in several slots)
  const weapons: NonNullable<typeof sp>['weapons'] = [];
  for (const w of sp?.weapons ?? []) { const x = weapons.find(y => y.part === w.part); if (x) x.qty += w.qty; else weapons.push({ ...w }); }
  const perShip = weapons.reduce((a, w) => a + w.power * w.qty * (w.torpedo ? w.accuracy + (1 - w.accuracy) * sp!.torpedoBonus : 1) /* 0.3.9.21: beam power already has the capacitors */, 0);
  const parts = new Map<string, number>();
  for (const x of d?.slots ?? []) parts.set(x.part, (parts.get(x.part) ?? 0) + x.qty);
  const open = () => { s.close('battle'); s.goTab('design', { designId: tok.designId }); };
  return <div class="vcr-sel">
    <h4 style={{ color: g.players[tok.owner].color }}><button class="lnk" style={{ color: 'inherit' }} title="Voir ce modèle dans Conception" onClick={open}>{tok.designName}</button> <button class="small ghost" onClick={onClose} aria-label="Fermer">✕</button></h4>
    <Row k="Empire" v={g.players[tok.owner].name} />
    <Row k="Coque" v={tl(tok.hull)} />
    <Row k="Nombre" v={`${st.qty} / ${tok.qty}`} />
    <Row k="Blindage" v={`${fmt(tok.armor)} dp par vaisseau${!st.damage || !st.qtyDamaged ? '' : st.qtyDamaged < st.qty ? ` (${fmt(st.qtyDamaged)} endommagés, ${fmt(st.damage)} de dégâts chacun)` : ` (${fmt(st.damage)} de dégâts chacun)`}`} />
    <Row k="Boucliers" v={`${fmt(tok.shields)} par vaisseau · pile ${fmt(st.shields)}`} />
    <Row k="Initiative / mouvement" v={`${tok.initiative + weaponInitiative(g, tok.designId)} / ${tok.starbase ? '–' : (tok.movement / 4).toFixed(2).replace('.', ',')}`} />
    {known && sp ? <>
      <h5>Puissance de feu</h5>
      {weapons.length ? <ul class="vcr-weap small">{weapons.map(w => <li>{w.qty} × {tl(w.part)} : {w.power} de dégâts par arme{w.torpedo ? `, précision ${Math.round(w.accuracy * 100)} %` : ''}, portée {w.range}{w.capital ? ', dégâts doublés contre une cible sans bouclier' : ''}{w.sapper ? ', boucliers seulement' : ''}</li>)}</ul> : <p class="small muted">Aucune arme.</p>}
      {weapons.length > 0 && <Row k="Dégâts par round (attendus)" v={`≈ ${fmt(perShip)} par vaisseau, ≈ ${fmt(perShip * st.qty)} pour la pile`} />}
      <Row k="Puissance" v={fmt(sp.powerRating)} />
      <h5>Défense</h5>
      <Row k="Points de structure" v={`${fmt(tok.armor + tok.shields)} par vaisseau (blindage + boucliers), ${fmt((tok.armor + tok.shields) * st.qty)} pour la pile`} />
      {(sp.torpedoJamming > 0 || sp.beamDefense < 1 || sp.cloakPercent > 0) && <Row k="Protections" v={[sp.torpedoJamming > 0 ? `brouillage ${Math.round(sp.torpedoJamming * 100)} %` : '', sp.beamDefense < 1 ? `déflecteur ${Math.round((1 - sp.beamDefense) * 100)} %` : '', sp.cloakPercent > 0 ? `camouflage ${sp.cloakPercent} %` : ''].filter(Boolean).join(' · ')} />}
      <h5>Équipement</h5>
      <ul class="vcr-weap small">{[...parts].map(([part, qty]) => <li>{qty} × {tl(part)}</li>)}</ul>
    </> : <p class="small muted">Équipement inconnu.</p>}
  </div>;
}

export function BattleDialog({ battleId }: { battleId: number }) {
  const s = useStore();
  const g = s.game!, me = s.me!;
  const mine = g.battles.filter(b => b.players.includes(me.id));
  const [bid, setBid] = useState(battleId);
  const rec = g.battles.find(b => b.id === bid) ?? mine[0];
  const [step, setStep] = useState(-1);
  const [play, setPlay] = useState(false);
  const [speed, setSpeed] = useState(2);
  const [sel, setSel] = useState<number | null>(null);
  useEffect(() => { setStep(-1); setPlay(false); }, [bid]);
  // meaningful phases: everything except the end-of-round bookkeeping
  const phases = useMemo(() => rec ? rec.actions.map((a, i) => ({ a, i })).filter(x => x.a.t !== 'state').map(x => x.i) : [], [rec]);
  const lastPhase = phases.length ? phases[phases.length - 1] : -1;
  const nextPhase = (from: number) => phases.find(i => i > from) ?? lastPhase;
  useEffect(() => {
    if (!play || !rec) return;
    if (step >= lastPhase) { setPlay(false); return; }
    const t = setTimeout(() => setStep(x => nextPhase(x)), [600, 350, 180, 70][speed]);
    return () => clearTimeout(t);
  }, [play, step, speed]);
  const view = useMemo(() => rec ? stateAt(rec, step) : null, [rec, step]);
  if (!rec || !view) return <Modal title="Batailles" onClose={() => s.close('battle')}>Aucune bataille cette année.</Modal>;
  const tokById = new Map<number, BattleTokenRecord>(rec.tokens.map(t => [t.id, t]));
  const where = rec.planetId !== undefined ? g.planets[rec.planetId].name : `l'espace (${Math.round(rec.x)}, ${Math.round(rec.y)})`;
  const C = 46;
  const last = view.last;
  const selTok = sel !== null ? tokById.get(sel) : undefined;
  const selState = sel !== null ? view.st.get(sel) : undefined;
  const describe = (a: BattleAction | null): string => {
    if (!a) return 'Début de la bataille. Lecture : ▶';
    const n = (id: number) => { const t = tokById.get(id)!; return `${t.designName} (${g.players[t.owner].name})`; };
    switch (a.t) {
      case 'round': return `Round ${a.round}`;
      case 'move': return `${n(a.id)} se déplace en (${a.x}, ${a.y}).`;
      case 'leave': return `${n(a.id)} quitte le combat.`;
      case 'state': return `Fin du round : ${n(a.id)} · ${a.qty} vaisseau(x), boucliers ${fmt(a.shields)}.`;
      case 'fire': return `${n(a.id)} tire (${tl(a.weapon)}${a.torpedo ? `, ${a.hits} touché(s) / ${a.misses} manqué(s)` : ''}) sur ${n(a.target)} : ${fmt(a.shieldDmg)} aux boucliers, ${fmt(a.armorDmg)} au blindage${a.killed ? `, ${a.killed} détruit(s)` : ''}.`;
    }
  };
  const next = () => setStep(nextPhase(step));
  const prev = () => { const before = phases.filter(i => i < step); setStep(before.length ? before[before.length - 1] : -1); };
  const phaseNo = phases.filter(i => i <= step).length;
  return (
    <Modal title={`Bataille à ${where} · ${g.year}`} wide onClose={() => s.close('battle')}>
      <div class="vcr">
        <div class="vcr-board" style={{ width: C * 10 + 'px', height: C * 10 + 'px' }}>
          {Array.from({ length: 100 }, (_, i) => <div class="cell" style={{ left: (i % 10) * C + 'px', top: Math.floor(i / 10) * C + 'px', width: C + 'px', height: C + 'px' }} />)}
          {rec.tokens.map(t => {
            const ts = view.st.get(t.id)!;
            const dying = ts.gone && last?.t === 'fire' && last.target === t.id && last.killed > 0;
            if (ts.gone && !dying) return null;
            const stack = rec.tokens.filter(o => { const os = view.st.get(o.id)!; return !os.gone && os.x === ts.x && os.y === ts.y; });
            const k = stack.indexOf(t);
            const color = g.players[t.owner].color;
            return <div class={'vtok' + (sel === t.id ? ' sel' : '') + (dying ? ' dying' : '')} style={{ left: ts.x * C + 3 + k * 4 + 'px', top: ts.y * C + 3 + k * 4 + 'px', width: C - 6 + 'px', height: C - 6 + 'px', borderColor: color }} onClick={() => setSel(t.id)} title={`${t.designName} ×${ts.qty}`}>
              <img src={hullDataUrl(t.hull, color)} />
              <span class="vq" style={{ color }}>{ts.qty}</span>
            </div>;
          })}
          {last && last.t === 'fire' && (() => {
            const a = view.st.get(last.id)!, b = view.st.get(last.target)!;
            const src = tokById.get(last.id)!;
            const x1 = (last.fromX + 0.5) * C, y1 = (last.fromY + 0.5) * C, x2 = (b.x + 0.5) * C, y2 = (b.y + 0.5) * C;
            void a;
            return <svg class="vshot" width={C * 10} height={C * 10}><line x1={x1} y1={y1} x2={x2} y2={y2} stroke={last.torpedo ? '#ff7ac8' : '#ff4040'} stroke-width={last.torpedo ? 2 : 3} stroke-dasharray={last.torpedo ? '6 4' : ''} /><circle cx={x2} cy={y2} r={last.killed ? 14 : 8} fill={last.killed ? '#ffb040' : '#ffffff'} opacity=".55" />{void src}</svg>;
          })()}
        </div>
        <div class="vcr-side">
          {mine.length > 1 && <select value={rec.id} onChange={e => setBid(+(e.target as HTMLSelectElement).value)}>{mine.map(b => <option value={b.id}>{b.planetId !== undefined ? g.planets[b.planetId].name : `(${Math.round(b.x)}, ${Math.round(b.y)})`}</option>)}</select>}
          <div class="vcr-status">Round {view.round} / {rec.rounds} · phase {phaseNo} / {phases.length}</div>
          <div class="vcr-ctrl">
            <button onClick={() => { setPlay(false); setStep(-1); }}>⏮</button>
            <button onClick={() => { setPlay(false); prev(); }}>◀</button>
            <button class="primary" onClick={() => setPlay(!play)}>{play ? '⏸' : '▶'}</button>
            <button onClick={() => { setPlay(false); next(); }}>▶</button>
            <button onClick={() => { setPlay(false); setStep(lastPhase); }}>⏭</button>
            <select value={speed} onChange={e => setSpeed(+(e.target as HTMLSelectElement).value)}><option value={0}>Lent</option><option value={1}>Normal</option><option value={2}>Rapide</option><option value={3}>Très rapide</option></select>
          </div>
          <div class="vcr-log">{describe(last)}</div>
          {selTok && selState && <ShipCard g={g} me={me} tok={selTok} st={selState} onClose={() => setSel(null)} />}
          <h4>Pertes</h4>
          {rec.players.map(p => <Row k={<span style={{ color: g.players[p].color }}>{g.players[p].name}</span>} v={`${rec.losses[p] ?? 0} vaisseau(x)`} />)}
        </div>
      </div>
    </Modal>
  );
}
