// 0.3.9.26: the system behind a star of a galaxy made from a name: its star, its planets and their moons, as Rick's
// galaxy generator draws them. Constellations keeps the abstraction of Stars!: the game sums the system up in one world,
// the main world (the one that fits the values the game gives it); the rest is shown, never managed.
import { useEffect, useRef, useState } from 'preact/hooks';
import { useStore, fmt } from './store';
import { Modal } from './components';
import type { GameState, Hab, Planet } from '../engine/types';
import { starIdOf, starProps, systemPlanets, planetMoons, SPECTRAL_COLOR, type Spectral, type SysPlanet, type StarProps } from '../engine/galaxygen';

const PLANET_LABEL: Record<SysPlanet['type'], string> = { Rocky: 'rocheuse', Desert: 'désertique', Ocean: 'océanique', 'Gas Giant': 'géante gazeuse', 'Ice Giant': 'géante de glace', Frozen: 'gelée' };
const PLANET_COLOR: Record<SysPlanet['type'], string> = { Rocky: '#a0785a', Ocean: '#4488cc', Desert: '#cc9944', 'Gas Giant': '#cc8844', 'Ice Giant': '#88aacc', Frozen: '#aaccdd' };
const MOON_LABEL = { Rocky: 'rocheuse', Icy: 'glacée', Captured: 'capturée' } as const;

/** The planet of the system that the game's values describe best (temperature from the orbit, gravity from the size). */
function mainWorld(p: StarProps, planets: SysPlanet[], hab: Hab | undefined): number | undefined {
  if (!hab || !planets.length) return undefined;
  const mid = (p.hzInner + p.hzOuter) / 2;
  let best: number | undefined, bd = Infinity;
  for (const pl of planets) {
    const tC = 288 * Math.sqrt(mid / pl.orbit) - 273;
    const tIdx = Math.max(0, Math.min(100, 50 + tC / 4));
    const giant = pl.type === 'Gas Giant' || pl.type === 'Ice Giant';
    const d = Math.abs(tIdx - hab[1]) + Math.abs(pl.sizeRaw - hab[0]) * 0.5 + (giant ? 40 : 0);
    if (d < bd) { bd = d; best = pl.num; }
  }
  return best;
}

export function systemOf(g: GameState, pl: Planet) {
  if (!pl.star || !g.shape?.gid) return null;
  const id = starIdOf(g.shape.gid, pl.star.n, pl.star.a);
  const props = starProps(id);
  return { id, props, planets: systemPlanets(id, props) };
}

export function SystemDialog({ data }: { data: { planetId: number } }) {
  const s = useStore();
  const g = s.game!, me = s.me!;
  const pl = g.planets[data.planetId];
  const sys = pl ? systemOf(g, pl) : null;
  const [sel, setSel] = useState<number | null>(null);
  const ref = useRef<HTMLCanvasElement>(null);
  const known = me.intel.planets[pl?.id ?? -1]?.hab;
  const main = sys ? mainWorld(sys.props, sys.planets, known) : undefined;
  useEffect(() => {
    const c = ref.current; if (!c || !sys) return;
    const dpr = window.devicePixelRatio || 1, W = c.clientWidth, H = c.clientHeight;
    c.width = W * dpr; c.height = H * dpr;
    const ctx = c.getContext('2d')!; ctx.scale(dpr, dpr);
    ctx.fillStyle = '#05070d'; ctx.fillRect(0, 0, W, H);
    const { props: p, planets } = sys;
    const cx = W / 2, cy = H / 2;
    const maxOrbit = planets.length ? planets[planets.length - 1].orbit : 1;
    // orbits spaced by their square root: the outer ones of a big system stay on the canvas, the inner ones apart
    const R = Math.min(W, H) * 0.45, rad = (o: number) => R * Math.sqrt(o / maxOrbit);
    const hzI = rad(p.hzInner), hzO = Math.max(rad(p.hzOuter), hzI + 6);
    const gz = ctx.createRadialGradient(cx, cy, hzI, cx, cy, hzO);
    gz.addColorStop(0, 'rgba(40,180,40,0)'); gz.addColorStop(0.3, 'rgba(40,180,40,0.28)'); gz.addColorStop(0.7, 'rgba(40,180,40,0.28)'); gz.addColorStop(1, 'rgba(40,180,40,0)');
    ctx.fillStyle = gz; ctx.beginPath(); ctx.arc(cx, cy, hzO, 0, Math.PI * 2); ctx.arc(cx, cy, hzI, 0, Math.PI * 2, true); ctx.fill();
    ctx.strokeStyle = '#223355'; ctx.lineWidth = 1;
    for (const q of planets) { ctx.beginPath(); ctx.arc(cx, cy, rad(q.orbit), 0, Math.PI * 2); ctx.stroke(); }
    const col = SPECTRAL_COLOR[p.type as Spectral];
    const sr = Math.max(5, Math.min(14, (planets.length ? rad(planets[0].orbit) : R) * 0.35));
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, sr * 3);
    glow.addColorStop(0, col + '88'); glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, sr * 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(cx, cy, sr, 0, Math.PI * 2); ctx.fill();
    for (const q of planets) {
      const r = rad(q.orbit), a = (q.num * 137.508) * Math.PI / 180;
      const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a), pr = 2.5 + (q.sizeRaw / 99) * 6;
      ctx.fillStyle = PLANET_COLOR[q.type]; ctx.beginPath(); ctx.arc(x, y, pr, 0, Math.PI * 2); ctx.fill();
      for (let m = 0; m < Math.min(q.numMoons, 12); m++) {
        const ma = (m / Math.min(q.numMoons, 12)) * Math.PI * 2;
        ctx.fillStyle = '#667788'; ctx.beginPath(); ctx.arc(x + pr * 2 * Math.cos(ma), y + pr * 2 * Math.sin(ma), 1, 0, Math.PI * 2); ctx.fill();
      }
      if (q.num === main || q.num === sel) { ctx.strokeStyle = q.num === main ? '#5dde7a' : '#9ab'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, pr + 4, 0, Math.PI * 2); ctx.stroke(); }
      ctx.fillStyle = q.inHz ? '#4c8' : '#99a'; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('P' + q.num, x, y - pr - 6);
    }
  }, [sys?.id, main, sel]);
  if (!pl || !sys) return null;
  const p = sys.props;
  const moons = sel !== null ? planetMoons(sys.id, sys.planets[sel - 1]) : [];
  return <Modal title={`${pl.name} · système`} width={620} onClose={() => s.close('system')}>
    <canvas ref={ref} class="sys-canvas" />
    <p class="small">{`Étoile de type ${p.type} (${fmt(p.temperature)} K, ${fmt(p.luminosity, p.luminosity < 10 ? 2 : 0)} fois la luminosité du Soleil) · zone habitable de ${fmt(p.hzInner, 2)} à ${fmt(p.hzOuter, 2)} UA · métallicité ${p.metallicity} %`}</p>
    <table class="report sys-table"><thead><tr><th>Planète</th><th>Type</th><th>Orbite</th><th>Lunes</th><th /></tr></thead>
      <tbody>{sys.planets.map(q => <tr class={sel === q.num ? 'sel' : ''} onClick={() => setSel(sel === q.num ? null : q.num)} style={{ cursor: q.numMoons ? 'pointer' : 'default' }}>
        <td><span style={{ color: PLANET_COLOR[q.type] }}>●</span> P{q.num}</td>
        <td>{PLANET_LABEL[q.type]}</td>
        <td>{fmt(q.orbit, q.orbit < 10 ? 2 : 0)} UA</td>
        <td>{q.numMoons || '—'}</td>
        <td>{q.num === main ? <b class="green">monde principal</b> : q.inHz ? <span class="green">zone habitable</span> : ''}</td>
      </tr>)}</tbody></table>
    {sel !== null && moons.length > 0 && <p class="small">{`Lunes de P${sel} : ` + moons.map(m => `P${sel}-${m.num} ${MOON_LABEL[m.type]}`).join(', ') + '.'}</p>}
    <p class="small muted">{main === undefined ? 'Monde principal : inconnu tant que le système n\'a pas été exploré.' : 'Constellations résume chaque système en un seul monde, le monde principal : celui que décrivent les valeurs du jeu. Les autres planètes et les lunes ne se gèrent pas.'}</p>
    <p class="small muted">{`Catalogue : ${g.shape!.gid} · étoile ${pl.star!.n}${g.shape!.even ? ' · répartition égale' : ''} (générateur de galaxies de Rick)`}</p>
  </Modal>;
}
