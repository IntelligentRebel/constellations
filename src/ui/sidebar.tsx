// Left sidebar: colonies and fleets, fleets grouped by what they are doing.
import { isStudying, anomalyAt, defOf, pointsNeeded } from '../engine/anomalies';
import type { ComponentChildren } from 'preact';
import { store, useStore, fmt, fmtPop, INSPECTOR_TABS } from './store';
import type { Fleet, GameState, Player } from '../engine/types';
import { fleetSpec, estimateRoute } from '../engine/fleet';
import { planetSpec } from '../engine/planet';
import { wpName } from './command';
import { fleetHasObsolete, pendingRefit } from '../engine/refit';
import { defaultTankerRange } from '../engine/refuel';
import { secretStudyOf } from '../engine/secrets';
import { rankOf, RANKS } from '../engine/veterans';

export interface MissionInfo { id: string; label: string; detail: string }

const GROUPS: [string, string][] = [['refit', 'Modernisation'], ['explore', 'Exploration'], ['colonize', 'Colonisation'], ['logistics', 'Réseau logistique'], ['transport', 'Transport'], ['move', 'Déplacement'], ['patrol', 'Patrouille'], ['post', 'En poste'], ['pursuit', 'Interception'], ['refuel', 'Ravitaillement'], ['study', 'Étude'], ['beacon', 'Balises'], ['mining', 'Forage'], ['mines', 'Champs de mines'], ['other', 'Autres ordres']];
const GROUP_IDS = new Set(GROUPS.map(x => x[0]));

/** What a fleet is doing, for grouping and one-line summaries. */
export function fleetMission(g: GameState, me: Player, f: Fleet): MissionInfo {
  const wps = f.waypoints;
  const last = wps[wps.length - 1];
  const dest = wps.length > 1 ? wpName(g, me.id, last) : '';
  const eta = () => { const e = estimateRoute(g, f); return e.length ? ` · ${e[e.length - 1].arrival} a` : ''; };
  if (f.beaconOf !== undefined) return { id: 'beacon', label: 'Balises', detail: `revendique ${g.planets[f.beaconOf].name}` };
  if (f.auto === 'explore') return { id: 'explore', label: 'Exploration', detail: dest ? `explore ${dest}${eta()}` : 'exploration automatique' };
  if (f.refuelFor !== undefined) {
    const t = g.fleets.find(x => x.id === f.refuelFor);
    return { id: 'refuel', label: 'Ravitaillement', detail: `ravitaille ${t?.name ?? '?'}${wps.length > 1 ? eta() : ''}` };
  }
  if (f.meetTrader !== undefined) return { id: 'pursuit', label: 'Interception', detail: `rejoint le Marchand nomade${wps.length > 1 ? eta() : ''}` };
  if (f.pursue !== undefined) {
    const t = me.intel.fleets.find(x => x.id === f.pursue);
    return { id: 'pursuit', label: 'Interception', detail: `poursuit ${t?.name ?? 'un contact perdu'}${wps.length > 1 ? eta() : ''}` };
  }
  if (isStudying(g, f)) {
    const a = anomalyAt(g, me, f.orbiting);
    return { id: 'study', label: 'Étude', detail: a ? `étudie ${defOf(a).name} · ${Math.round((a.progress[me.id] ?? 0) / pointsNeeded(a) * 100)} %` : 'étude' };
  }
  // 0.3.7: sounding a dark cloud for the way into a veiled star, studying a sealed wormhole
  const sst = secretStudyOf(g, f);
  if (sst) return { id: 'study', label: 'Étude', detail: `${sst.kind === 'probe' ? 'sonde le nuage' : 'étudie le trou de ver scellé'} · ${Math.round(sst.pct * 100)} %` };
  if (f.auto === 'logistics') {
    const j = f.job;
    return { id: 'logistics', label: 'Réseau logistique', detail: j ? `${j.kind === 'colonists' ? 'colons' : 'minerais'} ${g.planets[j.from].name} → ${g.planets[j.to].name}${eta()}` : 'en attente d\'une mission du réseau' };
  }
  // standing orders at the current position (forage, minelaying, patrol) stay active once processed
  const STANDING = ['remoteMine', 'layMines', 'patrol', 'refuel', 'stay'];
  const tasks = wps.map((w, i) => (i === 0 && !STANDING.includes(w.task) && (w.processed || wps.length > 1 && w.task === 'transport' && wps.some(x => x.task === 'colonize'))) ? 'none' : w.task);
  const has = (t: string) => tasks.includes(t as never);
  if (f.repeat && f.route && f.route.length > 1 && f.route.some(w => w.task === 'transport')) {
    const names = [...new Set(f.route.map(w => wpName(g, me.id, w)))];
    return { id: 'transport', label: 'Transport', detail: `navette ${names.join(' ⇄ ')}` };
  }
  if (wps.length <= 1 && tasks[0] === 'none') {
    // 0.3.6.7: waiting in orbit for its refit is a mission
    const r = pendingRefit(g, f);
    if (r) return { id: 'refit', label: 'Modernisation', detail: `en chantier à ${r.planet.name} → ${r.to}` };
    return { id: 'idle', label: 'Sans mission', detail: 'sans ordre' };
  }
  if (has('colonize')) return { id: 'colonize', label: 'Colonisation', detail: `colonise ${dest}${eta()}` };
  if (has('transport')) return { id: 'transport', label: 'Transport', detail: dest ? `vers ${dest}${eta()}` : 'chargement' };
  if (has('refuel')) return { id: 'refuel', label: 'Ravitaillement', detail: wps.length > 1 ? `regagne son poste${eta()}` : `en poste · rayon ${wps[0].patrolRange ?? defaultTankerRange(g, f)} al` };
  if (has('patrol')) return { id: 'patrol', label: 'Patrouille', detail: 'patrouille' };
  if (wps.length <= 1 && tasks[0] === 'stay') return { id: 'post', label: 'En poste', detail: `en poste${f.orbiting >= 0 ? ` à ${g.planets[f.orbiting].name}` : ''}` };
  if (has('remoteMine')) return { id: 'mining', label: 'Forage', detail: dest ? `fore ${dest}${eta()}` : `fore ${f.orbiting >= 0 ? g.planets[f.orbiting].name : 'sur place'}` };
  if (has('layMines')) return { id: 'mines', label: 'Champs de mines', detail: 'pose des mines' };
  if (has('merge') || has('scrap') || has('transfer') || has('route')) return { id: 'other', label: 'Autres ordres', detail: dest ? `vers ${dest}${eta()}` : 'ordre en attente' };
  if (last.target === 'planet' && last.targetId !== undefined && me.intel.planets[last.targetId].year === undefined) return { id: 'explore', label: 'Exploration', detail: `explore ${dest}${eta()}` };
  return { id: 'move', label: 'Déplacement', detail: `vers ${dest}${eta()}` };
}

function Group({ id, title, count, children, sub, closedByDefault }: { id: string; title: string; count: number; children: ComponentChildren; sub?: boolean; closedByDefault?: boolean }) {
  const s = useStore();
  const open = !(s.collapsed[id] ?? !!closedByDefault);
  return <section class={'sgroup' + (sub ? ' sub' : '') + (open ? '' : ' closed')} data-tut={id}>
    <button class="sgroup-head" onClick={() => { s.collapsed[id] = open; s.savePrefs(); s.bump(); }} aria-expanded={open}>
      <span class="tw">{open ? '▾' : '▸'}</span><span class="tt">{title}</span><span class="cnt">{count}</span>
    </button>
    {open && <div class="sgroup-body">{children}</div>}
  </section>;
}

function pick(kind: 'planet' | 'fleet', id: number, x: number, y: number) {
  const s = store;
  if (!INSPECTOR_TABS.includes(s.tab)) s.tab = 'map';
  s.drawer = false;
  s.select({ kind, id });
  s.center(x, y);
}

function FleetArrow({ f, color }: { f: Fleet; color: string }) {
  const moving = f.waypoints.length > 1;
  const w = f.waypoints[1];
  const ang = moving && w ? Math.atan2(w.y - f.y, w.x - f.x) * 180 / Math.PI : 0;
  return <svg class="farrow" viewBox="-8 -8 16 16" width="14" height="14" aria-hidden="true">
    {moving ? <path d="M7 0 L-5 4.5 L-2.5 0 L-5 -4.5 Z" fill={color} transform={`rotate(${ang})`} /> : <circle r="3" fill={color} />}
  </svg>;
}

export function Sidebar() {
  const s = useStore();
  const g = s.game!, me = s.me!;
  const colonies = g.planets.filter(p => p.owner === me.id).sort((a, b) => Number(!!b.homeworld) - Number(!!a.homeworld) || b.pop - a.pop);
  const fleets = g.fleets.filter(f => f.owner === me.id);
  const info = new Map(fleets.map(f => [f.id, fleetMission(g, me, f)]));
  const idle = fleets.filter(f => info.get(f.id)!.id === 'idle');
  const busy = fleets.filter(f => info.get(f.id)!.id !== 'idle');
  const sel = s.selected;
  const fleetRow = (f: Fleet) => {
    const sp = fleetSpec(g, f);
    const mi = info.get(f.id)!;
    const low = sp.fuelCapacity > 0 && f.fuel < sp.fuelCapacity * 0.2;
    return <button class={'srow fleet' + (sel?.kind === 'fleet' && sel.id === f.id ? ' sel' : '')} data-tut={'fleet-' + f.id} onClick={() => pick('fleet', f.id, f.x, f.y)} title={f.name}>
      <FleetArrow f={f} color={sel?.kind === 'fleet' && sel.id === f.id ? '#ffffff' : 'var(--accent)'} />
      <span class="sname">{f.name}{rankOf(f) > 0 && g.settings.veterans && <i class={'vstars r' + rankOf(f)} title={RANKS[rankOf(f)].name}> {'★'.repeat(rankOf(f))}</i>}{fleetHasObsolete(g, f) && <i class="obs"> obsolète</i>}</span>
      <span class="ssub">{sp.ships} v. · {mi.detail}</span>
      {sp.fuelCapacity > 0 && <span class="fuel" title={`Carburant ${fmt(f.fuel)} / ${fmt(sp.fuelCapacity)} mg`}><i style={{ width: Math.max(0, Math.min(100, f.fuel / sp.fuelCapacity * 100)) + '%' }} class={low ? 'low' : ''} /></span>}
    </button>;
  };
  return (
    <aside class="side" data-tut="side">
      <div class="side-race"><span style={{ color: me.color }}>{me.name}</span><i /></div>
      <Group id="sb-col" title="Colonies" count={colonies.length}>
        {colonies.map(p => {
          const sp = planetSpec(g, p, me);
          return <button class={'srow colony' + (sel?.kind === 'planet' && sel.id === p.id ? ' sel' : '')} data-tut={'colony-' + p.id} onClick={() => pick('planet', p.id, p.x, p.y)}>
            <span class="dot" style={{ background: me.color }} />
            <span class="sname">{p.name}{p.homeworld ? <span class="star" title="Monde natal">★</span> : null}</span>
            <span class="ssub">{fmtPop(p.pop)} hab. · {fmt(sp.resources)} R/an</span>
            {p.queue.length === 0 && <span class="warn-dot" title="File de production vide" />}
          </button>;
        })}
      </Group>
      <div class="side-sec"><span>Flottes</span><span class="cnt">{fleets.length}</span></div>
      <Group id="sb-idle" title="Sans mission" count={idle.length}>
        {idle.length === 0 ? <div class="sempty">Toutes vos flottes ont des ordres.</div> : idle.map(fleetRow)}
      </Group>
      <Group id="sb-busy" title="Avec mission" count={busy.length}>
        {busy.length === 0 ? <div class="sempty">Aucune flotte en mission.</div> : GROUPS.map(([gid, label]) => {
          const list = busy.filter(f => { const id = info.get(f.id)!.id; return id === gid || (gid === 'other' && !GROUP_IDS.has(id)); });
          return list.length ? <Group id={'sb-m-' + gid} title={label} count={list.length} sub>{list.map(fleetRow)}</Group> : null;
        })}
      </Group>
    </aside>
  );
}
