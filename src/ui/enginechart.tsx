// Engine fuel chart, after the Stars! technology browser ("Fuel Usage vs. Warp Speed"): fuel burned per
// light-year at each warp, on a doubling scale (25, 50, 100, 200, 400, 800 %), with the ideal speed, the free
// zone of ramscoops and the overspeed zone marked. Optional second engine for comparison.
import { useState } from 'preact/hooks';
import type { TechData } from '../data/types';
import { tl } from '../data/labels';

const THIS = '#22a0ad';   // validated pair on the dark surface (OKLCH L 0.48-0.67, CVD dE 17)
const OTHER = '#bf7a26';
const TICKS = [25, 50, 100, 200, 400, 800];

/** Doubling scale: 0 at the baseline, 25 % one step up, then one step per doubling. */
function yv(v: number): number { return v <= 0 ? 0 : v < 25 ? v / 25 : 1 + Math.log2(v / 25); }

export function EngineChart({ engine, compare, compareLabel = 'votre meilleur', width = 330, height = 172, compact = false }: { engine: TechData; compare?: TechData; compareLabel?: string; width?: number; height?: number; compact?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const e = engine.engine!;
  const c = compare?.engine;
  const padL = compact ? 4 : 40, padR = compact ? 4 : 8, padT = compact ? 4 : 22, padB = compact ? 4 : 20;
  const W = width - padL - padR, H = height - padT - padB;
  const yMax = 6.6;
  const x = (w: number) => padL + (w / 10) * W;
  const y = (v: number) => padT + H - (Math.min(yv(v), yMax) / yMax) * H;
  const path = (fuel: number[]) => fuel.map((v, w) => `${w ? 'L' : 'M'}${x(w).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const freeTo = e.scoop ? e.free : 0;
  const hw = hover !== null ? hover : null;
  const pctTxt = (v: number) => v <= 0 ? 'gratuit' : `${v} %`;
  return <div class={'engchart' + (compact ? ' compact' : '')}>
    {!compact && <div class="ec-head">
      <span class="ec-title">Consommation</span>
      <span class="ec-read">{hw !== null ? <>Warp {hw} : <b>{pctTxt(e.fuel[hw])}</b>{c ? <> · actuel {pctTxt(c.fuel[hw])}</> : ''}</> : <span class="muted">survolez le graphique</span>}</span>
    </div>}
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Consommation de ${tl(engine.name)} : ${e.fuel.slice(1).map((v, i) => `Warp ${i + 1} ${pctTxt(v)}`).join(', ')}`}>
      <defs>
        <pattern id="ec-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="rgba(255,122,89,0.06)" /><line x1="0" y1="0" x2="0" y2="6" stroke="rgba(255,122,89,0.35)" stroke-width="2" /></pattern>
      </defs>
      {/* zones: free (ramscoop) and over the safe speed */}
      {freeTo > 1 && <rect x={x(0)} y={padT} width={x(freeTo) - x(0)} height={H} fill="rgba(94,224,138,0.08)" />}
      {e.maxSafe < 10 && <rect x={x(e.maxSafe)} y={padT} width={x(10) - x(e.maxSafe)} height={H} fill="url(#ec-hatch)" />}
      {/* grid: doubling ticks, 100 % reference a step brighter */}
      {!compact && TICKS.map(t => <g>
        <line x1={padL} x2={padL + W} y1={y(t)} y2={y(t)} stroke={t === 100 ? '#3a4d66' : '#1c2a3c'} stroke-width="1" />
        <text x={padL - 5} y={y(t) + 3.5} text-anchor="end" class="ec-tick">{t} %</text>
      </g>)}
      <line x1={padL} x2={padL + W} y1={padT + H} y2={padT + H} stroke="#2a3b52" stroke-width="1" />
      {!compact && Array.from({ length: 11 }, (_, w) => <text x={x(w)} y={height - 5} text-anchor="middle" class={'ec-tick' + (w === e.ideal ? ' ideal' : '')}>{w}</text>)}
      {!compact && <text x={padL - 5} y={height - 5} text-anchor="end" class="ec-tick">W</text>}
      {/* ideal speed */}
      <line x1={x(e.ideal)} x2={x(e.ideal)} y1={padT} y2={padT + H} stroke={THIS} stroke-width="1" stroke-dasharray="2 3" opacity="0.7" />
      {/* comparison engine (dashed: second encoding besides the hue) */}
      {c && <path d={path(c.fuel)} fill="none" stroke={OTHER} stroke-width="2" stroke-dasharray="5 3" stroke-linejoin="round" stroke-linecap="round" />}
      <path d={path(e.fuel)} fill="none" stroke={THIS} stroke-width={compact ? 1.6 : 2} stroke-linejoin="round" stroke-linecap="round" />
      <circle cx={x(e.ideal)} cy={y(e.fuel[e.ideal])} r={compact ? 3 : 4.5} fill={THIS} stroke="#101c2c" stroke-width="2" />
      {!compact && <text x={x(e.ideal) + (e.ideal >= 9 ? -6 : 6)} y={Math.max(padT + 9, y(e.fuel[e.ideal]) - 7)} text-anchor={e.ideal >= 9 ? 'end' : 'start'} class="ec-lbl">idéal W{e.ideal}</text>}
      {!compact && freeTo > 1 && <text x={x(freeTo / 2)} y={padT + 11} text-anchor="middle" class="ec-zone good">gratuit</text>}
      {!compact && e.maxSafe < 10 && <text x={(x(e.maxSafe) + x(10)) / 2} y={padT + H - 5} text-anchor="middle" class="ec-zone bad">risque</text>}
      {/* hover: crosshair and readout */}
      {!compact && hw !== null && <g pointer-events="none">
        <line x1={x(hw)} x2={x(hw)} y1={padT} y2={padT + H} stroke="#8b99ae" stroke-width="1" />
        {c && <circle cx={x(hw)} cy={y(c.fuel[hw])} r="4" fill={OTHER} stroke="#101c2c" stroke-width="2" />}
        <circle cx={x(hw)} cy={y(e.fuel[hw])} r="4.5" fill={THIS} stroke="#101c2c" stroke-width="2" />
      </g>}
      {!compact && Array.from({ length: 10 }, (_, k) => k + 1).map(w => <rect x={x(w - 0.5)} y={padT} width={W / 10} height={H} fill="transparent" onMouseEnter={() => setHover(w)} onMouseLeave={() => setHover(null)} />)}
    </svg>
    {!compact && <div class="ec-legend">
      <span><i class="sw" style={{ background: THIS }} />{tl(engine.name)}</span>
      {c && <span><i class="sw dash" style={{ borderColor: OTHER }} />{tl(compare!.name)} ({compareLabel})</span>}
    </div>}
    {!compact && <div class="ec-note">Carburant brûlé par année-lumière ; chaque graduation double la consommation. {freeTo > 1 ? `Jusqu'à Warp ${freeTo}, le statoréacteur vole sans carburant. ` : ''}{e.maxSafe < 10 ? `Au-delà de Warp ${e.maxSafe}, des vaisseaux peuvent exploser.` : ''}</div>}
  </div>;
}
