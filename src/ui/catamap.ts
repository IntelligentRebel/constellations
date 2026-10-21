// 0.3.9: the cataclysms on the map. A supernova: its star circled, the blast and the fallout rings, the year. A
// wandering black hole: the dark disc, its reach, and its course for the next twenty years (a tick every five).
import type { GameState } from '../engine/types';
import { activeCataclysms, holeAt, SN_RADIUS, SN_FALLOUT, BH_CORE, BH_REACH } from '../engine/cataclysms';

type ToScreen = (x: number, y: number) => { x: number; y: number };

export function drawCataclysms(ctx: CanvasRenderingContext2D, game: GameState, toScreen: ToScreen, z: number) {
  const t = performance.now() / 1000;
  for (const c of activeCataclysms(game)) {
    const p = toScreen(c.x, c.y);
    ctx.save();
    if (c.kind === 'supernova') {
      const left = (c.at ?? game.year) - game.year;
      const pulse = 0.5 + 0.5 * Math.sin(t * (left <= 2 ? 6 : 2));
      ctx.fillStyle = `rgba(255,90,60,${0.05 + 0.04 * pulse})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, SN_RADIUS * z, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `rgba(255,110,70,${0.55 + 0.3 * pulse})`; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, SN_RADIUS * z, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,170,90,0.45)'; ctx.setLineDash([5, 6]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, SN_FALLOUT * z, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#ffd2a0'; ctx.beginPath(); ctx.arc(p.x, p.y, 3 + 2 * pulse, 0, Math.PI * 2); ctx.fill();
      ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = '#ffb48a';
      ctx.fillText(`Supernova · ${c.at}`, p.x, p.y - SN_RADIUS * z - 6);
    } else {
      // its course
      ctx.strokeStyle = 'rgba(190,140,255,0.45)'; ctx.setLineDash([3, 7]); ctx.lineWidth = 1;
      const end = holeAt(c, 20), e = toScreen(end.x, end.y);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(e.x, e.y); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(210,180,255,0.75)';
      for (let k = 5; k <= 20; k += 5) { const q = holeAt(c, k), s = toScreen(q.x, q.y); ctx.beginPath(); ctx.arc(s.x, s.y, 2, 0, Math.PI * 2); ctx.fill(); ctx.fillText(String(game.year + k), s.x, s.y - 6); }
      ctx.fillStyle = 'rgba(150,90,255,0.08)'; ctx.beginPath(); ctx.arc(p.x, p.y, BH_REACH * z, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(170,110,255,0.4)'; ctx.setLineDash([4, 5]);
      ctx.beginPath(); ctx.arc(p.x, p.y, BH_REACH * z, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      const r = Math.max(4, BH_CORE * z);
      const g = ctx.createRadialGradient(p.x, p.y, r * 0.35, p.x, p.y, r);
      g.addColorStop(0, '#000'); g.addColorStop(0.75, '#05010a'); g.addColorStop(0.9, `rgba(200,140,255,${0.6 + 0.2 * Math.sin(t * 3)})`); g.addColorStop(1, 'rgba(120,60,200,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.font = '600 11px system-ui, sans-serif'; ctx.fillStyle = '#d6b8ff';
      ctx.fillText('Trou noir errant', p.x, p.y - BH_REACH * z - 6);
    }
    ctx.restore();
  }
}

/** What the pointer is over (for the map's tooltip). */
export function cataclysmTip(game: GameState, at: { x: number; y: number }): string[] | null {
  for (const c of activeCataclysms(game)) {
    const d = Math.hypot(at.x - c.x, at.y - c.y);
    if (c.kind === 'supernova' && d <= SN_FALLOUT) {
      const left = (c.at ?? game.year) - game.year;
      return [`Supernova annoncée pour ${c.at}`, d <= SN_RADIUS ? `Dans le souffle (${SN_RADIUS} al) : mondes, populations et flottes seront anéantis.` : `Dans les retombées (${SN_FALLOUT} al) : moitié de la population et des défenses, radiations, flottes endommagées.`, left > 1 ? `Dans ${left} ans.` : 'L\'an prochain.'];
    }
    if (c.kind === 'blackhole' && d <= BH_REACH) return ['Trou noir errant', `Chaque année, à ${BH_CORE} al ou moins : les flottes sont perdues, les mondes perdent la moitié de leur population et 30 % de leurs installations (avalés sous 4 al). Jusqu'à ${BH_REACH} al : 15 % de la population, 10 % des défenses, coques endommagées.`, `Il dérive de ${Math.round(Math.hypot(c.vx ?? 0, c.vy ?? 0))} al par an.`];
  }
  return null;
}
