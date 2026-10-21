// Constellations 3.4: the Diplomacy page with negotiated diplomacy (statuses, treaties, opinions, proposals).
import { useState } from 'preact/hooks';
import { store, useStore, fmt } from './store';
import { Modal } from './components';
import type { GameState, Player, ProposalKind } from '../engine/types';
import { PRT_INFO } from '../engine/race';
import * as DIP from '../engine/diplomacy';
import { KnownColonies } from './dialogs/misc';
import { intelOn, perception, EMBASSY, BORDERS } from '../engine/espionage';
import { DossierBlock, IntelLevel } from './intel';
import { isNemesis, nemesisOn, NEMESIS_AT } from '../engine/nemesis';
import * as BD from '../engine/borders';

const pctTxt = (v: number) => `${Math.round(v * 100)} %`;

/** What the player can give: the minerals on the surface of its richest world. */
function reserve(g: GameState, me: Player): number {
  let best = 0;
  for (const pl of g.planets) if (pl.owner === me.id) best = Math.max(best, pl.surface.ironium + pl.surface.boranium + pl.surface.germanium);
  return best;
}

function act(fn: () => void, note?: string) {
  store.checkpoint();
  fn();
  store.bump();
  if (note) store.notify(note);
}

function Opinion({ v }: { v: number }) {
  return <b class={v >= 30 ? 'green' : v >= 0 ? 'yellow' : 'red'}>{v > 0 ? '+' : ''}{v}</b>;
}

function Predict({ g, me, other, kind, minerals, payer }: { g: GameState; me: Player; other: Player; kind: ProposalKind; minerals?: number; payer?: number }) {
  if (!other.ai) return <span class="small muted">proposition envoyée, réponse à son prochain tour</span>;
  const a = DIP.evaluate(g, other.id, me.id, kind, minerals ?? 0, payer);
  // 0.3.7: odds, never a certainty (except a firm rule)
  const c = a.sure ? 0 : a.chance ?? (a.ok ? 1 : 0);
  return <span class={'small ' + (c >= 0.65 ? 'green' : c >= 0.35 ? 'yellow' : 'red')} title={a.sure ? 'Une règle, pas une humeur : la réponse est certaine.' : 'Une estimation : leur réponse garde une part d\'incertitude. Redemander la même chose dans l\'année ne change rien, sauf une meilleure offre.'}>{a.why}</span>;
}

function Actions({ g, me, o }: { g: GameState; me: Player; o: Player }) {
  const [warAsk, setWarAsk] = useState(false);
  const [offer, setOffer] = useState(0);
  const [tribute, setTribute] = useState(0);
  const st = DIP.statusOf(g, me.id, o.id)!;
  const pr = DIP.pairOf(g, me.id, o.id)!;
  // 0.3.9.21: an empire without a world receives nothing: no offer, no gift (they were counted and never paid)
  const theyHaveWorld = g.planets.some(pl => pl.owner === o.id);
  const have = theyHaveWorld ? reserve(g, me) : 0;
  const offerNow = offer <= have ? offer : 0; // (a gift since may have left less than the offer chosen)
  const send = (kind: ProposalKind, minerals = 0, payer?: number) => act(() => {
    const ans = DIP.propose(g, me.id, o.id, kind, minerals, payer);
    if (ans && kind === 'tribute') store.notify(ans.ok ? `Les ${o.name} vous paient le tribut (détail dans le rapport).` : `Les ${o.name} refusent de vous payer le tribut.`);
    else if (ans) store.notify(ans.ok ? `Les ${o.name} acceptent ${DIP.OFFER_NAMES[kind]}.` : `Les ${o.name} refusent ${DIP.OFFER_NAMES[kind]}.`);
    else store.notify(`Proposition envoyée aux ${o.name}.`);
  });
  const blocked = (kind: ProposalKind) => DIP.proposalBlocker(g, me.id, o.id, kind);
  const treaty = pr.trade !== undefined || pr.research !== undefined || st === 'alliance';
  return <div class="diplo-acts">
    {st === 'war' && <div class="diplo-act">
      <button class="primary" disabled={!!blocked('peace')} onClick={() => send('peace', offerNow, offerNow ? me.id : undefined)}>Proposer la paix</button>
      <select value={offerNow} onChange={e => setOffer(+(e.target as HTMLSelectElement).value)}>{[0, 200, 500, 1000, 2000].filter(v => v <= have).map(v => <option value={v}>{v ? `en offrant ${v} kt de minerais` : 'sans contrepartie'}</option>)}</select>
      {blocked('peace') ? <span class="small muted">{blocked('peace')}</span> : <Predict g={g} me={me} other={o} kind="peace" minerals={offerNow} payer={offerNow ? me.id : undefined} />}
    </div>}
    {st !== 'war' && intelOn(g) && <div class="diplo-act">
      {pr.embassy !== undefined ? <button onClick={() => act(() => DIP.cancel(g, me.id, o.id, 'embassy'), 'Ambassades fermées.')}>Fermer</button> : <button disabled={!!blocked('embassy')} onClick={() => send('embassy')}>Proposer</button>}
      <span>Ambassades (renseignement +{EMBASSY} des deux côtés : vous en saurez plus sur eux, eux sur vous){pr.embassy !== undefined ? <span class="tag">ouvertes</span> : ''}</span>
      {pr.embassy === undefined && (blocked('embassy') ? <span class="small muted">{blocked('embassy')}</span> : <Predict g={g} me={me} other={o} kind="embassy" />)}
    </div>}
    {st !== 'war' && (['trade', 'research', 'alliance'] as const).map(k => {
      const signed = k === 'alliance' ? st === 'alliance' : pr[k] !== undefined;
      const label = k === 'trade' ? `Accord commercial (+${pctTxt(DIP.TRADE_BONUS)} de ressources chacun)` : k === 'research' ? `Coopération scientifique (+${pctTxt(DIP.RESEARCH_BONUS)} de recherche chacun)` : 'Alliance (défense mutuelle, ravitaillement, portes, vision des flottes)';
      return <div class="diplo-act">
        {signed ? <button onClick={() => act(() => DIP.cancel(g, me.id, o.id, k), 'Accord rompu.')}>Rompre</button> : <button disabled={!!blocked(k)} onClick={() => send(k)}>Proposer</button>}
        <span>{label}{signed ? <span class="tag">signé</span> : ''}</span>
        {!signed && (blocked(k) ? <span class="small muted">{blocked(k)}</span> : <Predict g={g} me={me} other={o} kind={k} />)}
      </div>;
    })}
    {/* 0.3.9.10: closed borders, both ways */}
    {BD.bordersOn(g) && st !== 'war' && <div class="diplo-act">
      {st === 'alliance' ? <span class="small muted">Entre alliés, les frontières restent ouvertes dans les deux sens.</span>
        : BD.hasClosed(g, me.id, o.id)
          ? <><button onClick={() => act(() => BD.setBorders(g, me.id, o.id, false), `Frontières rouvertes aux ${o.name}.`)}>Rouvrir vos frontières</button>
            <span class="diplo-long">Vos frontières leur sont <b class="yellow">fermées</b> : leurs vaisseaux ne peuvent pas entrer dans votre territoire sans vous déclarer la guerre.</span></>
          : <><button onClick={() => act(() => BD.setBorders(g, me.id, o.id, true), `Frontières fermées aux ${o.name}.`)}>Fermer vos frontières</button>
            <span class="diplo-long">Vos frontières leur sont ouvertes. Fermées, leurs vaisseaux ne pourront plus entrer dans votre territoire sans vous déclarer la guerre ; ceux qui s'y trouvent pourront en sortir.{(o.ai ? ' Ils vous en voudront, d\'autant plus que votre territoire leur barre la route.' : '') + (intelOn(g) ? ` Vous en saurez aussi moins les uns sur les autres (renseignement -${BORDERS} de part et d'autre).` : '')}</span></>}
    </div>}
    {BD.bordersOn(g) && st === 'peace' && BD.closedTo(g, o.id, me.id) && <div class="diplo-act">
      <button disabled={!!blocked('borders')} onClick={() => send('borders')}>Demander l'ouverture</button>
      <span class="diplo-long">Leurs frontières vous sont <b class="red">fermées</b> : entrer dans leur territoire leur déclarerait la guerre.{(me.hindered?.[o.id] ?? 0) > 0 ? ` Elles barrent la route vers ${pctTxt(me.hindered![o.id])} des mondes à votre portée.` : ''} Leur demander de les rouvrir :</span>
      {blocked('borders') ? <span class="small muted">{blocked('borders')}</span> : <Predict g={g} me={me} other={o} kind="borders" />}
    </div>}
    <div class="diplo-act">
      <span class="small">Offrir des minerais :</span>
      {[200, 500, 1000].map(v => <button class="small" disabled={v > have} onClick={() => { let moved = 0; act(() => { moved = DIP.gift(g, me.id, o.id, v); }); store.notify(moved > 0 ? `${moved} kt offerts aux ${o.name}.` : `Les ${o.name} n'ont aucun monde où recevoir des minerais.`); }}>{v} kt</button>)}
      <span class="small muted">{theyHaveWorld ? `pris sur votre monde le plus riche (${fmt(reserve(g, me))} kt) ; l'opinion monte d'un point par 25 kt (jusqu'à +30), puis s'estompe` : 'ils n\'ont aucun monde où les recevoir'}</span>
    </div>
    <div class="diplo-act">
      {/* 0.3.7: a tribute humiliates them, whatever they answer; one every three years */}
      {!tribute ? <><button class="small" disabled={!!blocked('tribute')} onClick={() => setTribute(200)}>Exiger un tribut…</button>{blocked('tribute') && <span class="small muted">{blocked('tribute')}</span>}</>
        : <><span class="small">Exiger</span>
          <select value={tribute} onChange={e => setTribute(+(e.target as HTMLSelectElement).value)}>{[200, 500, 1000, 2000].map(v => <option value={v}>{v} kt de minerais</option>)}</select>
          <button class="small danger" onClick={() => { send('tribute', tribute, o.id); setTribute(0); }}>Exiger</button><button class="small" onClick={() => setTribute(0)}>Annuler</button>
          <Predict g={g} me={me} other={o} kind="tribute" minerals={tribute} payer={o.id} />
          <div class="small red diplo-warn">Un tribut est une humiliation : leur opinion de vous baissera nettement, qu'ils paient ou non. On ne peut en exiger qu'un tous les {DIP.TRIBUTE_YEARS} ans.</div></>}
    </div>
    {st !== 'war' && <div class="diplo-act">
      {!warAsk ? <button class="danger" onClick={() => setWarAsk(true)}>Déclarer la guerre…</button>
        : <><button class="danger" onClick={() => { act(() => DIP.declareWar(g, me.id, o.id), `Vous êtes en guerre contre les ${o.name}.`); setWarAsk(false); }}>Confirmer la guerre</button><button onClick={() => setWarAsk(false)}>Annuler</button>
          <span class="small red">{treaty ? 'Vous rompez vos accords : une trahison que tous les empires qui vous connaissent retiendront.' : 'Les vaisseaux des deux empires s\'attaqueront partout où ils se croisent.'}{st === 'alliance' ? '' : ''}</span></>}
    </div>}
  </div>;
}

/** 0.3.9.19: an empire dominates the galaxy (as far as you know the scores): the others draw together against it. */
function HegemonNote() {
  const s = useStore();
  const g = s.game!, me = s.me!;
  const hg = DIP.hegemon(g, me.id);
  if (!hg || hg.t < 0.1) return null;
  // 0.3.9.21: only when some computer that knows the leader does feel it (easy ones never rally against a player), and
  // the leader must be known to you
  const L0 = g.players[hg.id];
  if (hg.id !== me.id && !me.intel.met.includes(hg.id)) return null;
  if (!g.players.some(a => a.ai && !a.dead && !a.monster && a.id !== hg.id && a.intel.met.includes(hg.id) && DIP.coalitionMind(a, L0) && DIP.runaway(g, hg.id, a.id) > 0)) return null;
  const strong = hg.t >= 0.5;
  if (hg.id === me.id) return <div class="alert small">{strong ? 'Votre avance écrase la galaxie : les autres empires se rapprochent les uns des autres pour vous tenir tête, et ceux qui vous détestaient déjà ne manqueront pas une occasion.' : 'Votre avance commence à inquiéter la galaxie : les autres empires se rapprochent les uns des autres contre vous.'}</div>;
  const L = g.players[hg.id];
  return <div class="alert info small">{strong ? (DIP.statusOf(g, me.id, hg.id) === 'alliance' ? `Les ${L.name} écrasent la galaxie : les autres empires se rapprochent les uns des autres contre eux, d'autant plus que leur avance grandit, et proposent des alliances.` : `Les ${L.name} écrasent la galaxie : les autres empires se rapprochent les uns des autres contre eux, d'autant plus que leur avance grandit, et proposent des alliances, à vous aussi.`) : `L'avance des ${L.name} commence à inquiéter la galaxie : les autres empires se rapprochent les uns des autres contre eux.`}</div>;
}

export function DiplomacyDialog() {
  const s = useStore();
  const g = s.game!, me = s.me!;
  const focus: number | undefined = s.tab === 'diplomacy' ? s.tabData?.playerId : undefined;
  const [open, setOpen] = useState<Record<number, boolean>>(focus !== undefined ? { [focus]: true } : {});
  const met = me.intel.met.map(id => g.players[id]).filter(p => p && !p.monster);
  const incoming = g.diplomacy!.proposals.filter(x => x.to === me.id);
  const outgoing = g.diplomacy!.proposals.filter(x => x.from === me.id);
  const tb = DIP.tradeBonus(g, me.id), rb = DIP.researchBonus(g, me.id);
  const intel = intelOn(g);
  const log = g.diplomacy!.log.filter(e => e.a === me.id || e.b === me.id || me.intel.met.includes(e.a) || me.intel.met.includes(e.b)).slice(-14).reverse();
  return (
    <Modal title="Diplomatie" sub={intelOn(g) ? "Guerre, paix et alliances ; accords et ambassades ; ce que chaque empire pense de vous, et ce que vous savez de lui." : "Guerre, paix et alliances ; accords ; ce que chaque empire pense de vous, et pourquoi."} actions={<button onClick={() => s.open('battlePlans')}>Plans de bataille…</button>} onClose={() => s.close('relations')} width={860} footer={<button class="primary" onClick={() => s.close('relations')}>Terminé</button>}>
      <HegemonNote />
      {incoming.length > 0 && <div class="diplo-inbox">{incoming.map(x => {
        const o = g.players[x.from];
        const terms = x.minerals ? (x.payer === x.from ? `, contre ${x.minerals} kt de minerais qu'ils vous versent` : `, contre ${x.minerals} kt de minerais que vous leur versez`) : '';
        const against = x.against !== undefined ? g.players[x.against]?.name : undefined;
        return <div class="alert info diplo-prop"><span><b style={{ color: o.color }}>{o.name}</b> {x.kind === 'tribute' ? `exigent de vous un tribut de ${x.minerals} kt de minerais` : x.kind === 'borders' ? `vous demandent d'ouvrir vos frontières à leurs vaisseaux${terms}` : against ? `vous proposent une alliance contre les ${against}, dont l'avance menace toute la galaxie` : `vous proposent ${DIP.KIND_NAMES[x.kind]}${terms}`}. <span class="small muted">Expire en {x.expires}.</span></span>
          <span class="row-btns"><button class="primary small" onClick={() => act(() => DIP.answer(g, x.id, true), 'Proposition acceptée.')}>Accepter</button> <button class="small" onClick={() => act(() => DIP.answer(g, x.id, false), 'Proposition refusée.')}>Refuser</button></span></div>;
      })}</div>}
      {BD.bordersOn(g) && <div class="diplo-policy small">Frontières pour les empires rencontrés désormais : <select value={me.borderPolicy ?? 'open'} onChange={e => { const v = (e.target as HTMLSelectElement).value as 'open' | 'closed'; act(() => { me.borderPolicy = v; }, v === 'closed' ? 'Les empires rencontrés désormais trouveront vos frontières fermées.' : 'Les empires rencontrés désormais trouveront vos frontières ouvertes.'); }}><option value="open">Ouvertes</option><option value="closed">Fermées</option></select> <span class="muted">(puis empire par empire, ci-dessous)</span></div>}
      {met.length === 0 ? <p class="muted">Vous n'avez encore rencontré aucun autre empire. Les empires apparaissent ici après un premier contact (scanner pénétrant, colonie découverte ou combat). En attendant, vous êtes en paix avec tous.</p> :
        <table class="report diplo">
          <thead><tr><th>Empire</th><th>Statut</th><th>Accords</th><th title="ce que cet empire pense de vous (de −100 à +100)">Opinion de vous</th>{intel && <th title="ce que vous savez de cet empire (0 à 100)">Renseignement</th>}<th title="taille de sa flotte de guerre, comparée à la vôtre">Flotte</th></tr></thead>
          <tbody>{met.map(o => {
            const st = DIP.statusOf(g, me.id, o.id)!;
            const pr = DIP.pairOf(g, me.id, o.id)!;
            const op = o.ai ? DIP.opinion(g, o.id, me.id) : null;
            const seen = intel ? perception(g, me.id, o.id) : { factor: 1, err: 0 };
            const blind = intel && (me.intel.dossiers?.[o.id]?.level ?? 0) < 40;
            const ratio = DIP.power(g, o.id) * seen.factor / Math.max(1, DIP.power(g, me.id));
            const isOpen = !!open[o.id];
            return <>
              <tr class={'diplo-emp' + (o.id === focus ? ' hl' : '')}>
                <td><button class="lnk diplo-name" style={{ color: o.color }} aria-expanded={isOpen} onClick={() => setOpen({ ...open, [o.id]: !isOpen })}><span class="caret">{isOpen ? '▾' : '▸'}</span> {o.name}</button>{o.dead ? ' (anéanti)' : ''}
                  <div class="small muted">{o.race.pluralName} · {PRT_INFO[o.race.prt].name}{o.ai ? '' : ' · joueur humain'}</div>
                  {isNemesis(g, o.id, me.id) && <div class="nemesis-tag" title="Ils refusent toute paix tant que leur empire n'est pas brisé (60 % des mondes qu'ils tenaient, ou leur capitale).">Némésis : ont juré votre perte</div>}</td>
                <td><span class={'diplo-st ' + st}>{DIP.STATUS_NAMES[st]}</span> <span class="small muted">depuis {pr.since}</span>{st === 'war' && o.ai ? <div class="small muted">leur lassitude {DIP.exhaustion(g, o.id, me.id)}</div> : null}
                  {st === 'peace' && BD.hasClosed(g, me.id, o.id) && <div class="small yellow" title="Leurs vaisseaux ne peuvent pas entrer dans votre territoire sans vous déclarer la guerre">vos frontières : fermées</div>}
                  {st === 'peace' && BD.closedTo(g, o.id, me.id) && <div class="small red" title="Entrer dans leur territoire leur déclarerait la guerre">leurs frontières : fermées</div>}</td>
                <td class="small">{[pr.embassy !== undefined && st !== 'war' ? 'Ambassades' : '', pr.trade !== undefined ? 'Commerce' : '', pr.research !== undefined ? 'Recherche' : ''].filter(Boolean).join(', ') || '–'}</td>
                <td>{op ? <Opinion v={op.total} /> : <span class="muted">–</span>}</td>
                {intel && <td><IntelLevel me={me} pid={o.id} /></td>}
                <td class="num small">{blind ? <span class="muted" title="il faut un renseignement de 40 pour estimer leur flotte">?</span> : <span title={seen.err > 0.02 ? `estimation à ±${Math.round(seen.err * 100)} %` : 'exact'}>{seen.err > 0.02 ? '≈ ' : ''}{ratio >= 10 ? '×10+' : `×${ratio.toFixed(ratio < 1 ? 2 : 1)}`}</span>}</td></tr>
              {isOpen && <tr class="diplo-sub"><td colSpan={intel ? 6 : 5}>
                {op && <div class="diplo-why"><b class="small">Pourquoi :</b> {op.lines.map(l => <span class={'chip small ' + (l.value >= 0 ? 'green' : 'red')}>{l.label} {l.value > 0 ? '+' : ''}{l.value}</span>)}</div>}
                {nemesisOn(g) && o.ai && !isNemesis(g, o.id, me.id) && (o.grudges?.[me.id] ?? 0) >= 1 && <div class="small muted">Rancune envers vous : <b class={(o.grudges![me.id] ?? 0) >= NEMESIS_AT * 0.7 ? 'red' : ''}>{Math.round(o.grudges![me.id])}</b> sur {NEMESIS_AT}. Elle monte avec chaque vaisseau et chaque monde que vous leur prenez, et retombe lentement ; au seuil, ils jurent votre perte.</div>}
                {!o.dead && <Actions g={g} me={me} o={o} />}
                {outgoing.filter(x => x.to === o.id).map(x => <div class="small muted">En attente de leur réponse à {DIP.OFFER_NAMES[x.kind]} (expire en {x.expires}).</div>)}
                <DossierBlock pid={o.id} />
                <KnownColonies pid={o.id} />
              </td></tr>}
            </>;
          })}</tbody>
        </table>}
      <p class="small">Vos accords vous rapportent <b>+{pctTxt(tb)}</b> de ressources et <b>+{pctTxt(rb)}</b> de recherche (trois partenaires au plus pour chacun).</p>
      {log.length > 0 && <><h4 class="emp-sub">Dernières nouvelles</h4><ul class="emp-obj small">{log.map(e => <li>{e.year} · {e.text}</li>)}</ul></>}
      <p class="small muted">On ne combat, n'envahit et ne bombarde que les empires avec qui l'on est en guerre, et les champs de mines épargnent les autres. Les ordinateurs pèsent chaque proposition selon les raisons affichées à côté (opinion, rapport de forces, lassitude, minerais) ; leur réponse garde une part d'incertitude : « probablement » n'est pas « sûrement ». Seules les règles fermes (une guerre qui vient de commencer, un accord déjà signé...) sont certaines. Une guerre déclarée malgré un accord ou une alliance est une trahison que tous retiennent ; déclarer la guerre à un allié d'un ordinateur fait entrer cet ordinateur en guerre contre vous.{BD.bordersOn(g) ? ' Des frontières fermées interdisent votre territoire aux vaisseaux d\'un empire : y entrer, c\'est vous déclarer la guerre. Les ordinateurs mesurent ce que des frontières fermées leur barrent : plus elles les enferment, plus ils en veulent à qui les ferme, plus ils demandent qu\'on les rouvre, et plus ils sont prêts à la guerre.' : ''}</p>
    </Modal>
  );
}
