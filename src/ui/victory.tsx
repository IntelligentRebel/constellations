// 0.3.9: the race to victory. For every way of winning, who is closest, as far as the player knows (the figures of the
// other empires come through intelligence: "?" unknown, "≈" estimated), and when, at the present pace.
import type { ComponentChildren } from 'preact';
import { useStore, fmt, store } from './store';
import { Modal } from './components';
import type { FactKey, GameState, Player } from '../engine/types';
import { FIELDS } from '../engine/types';
import { VICTORY_LABELS, countBits } from '../engine/score';
import { intelOn } from '../engine/espionage';
import { known, scoresOpen } from './intel';
import { portalThreat, megaProgress, MEGAPROJECTS, relaysOn, relaysOf, RELAYS_NEEDED } from '../engine/megaprojects';
import { actOf } from '../engine/acts';
import { breachPlanet } from '../engine/crisis';
import { secretOn, CLUES_NEEDED } from '../engine/ancients';
import { originWinsOn, ORIGIN_WINS, ORIGIN_WIN_FROM } from '../engine/originwins';

interface Line { p: Player; v: number | null; node: ComponentChildren; progress: number | null; met: boolean; eta?: string }

/** Years left at the pace of the last ten years (own figures, or everyone's when scores are public). */
function pace(g: GameState, p: Player, get: (e: Player['scores'][number]) => number, target: number): string | undefined {
  const h = p.scores;
  if (h.length < 4) return undefined;
  const now = h[h.length - 1], then = h[Math.max(0, h.length - 11)];
  const dy = now.year - then.year;
  if (dy < 3) return undefined;
  const slope = (get(now) - get(then)) / dy;
  const left = target - get(now);
  if (left <= 0) return undefined;
  if (slope <= 0) return 'au point mort';
  const years = Math.ceil(left / slope);
  return years > 200 ? 'hors de portée à ce rythme' : `≈ ${g.year + years}`;
}

export function VictoryRace() {
  const s = useStore();
  const g = s.game!, me = s.me!;
  const v = g.settings.victory;
  const open = scoresOpen(g);
  const intel = !open && intelOn(g);
  const rivals = g.players.filter(p => !p.monster && !p.dead && (p.id === me.id || open || me.intel.met.includes(p.id)));
  const exact = (p: Player) => p.id === me.id || open;
  const sc = (p: Player) => p.scores[p.scores.length - 1];
  const fact = (p: Player, k: FactKey) => p.id === me.id || open || intel ? known(g, me, p.id, k, sc(p)) : { v: null, node: <span class="muted">?</span> };
  const total = g.planets.length;
  const from = 2400 + v.minYears;
  const blocks: { title: string; note?: string; lines: Line[] }[] = [];
  const simple = (title: string, k: FactKey, target: number, get: (e: Player['scores'][number]) => number) => {
    blocks.push({ title, lines: rivals.map(p => { const f = fact(p, k); return { p, v: f.v, node: f.node, progress: f.v === null ? null : f.v / target, met: f.v !== null && f.v >= target, eta: exact(p) ? pace(g, p, get, target) : undefined }; }) });
  };
  if (v.ownPlanets !== null) { const need = Math.ceil(total * v.ownPlanets / 100); simple(`${VICTORY_LABELS[0].replace('{ownPlanets}', String(v.ownPlanets))} (${need} sur ${total})`, 'planets', need, e => e.planets); }
  if (v.attainTech) {
    const { level: L, fields: F } = v.attainTech;
    blocks.push({ title: VICTORY_LABELS[1].replace('{level}', String(L)).replace('{fields}', String(F)), lines: rivals.map(p => {
      const t = p.id === me.id ? p.tech : me.intel.dossiers?.[p.id]?.techs?.v;
      if (!t) return { p, v: null, node: <span class="muted" title="Leurs niveaux par domaine demandent un meilleur renseignement">?</span>, progress: null, met: false };
      const lv = FIELDS.map(f => t[f]).sort((a, b) => b - a);
      const done = lv.filter(x => x >= L).length;
      const stale = p.id !== me.id && (me.intel.dossiers?.[p.id]?.techs?.year ?? g.year) < g.year;
      return { p, v: done, node: <span class={stale ? 'stale' : ''}>{done} / {F} <span class="muted small">({lv.slice(0, F).join(', ')})</span></span>, progress: lv.slice(0, F).reduce((a, x) => a + Math.min(x, L), 0) / (L * F), met: done >= F };
    }) });
  }
  if (v.exceedScore !== null) simple(VICTORY_LABELS[2].replace('{exceedScore}', fmt(v.exceedScore)), 'score', v.exceedScore + 1, e => e.score);
  if (v.exceedSecond !== null) {
    const scores = rivals.map(p => ({ p, f: fact(p, 'score') }));
    blocks.push({ title: VICTORY_LABELS[3].replace('{exceedSecond}', String(v.exceedSecond)), note: 'Rapport au meilleur des autres scores connus.', lines: scores.map(({ p, f }) => {
      const others = scores.filter(x => x.p !== p && x.f.v !== null).map(x => x.f.v!);
      if (f.v === null || !others.length) return { p, v: null, node: f.node, progress: null, met: false };
      const ratio = f.v / Math.max(1, ...others);
      return { p, v: ratio, node: <>{f.node} <span class="muted small">(×{fmt(ratio, 2)})</span></>, progress: ratio / (1 + v.exceedSecond! / 100), met: ratio >= 1 + v.exceedSecond! / 100 };
    }) });
  }
  if (v.production !== null) simple(VICTORY_LABELS[4].replace('{production}', fmt(v.production)), 'resources', v.production * 1000, e => e.resources);
  if (v.capitalShips !== null) simple(VICTORY_LABELS[5].replace('{capitalShips}', fmt(v.capitalShips)), 'capital', v.capitalShips, e => e.capital);
  if (v.highestAfter !== null) {
    const after = 2400 + v.highestAfter;
    const scores = rivals.map(p => ({ p, f: fact(p, 'score') })).filter(x => x.f.v !== null);
    const lead = Math.max(0, ...scores.map(x => x.f.v!));
    blocks.push({ title: VICTORY_LABELS[6].replace('{highestAfter}', String(v.highestAfter)), note: g.year < after ? `Compte à partir de ${after}.` : undefined, lines: rivals.map(p => { const f = fact(p, 'score'); return { p, v: f.v, node: f.node, progress: f.v === null || !lead ? null : f.v / lead, met: g.year >= after && f.v !== null && scores.every(x => x.p === p || x.f.v! < f.v!) }; }) }); // (0.3.9.21: strictly first, as the engine counts it)
  }
  const portal = g.settings.megaprojects ? portalThreat(g) : null;
  const myPortal = g.planets.flatMap(pl => pl.owner === me.id ? pl.queue.filter(q => q.kind === 'mega' && q.megaId === 'portal').map(q => ({ pl, q })) : [])[0];
  const breach = g.settings.crisis ? g.crisis : undefined;
  const bp = breachPlanet(g);
  const alive = g.players.filter(p => !p.monster && !p.dead).length;
  const mySeal = g.planets.flatMap(pl => pl.owner === me.id ? pl.queue.filter(q => q.kind === 'mega' && q.megaId === 'seal').map(q => ({ pl, q })) : [])[0];
  const ow = originWinsOn(g) && me.origin ? ORIGIN_WINS[me.origin] : undefined;
  const owp = ow?.progress(g, me);
  const metCount = (p: Player) => p.id === me.id ? countBits(me.victoryMet) : open ? countBits(p.victoryMet) : me.intel.dossiers?.[p.id]?.victory ? countBits(me.intel.dossiers[p.id].victory!.v) : null;
  return <div class="vrace">
    <p class="small">{v.numCriteria > 1
      ? (g.year < from ? <>Il faut remplir <b>{v.numCriteria}</b> conditions, comptées à partir de <b>{from}</b>.</> : <>Il faut remplir <b>{v.numCriteria}</b> conditions pour gagner.</>)
      : (g.year < from ? <>Il faut remplir une condition, comptée à partir de <b>{from}</b>.</> : 'Il faut remplir une condition pour gagner.')}
      {' '}{'Les barres montrent l\'avance vers chacune, et l\'année l\'arrivée au rythme des dix dernières années.'}
      {!open && <>{' '}{intel ? 'Les chiffres des autres empires viennent de votre renseignement.' : 'Sans scores publics ni renseignement, ceux des autres empires restent inconnus.'}</>}</p>
    <table class="report vtable"><thead><tr><th>Empire</th><th class="num">Conditions remplies</th></tr></thead>
      <tbody>{rivals.map(p => { const n = metCount(p); return <tr class={p.id === me.id ? 'me' : ''}><td><span style={{ color: p.color }}>{p.name}</span></td><td class="num">{n === null ? <span class="muted">?</span> : <b class={n >= v.numCriteria ? 'red' : ''}>{n} / {v.numCriteria}</b>}</td></tr>; })}</tbody></table>
    {blocks.map(b => <div class="vblock">
      <h4>{b.title}</h4>{b.note && <div class="small muted">{b.note}</div>}
      {[...b.lines].sort((x, y) => (y.progress ?? -1) - (x.progress ?? -1)).map(l => <div class={'vline' + (l.p.id === me.id ? ' me' : '')}>
        <span class="vname" style={{ color: l.p.color }}>{l.p.name}</span>
        <span class="vbar"><i style={{ width: `${Math.round(Math.min(1, l.progress ?? 0) * 100)}%`, background: l.p.color, opacity: l.progress === null ? 0 : 1 }} /></span>
        <span class="vval">{l.node}</span>
        <span class="vEta small muted">{l.met ? <b class="green">condition remplie</b> : l.eta ?? ''}</span>
      </div>)}
    </div>)}
    {g.settings.megaprojects && <div class="vblock"><h4>{MEGAPROJECTS.find(m => m.id === 'portal')?.name ?? 'Portail de l\'Ascension'}</h4>
      <div class="small">L'empire qui l'achève gagne la partie, quelles que soient les conditions ci-dessus.</div>
      {relaysOn(g) && <div class="small">{actOf(g) < 3 ? 'Il ne peut être bâti qu\'au troisième acte, après trois relais de l\'Ascension sur trois mondes ; toute la galaxie sait où ils sont.' : 'Il faut d\'abord trois relais de l\'Ascension, sur trois mondes ; toute la galaxie sait où ils sont.'} {g.players.filter(p => !p.monster && !p.dead && relaysOf(g, p.id).length > 0).map(p => <span class="chip small" style={{ borderColor: p.color }}>{p.name} : {relaysOf(g, p.id).length} / {RELAYS_NEEDED}</span>)}</div>}
      {myPortal && <div class="vline me"><span class="vname" style={{ color: me.color }}>{me.name}</span><span class="vbar"><i style={{ width: `${Math.round(megaProgress(myPortal.q) * 100)}%`, background: me.color }} /></span><span class="vval"><button class="lnk" onClick={() => s.focus({ kind: 'planet', id: myPortal.pl.id }, myPortal.pl)}>{myPortal.pl.name}</button></span><span class="vEta small muted" /></div>}
      {portal && portal.owner !== me.id ? <div class="vline"><span class="vname" style={{ color: g.players[portal.owner].color }}>{g.players[portal.owner].name}</span><span class="vbar"><i style={{ width: `${portal.announced}%`, background: g.players[portal.owner].color }} /></span><span class="vval">au moins {portal.announced} %</span><span class="vEta small muted"><button class="lnk" onClick={() => s.focus({ kind: 'planet', id: portal.planet.id }, portal.planet)}>{portal.planet.name}</button></span></div>
        : !myPortal && <div class="small muted">Aucun empire ne le construit, à votre connaissance.</div>}
    </div>}
    {breach && <div class="vblock"><h4>La Brèche</h4><div class="small">{
      breach.phase === 'dormant' ? 'Aucun signe pour l\'instant. Quand elle s\'ouvrira, l\'empire qui abattra son gardien, le Nexus, gagnera la partie.'
        : breach.phase === 'omen' ? (bp ? <>Elle s'ouvrira en <b>{breach.openYear}</b> près de <button class="lnk" onClick={() => s.focus({ kind: 'planet', id: bp.id }, bp)}>{bp.name}</button>. L'empire qui abattra le Nexus gagnera la partie.</>
            : <>Elle s'ouvrira en <b>{breach.openYear}</b>. L'empire qui abattra le Nexus gagnera la partie.</>)
          : breach.phase === 'active' ? (bp ? <>Ouverte à <button class="lnk" onClick={() => s.focus({ kind: 'planet', id: bp.id }, bp)}>{bp.name}</button> depuis {breach.openYear} : abattre le Nexus fait gagner la partie.</>
            : <>Ouverte depuis {breach.openYear} : abattre le Nexus fait gagner la partie.</>)
            : breach.endedBy !== undefined && g.players[breach.endedBy] ? `Refermée en ${breach.endedYear} par les ${g.players[breach.endedBy].name}.` : `Refermée en ${breach.endedYear}.`
    }</div></div>}
    {secretOn(g) && <div class="vblock"><h4>Le Sceau des Anciens</h4>
      <div class="small">{g.crisis?.sealed ? 'La Brèche est scellée.' : me.secretKnown !== undefined ? 'Vous avez percé le secret de la Brèche : le Sceau des Anciens, une fois achevé, la referme et donne la victoire (page Empire).' : `Six indices percent le secret de la Brèche et donnent le moyen de la sceller, ce qui fait gagner la partie. Vous en avez ${me.clues ?? 0} sur ${CLUES_NEEDED}.`}</div>
      {mySeal && <div class="vline me"><span class="vname" style={{ color: me.color }}>{me.name}</span><span class="vbar"><i style={{ width: `${Math.round(megaProgress(mySeal.q) * 100)}%`, background: me.color }} /></span><span class="vval"><button class="lnk" onClick={() => s.focus({ kind: 'planet', id: mySeal.pl.id }, mySeal.pl)}>{mySeal.pl.name}</button></span><span class="vEta small muted" /></div>}
    </div>}
    {ow && <div class="vblock"><h4>{`Votre victoire d'origine : ${ow.name}`}</h4>
      <div class="small">{ow.text(g)} {g.year < ORIGIN_WIN_FROM ? `Elle compte à partir de ${ORIGIN_WIN_FROM}.` : ''}</div>
      <div class="vline me"><span class="vname" style={{ color: me.color }}>{me.name}</span><span class="vbar"><i style={{ width: `${Math.round(Math.min(1, owp!.share) * 100)}%`, background: me.color }} /></span><span class="vval small">{owp!.text}</span><span class="vEta small muted" /></div>
      <div class="small muted">Les autres empires ont chacun la leur, selon leur origine.</div>
    </div>}
    <div class="vblock"><h4>Dernier empire debout</h4><div class="small">{alive === 1 ? 'Un seul empire encore en vie.' : `${alive} empires encore en vie.`}</div></div>
  </div>;
}

export function VictoryDialog() {
  const s = useStore();
  return <Modal title="Course à la victoire" wide onClose={() => s.close('victory')}><VictoryRace /></Modal>;
}

export const openVictory = () => store.open('victory');
