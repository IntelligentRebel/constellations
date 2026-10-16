// 0.3.9: everything that waits for the player this year, in one queue. One key (T, Shift+T backwards) or the first
// chip of the bar walks through it: decisions, doctrines, proposals to answer, then the fleets and colonies that need
// an order. Once the queue is empty, the year is "clean".
import { store } from './store';
import type { GameState, Player } from '../engine/types';
import { fleetSpec } from '../engine/fleet';
import { isPureScout } from '../engine/missions';
import { pendingRefit } from '../engine/refit';
import { isStudying } from '../engine/anomalies';
import { pendingForks } from '../engine/doctrines';

export interface TodoItem {
  /** group (one chip per group in the bar) */
  group: 'decision' | 'doctrine' | 'proposal' | 'dilemma' | 'scouts' | 'colo' | 'cargo' | 'fuel' | 'queue';
  /** stable key, to find one's place again in the queue */
  key: string;
  go: () => void;
}

const scrollTo = (id: string) => setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }), 60);

export const TODO_LABELS: Record<TodoItem['group'], string> = {
  decision: 'décision(s) de découverte',
  doctrine: 'doctrine(s) à choisir',
  proposal: 'proposition(s) diplomatique(s) en attente',
  dilemma: 'dilemme(s) à trancher',
  scouts: 'éclaireur(s) sans ordre',
  colo: 'colonisateur(s) chargé(s) en attente',
  cargo: 'cargo(s) plein(s) à l\'arrêt',
  fuel: 'flotte(s) presque à sec',
  queue: 'file(s) de production vide(s)',
};

export function todoItems(g: GameState, me: Player): TodoItem[] {
  const s = store;
  const out: TodoItem[] = [];
  for (const d of me.decisions ?? []) out.push({ group: 'decision', key: 'dec' + d.id, go: () => { s.goTab('empire'); scrollTo('discoveries'); } });
  for (const f of pendingForks(g, me)) out.push({ group: 'doctrine', key: 'doc' + f.title, go: () => { s.goTab('research'); scrollTo('doctrines'); } });
  for (const p of g.diplomacy?.proposals.filter(x => x.to === me.id) ?? []) out.push({ group: 'proposal', key: 'pro' + p.id, go: () => s.goTab('diplomacy') });
  for (const d of me.dilemmas ?? []) out.push({ group: 'dilemma', key: 'dil' + d.id, go: () => s.open('dilemma', { id: d.id }) });
  const fleets = g.fleets.filter(f => f.owner === me.id);
  const onPost = (f: typeof fleets[number]) => f.waypoints[0]?.task === 'stay' || f.meetTrader !== undefined || !!pendingRefit(g, f);
  const fleetGo = (group: TodoItem['group'], f: typeof fleets[number]) => out.push({ group, key: group + f.id, go: () => { s.select({ kind: 'fleet', id: f.id }); s.center(f.x, f.y); if (s.tab !== 'map') s.goTab('map'); } });
  const idle = (f: typeof fleets[number]) => f.waypoints.length <= 1 && !onPost(f);
  for (const f of fleets) { const sp = fleetSpec(g, f); if (idle(f) && sp.colonizer && f.cargo.colonists > 0) fleetGo('colo', f); }
  for (const f of fleets) { const sp = fleetSpec(g, f); if (idle(f) && !f.auto && f.pursue === undefined && !isStudying(g, f) && isPureScout(sp)) fleetGo('scouts', f); }
  for (const f of fleets) { const sp = fleetSpec(g, f); if (idle(f) && f.auto !== 'logistics' && !sp.colonizer && f.cargo.ironium + f.cargo.boranium + f.cargo.germanium + f.cargo.colonists > 0) fleetGo('cargo', f); }
  for (const f of fleets) { const sp = fleetSpec(g, f); if (f.orbiting < 0 && sp.fuelCapacity > 0 && f.fuel < sp.fuelCapacity * 0.15 && sp.freeSpeed < 2) fleetGo('fuel', f); }
  for (const p of g.planets) if (p.owner === me.id && p.queue.length === 0) out.push({ group: 'queue', key: 'q' + p.id, go: () => { s.select({ kind: 'planet', id: p.id }); s.center(p.x, p.y); s.collapsed['insp-prod'] = false; if (s.tab !== 'map') s.goTab('map'); } });
  return out;
}

/** Next (or previous) item of the queue after the last one shown. */
export function nextTodo(dir = 1) {
  const g = store.game, me = store.me;
  if (!g || !me) return;
  const list = todoItems(g, me);
  if (!list.length) { store.todoKey = null; store.notify('Rien à traiter : l\'année est prête.'); return; }
  const at = store.todoKey ? list.findIndex(x => x.key === store.todoKey) : -1;
  const i = at < 0 ? (dir > 0 ? 0 : list.length - 1) : (at + dir + list.length) % list.length;
  store.todoKey = list[i].key;
  list[i].go();
  store.bump();
}
