// 0.3.9: the Empire page sections of the lot D (golden ages, the secret of the Ancients, the victory of the origin, the
// stories under way) and the dilemma window.
import { useStore, store, fmt } from './store';
import { Modal, Bar } from './components';
import type { GameState, Player } from '../engine/types';
import { goldenOn, inGoldenAge, inspirationGain, GOLDEN_FIRST, GOLDEN_YEARS, GOLDEN_BONUS } from '../engine/golden';
import { secretOn, knowsSecret, CLUES_NEEDED, BREACH_KINDS, breachKind, anchorOf, sealBlocker, SEAL_NEAR } from '../engine/ancients';
import { originWinsOn, ORIGIN_WINS, ORIGIN_WIN_FROM } from '../engine/originwins';
import { ORIGIN } from '../engine/origins';
import { chainsOn } from '../engine/chains';
import { dilemmaView, settle } from '../engine/dilemmas';
import { megaProgress } from '../engine/megaprojects';
import * as A from './actions';

function Sec({ title, sub, children, id }: { title: string; sub?: string; children: preact.ComponentChildren; id?: string }) {
  return <section class="emp-sec" id={id}><div class="emp-head"><h3>{title}</h3>{sub && <span class="small muted">{sub}</span>}</div>{children}</section>;
}

export function GoldenSection({ g, me }: { g: GameState; me: Player }) {
  if (!goldenOn(g)) return null;
  const gd = me.golden ?? { inspiration: 0, next: GOLDEN_FIRST, count: 0 };
  const on = inGoldenAge(g, me);
  const gain = inspirationGain(g, me);
  const years = gain > 0 ? Math.ceil((gd.next - gd.inspiration) / gain) : null;
  return <Sec id="golden" title="Âge d'or" sub={`la culture devient inspiration ; un âge d'or dure ${GOLDEN_YEARS} ans : +${Math.round(GOLDEN_BONUS * 100)} % de ressources et de recherche`}>
    {on ? <div class="golden-on">Âge d'or en cours, jusqu'en <b>{gd.until}</b> : +{Math.round(GOLDEN_BONUS * 100)} % de ressources et de recherche sur tout l'empire.</div>
      : <>
        <Bar value={gd.inspiration} max={gd.next} color="#e8c55a" label={`${fmt(gd.inspiration)} / ${fmt(gd.next)}`} />
        <div class="small muted">{years !== null ? `+${fmt(gain, 1)} d'inspiration par an : prochain âge d'or vers ${g.year + years}.` : `+${fmt(gain, 1)} d'inspiration par an.`} {'Le mécénat compte aussi.'}</div>
      </>}
    {gd.count > 0 && <div class="small muted">{gd.count > 1 ? `${gd.count} âges d'or vécus.` : 'Un âge d\'or vécu.'}</div>}
  </Sec>;
}

export function SecretSection({ g, me }: { g: GameState; me: Player }) {
  const s = useStore();
  if (!secretOn(g)) return null;
  const known = knowsSecret(me);
  const k = known ? BREACH_KINDS[breachKind(g)] : undefined;
  const anchor = known && breachKind(g) === 'seed' && g.crisis && g.crisis.phase !== 'dormant' ? anchorOf(g) : undefined;
  const sites = known ? g.planets.filter(p => p.owner === me.id && !sealBlocker(g, p)) : [];
  const running = g.planets.flatMap(p => p.owner === me.id ? p.queue.filter(q => q.kind === 'mega' && q.megaId === 'seal').map(q => ({ p, q })) : [])[0];
  return <Sec id="secret" title="Le secret des Anciens" sub="ce qu'est la Brèche, et comment la sceller">
    {!known ? <>
      <Bar value={me.clues ?? 0} max={CLUES_NEEDED} color="#9f7af0" label={`${me.clues ?? 0} indices sur ${CLUES_NEEDED}`} />
      <p class="small">Chaque chapitre de fouilles, souvent une anomalie étudiée, trois fois le sanctuaire des Anciens, une année d'observation de la Brèche annoncée (un vaisseau doté d'un scanner à moins de 40 al) et les épaves des Moissonneurs donnent un indice. À six, le secret se révèle, avec le moyen de sceller la Brèche, une autre façon de gagner.</p>
      {(me.clueLog ?? []).length > 0 && <ul class="small muted clue-log">{[...(me.clueLog ?? [])].reverse().map(c => <li>{c}</li>)}</ul>}
    </> : <>
      <h4 class="secret-title">{k!.name}</h4>
      <p class="small">{k!.lore}</p>
      <p class="small"><b>{k!.where}</b>{anchor && <> {'Le monde-ancre :'} <button class="lnk" onClick={() => s.focus({ kind: 'planet', id: anchor.id }, anchor)}>{anchor.name}</button>.</>}</p>
      {g.crisis?.sealed ? <div class="small">La Brèche est scellée.</div>
        : running ? <><div class="small">Sceau des Anciens en chantier sur <button class="lnk" onClick={() => s.focus({ kind: 'planet', id: running.p.id }, running.p)}>{running.p.name}</button>.</div><Bar value={megaProgress(running.q)} max={1} color="#9f7af0" label={`${Math.floor(megaProgress(running.q) * 100)} %`} /></>
          : sites.length ? <div class="btns">{sites.slice(0, 3).map(p => <button class="small primary" onClick={() => { A.queueAdd(p.id, 'mega', undefined, 1, undefined, 'seal'); s.notify(`Sceau des Anciens ajouté à la file de ${p.name}.`); }}>Bâtir le Sceau sur {p.name}</button>)}</div>
            : <div class="small muted">{g.crisis?.phase === 'dormant' || !g.crisis ? 'Le Sceau ne peut s\'élever qu\'une fois la Brèche annoncée.' : <SealWhere g={g} />}</div>}
    </>}
  </Sec>;
}

/** Where the Seal could rise, when none of the player's worlds fits. */
function SealWhere({ g }: { g: GameState }) {
  const s = useStore();
  const kind = breachKind(g);
  const target = kind === 'seed' ? anchorOf(g) : kind === 'prison' && g.crisis?.phase === 'omen' && g.crisis.planetId !== undefined ? g.planets[g.crisis.planetId] : undefined;
  const link = target ? <button class="lnk" onClick={() => s.focus({ kind: 'planet', id: target.id }, target)}>{target.name}</button> : null;
  if (kind === 'experiment') return <>{`Il vous faut un monde à moins de ${SEAL_NEAR} al de la Brèche.`}</>;
  if (kind === 'prison' && g.crisis?.phase !== 'omen') return <>Trop tard : la Brèche est ouverte, et le Sceau ne peut plus être rebâti.</>;
  return target ? <>Colonisez {link} pour y bâtir le Sceau.</> : <>Aucun de vos mondes ne convient pour l'instant.</>;
}

export function OriginWinSection({ g, me }: { g: GameState; me: Player }) {
  if (!originWinsOn(g) || !me.origin) return null;
  const w = ORIGIN_WINS[me.origin];
  if (!w) return null;
  const pr = w.progress(g, me);
  return <Sec id="originwin" title={`Victoire d'origine : ${w.name}`} sub={`${ORIGIN[me.origin]?.name ?? ''} · comptée à partir de ${ORIGIN_WIN_FROM}`}>
    <p class="small">{w.text(g)}</p>
    <Bar value={Math.min(1, pr.share)} max={1} color="#4fd6e3" label={pr.text} />
    <p class="small muted">Elle n'appartient qu'à vous : les autres empires ont la leur, selon leur origine.</p>
  </Sec>;
}

export function StoriesSection({ g, me }: { g: GameState; me: Player }) {
  const s = useStore();
  if (!chainsOn(g)) return null;
  const mine = (g.chains ?? []).filter(c => c.owner === me.id && c.done === undefined);
  if (!mine.length) return null;
  return <Sec id="stories" title="Histoires en cours" sub="elles se dénouent sur des années">
    <ul class="stories">{mine.map(c => {
      const pl = g.planets[c.data.planet as number];
      const link = pl ? <button class="lnk" onClick={() => s.focus({ kind: 'planet', id: pl.id }, pl)}>{pl.name}</button> : null;
      if (c.kind === 'signal') return <li>{c.stage < 2 ? <>Le signal de {link} : vos savants l'étudient.</> : <>Le signal de {link} : un vaisseau doté d'un scanner doit s'y mettre en orbite avant {c.data.deadline}.</>}</li>;
      if (c.kind === 'plague') {
        const n = String(c.data.planets).split(',').length;
        if (c.data.mode === 'quarantine') return <li>La peste grise est confinée sur {link} : vos biologistes cherchent un remède.</li>;
        if (c.data.mode === 'open') return <li>{n > 1 ? `La peste grise touche ${n} mondes, sans quarantaine : vos biologistes cherchent un remède.` : <>La peste grise touche {link}, sans quarantaine : vos biologistes cherchent un remède.</>}</li>;
        return <li>La peste grise touche {link} : la quarantaine attend votre décision.</li>;
      }
      if (c.kind === 'prophet') {
        if (c.data.mode === 'embrace') return <li>Le prophète de {link}, que vous avez embrassé : son destin se jouera vers {c.next}.</li>;
        if (c.data.mode === 'exile') return <li>Le prophète de {link} est exilé ; on saura vers {c.next} ce qu'il est devenu.</li>;
        return <li>Le prophète de {link} attend votre décision.</li>;
      }
      return null;
    })}</ul>
  </Sec>;
}

/** The window of a dilemma: the two answers and their prices. */
export function DilemmaDialog({ id }: { id?: number }) {
  const s = useStore();
  const g = s.game!, me = s.me!;
  const d = (me.dilemmas ?? []).find(x => x.id === id) ?? me.dilemmas?.[0];
  if (!d) return <Modal title="Dilemme" width={520} onClose={() => s.close('dilemma')}><p class="muted">Plus aucun dilemme en attente.</p></Modal>;
  const v = dilemmaView(g, me, d);
  if (!v) return null;
  const pick = (c: 'a' | 'b') => { s.checkpoint(); const t = settle(g, me, d.id, c); s.close('dilemma'); if (t) s.notify(t); s.bump(); };
  return <Modal title={v.title} width={600} onClose={() => s.close('dilemma')} footer={<><span class="small muted">À trancher avant {d.expires} ; sinon, « {v.b.label} ».</span><span class="sp" /><button onClick={() => s.close('dilemma')}>Plus tard</button></>}>
    <p class="dil-text">{v.text}</p>
    <div class="dil-choices">
      <button class="dil-choice" onClick={() => pick('a')}><b>{v.a.label}</b><span class="small">{v.a.hint}</span></button>
      <button class="dil-choice" onClick={() => pick('b')}><b>{v.b.label}</b><span class="small">{v.b.hint}</span></button>
    </div>
  </Modal>;
}

export const openDilemma = (id?: number) => store.open('dilemma', { id });
