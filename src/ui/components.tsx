// Small reusable UI widgets.
import type { ComponentChildren } from 'preact';
import { useState, useContext, useRef } from 'preact/hooks';
import { createContext } from 'preact';
import { store, useStore, fmt, MINERAL_COLORS } from './store';
import { planetImage, hullDataUrl, componentDataUrl } from './art';
import type { Hab, Minerals } from '../engine/types';
import { TECHS } from '../engine/tech';
import { tl } from '../data/labels';

export function Tile(props: { id: string; title: ComponentChildren; children: ComponentChildren; right?: ComponentChildren; defaultOpen?: boolean }) {
  const s = useStore();
  const open = !(s.collapsed[props.id] ?? props.defaultOpen === false);
  return (
    <section class={'tile' + (open ? '' : ' closed')}>
      <header onClick={() => { s.collapsed[props.id] = open; s.savePrefs(); s.bump(); }}>
        <span class="tw">{open ? '▾' : '▸'}</span><span class="tt">{props.title}</span>
        {props.right && <span class="tr" onClick={e => e.stopPropagation()}>{props.right}</span>}
      </header>
      {open && <div class="tile-body">{props.children}</div>}
    </section>
  );
}

export function Bar(props: { value: number; max: number; color: string; label?: ComponentChildren; warn?: boolean; height?: number; segments?: { value: number; color: string }[]; ghost?: { from: number; to: number; title?: string; bad?: boolean } }) {
  const pctv = props.max > 0 ? Math.max(0, Math.min(1, props.value / props.max)) : 0;
  const frac = (v: number) => props.max > 0 ? Math.max(0, Math.min(1, v / props.max)) : 0;
  return (
    <div class={'bar' + (props.warn ? ' warn' : '')} style={{ height: (props.height ?? 16) + 'px' }} title={props.ghost?.title}>
      {props.segments ? (() => {
        let acc = 0;
        return props.segments.map(sg => { const w = props.max > 0 ? sg.value / props.max : 0; const el = <div class="fill" style={{ left: acc * 100 + '%', width: Math.min(1 - acc, w) * 100 + '%', background: sg.color }} />; acc += w; return el; });
      })() : <div class="fill" style={{ width: (props.ghost ? frac(Math.min(props.value, props.ghost.from)) : pctv) * 100 + '%', background: props.color }} />}
      {props.ghost && props.ghost.to > props.ghost.from && <div class={'ghost' + (props.ghost.bad ? ' bad' : '')} style={{ left: frac(props.ghost.from) * 100 + '%', width: (frac(props.ghost.to) - frac(props.ghost.from)) * 100 + '%' }} />}
      {props.label !== undefined && <div class="lbl">{props.label}</div>}
    </div>
  );
}

/**
 * Warp gauge in the spirit of Stars!: a red bar filled up to the chosen speed, the value written inside.
 * Click or drag to set it; arrow keys work too. Segments above the safe speed are hatched; a notch marks the
 * engine's ideal speed. Max 11 = stargate.
 */
export function WarpBar(props: { value: number; max: number; ideal?: number; maxSafe?: number; onChange: (v: number) => void; label?: string }) {
  const { value, max, ideal, maxSafe, onChange } = props;
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const at = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.max(1, Math.min(max, Math.ceil(((clientX - r.left) / r.width) * max)));
  };
  const set = (v: number) => { if (v !== value) onChange(v); };
  const gate = value >= 11;
  const text = props.label ?? (gate ? 'Portail' : `Warp ${value}`);
  return <div ref={ref} class={'warpbar' + (gate ? ' gate' : '')} role="slider" tabIndex={0} aria-label="Vitesse" aria-valuemin={1} aria-valuemax={max} aria-valuenow={value} aria-valuetext={text}
    onPointerDown={e => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); dragging.current = true; set(at(e.clientX)); }}
    onPointerMove={e => { if (dragging.current) set(at(e.clientX)); }}
    onPointerUp={() => { dragging.current = false; }} onPointerCancel={() => { dragging.current = false; }}
    onKeyDown={e => {
      const k = e.key;
      if (k === 'ArrowRight' || k === 'ArrowUp') { e.preventDefault(); set(Math.min(max, value + 1)); }
      else if (k === 'ArrowLeft' || k === 'ArrowDown') { e.preventDefault(); set(Math.max(1, value - 1)); }
      else if (k === 'Home') { e.preventDefault(); set(1); } else if (k === 'End') { e.preventDefault(); set(max); }
    }}>
    {Array.from({ length: max }, (_, k) => {
      const n = k + 1;
      // (class names built from single words: a phrase like ' on gate' was taken for text and translated)
      const cls = 'seg' + (n <= value ? ' on' : '') + (n <= value && n === 11 ? ' gate' : '') + (maxSafe !== undefined && n > maxSafe && n < 11 ? ' over' : '') + (n === 11 ? ' portal' : '');
      return <i class={cls} title={n === 11 ? 'Portail stellaire' : `Warp ${n}${n === ideal ? ' · vitesse idéale' : ''}${maxSafe !== undefined && n > maxSafe && n < 11 ? ' · au-delà de la vitesse sûre' : ''}`} />;
    })}
    {ideal !== undefined && ideal >= 1 && ideal <= max && ideal < 11 && <b class="ideal" style={{ left: ((ideal - 0.5) / max) * 100 + '%' }} title={`Vitesse idéale du moteur : Warp ${ideal}`} />}
    <span class="wtxt">{text}</span>
  </div>;
}

export function PlanetImg(props: { id: number; hab?: Hab; size?: number; owned?: boolean }) {
  return <img class="planet-img" src={planetImage(props.id, props.hab, props.size ?? 72, props.owned)} width={props.size ?? 72} height={props.size ?? 72} alt="" />;
}

export function HullImg(props: { hull: string; color?: string; w?: number }) {
  const w = props.w ?? 90;
  return <img class="hull-img" src={hullDataUrl(props.hull, props.color)} width={w} height={w * 2 / 3} alt={tl(props.hull)} />;
}

export function CompIcon(props: { name: string; size?: number }) {
  const t = TECHS.get(props.name);
  const tier = t ? Math.min(5, Math.floor((t.req.en + t.req.we + t.req.pr + t.req.co + t.req.el + t.req.bi) / 6)) : 0;
  return <img class="comp-icon" src={componentDataUrl(t?.cat ?? '', t?.tags, tier)} width={props.size ?? 32} height={props.size ?? 32} alt={tl(props.name)} title={tl(props.name)} draggable={false} />;
}

export function MineralLine(props: { m: Minerals; unit?: string; compact?: boolean }) {
  return (
    <span class="mins">
      <span style={{ color: MINERAL_COLORS.ironium }}>{fmt(props.m.ironium)}</span>/
      <span style={{ color: MINERAL_COLORS.boranium }}>{fmt(props.m.boranium)}</span>/
      <span style={{ color: MINERAL_COLORS.germanium }}>{fmt(props.m.germanium)}</span>{props.unit ?? ''}
    </span>
  );
}

export function Cost(props: { c: { ironium: number; boranium: number; germanium: number; resources: number } }) {
  return <span class="cost"><MineralLine m={props.c} /> kt · <b>{fmt(props.c.resources)}</b> R</span>;
}

export function Num(props: { value: number; min?: number; max?: number; step?: number; onChange: (v: number) => void; width?: number }) {
  return <input type="number" class="num" value={props.value} min={props.min} max={props.max} step={props.step ?? 1} style={{ width: (props.width ?? 70) + 'px' }}
    onChange={e => { const v = +(e.target as HTMLInputElement).value; if (Number.isFinite(v)) props.onChange(v); }} />;
}

export function Row(props: { k: ComponentChildren; v: ComponentChildren; cls?: string; title?: string }) {
  return <div class={'row ' + (props.cls ?? '')} title={props.title}><span class="k">{props.k}</span><span class="v">{props.v}</span></div>;
}

/** Set by the page container: dialogs rendered inside a page lay out as a page, not as a floating window. */
export const PageCtx = createContext(false);

export function Modal(props: { title: ComponentChildren; onClose?: () => void; children: ComponentChildren; wide?: boolean; width?: number; footer?: ComponentChildren; cls?: string; keepFooter?: boolean; sub?: ComponentChildren; actions?: ComponentChildren }) {
  const page = useContext(PageCtx);
  const close = props.onClose ?? (() => store.close());
  if (page) {
    return (
      <section class={'page ' + (props.cls ?? '')}>
        <header class="page-head"><div><h2>{props.title}</h2>{props.sub && <div class="page-sub">{props.sub}</div>}</div>{props.actions && <div class="page-actions">{props.actions}</div>}</header>
        <div class="page-body">{props.children}</div>
        {props.footer && props.keepFooter && <footer class="page-foot">{props.footer}</footer>}
      </section>
    );
  }
  return (
    <div class="modal-back" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
      <div class={'modal ' + (props.wide ? 'wide ' : '') + (props.cls ?? '')} style={props.width ? { width: props.width + 'px' } : undefined}>
        <header><h2>{props.title}</h2>{props.actions && <div class="page-actions">{props.actions}</div>}<button class="x" onClick={close} title="Fermer (Échap)">✕</button></header>
        <div class="modal-body">{props.children}</div>
        {props.footer && <footer>{props.footer}</footer>}
      </div>
    </div>
  );
}

export function Tabs<T extends string>(props: { tabs: { id: T; label: ComponentChildren }[]; value: T; onChange: (t: T) => void }) {
  return <div class="tabs">{props.tabs.map(t => <button class={t.id === props.value ? 'on' : ''} onClick={() => props.onChange(t.id)}>{t.label}</button>)}</div>;
}

export function Help(props: { text: string }) {
  const [open, setOpen] = useState(false);
  return <span class="help-q" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>?{open && <span class="help-pop">{props.text}</span>}</span>;
}

export function HabBar(props: { label: string; value?: number; base?: number; best?: number; lo: number; hi: number; immune: boolean; text: string; color: string }) {
  return (
    <div class="habbar">
      <span class="hl">{props.label}</span>
      <div class="track">
        {props.immune ? <div class="range immune" style={{ left: '0%', width: '100%' }} /> : <div class="range" style={{ left: props.lo + '%', width: Math.max(1, props.hi - props.lo) + '%', background: props.color }} />}
        {props.base !== undefined && props.base !== props.value && <div class="mark base" style={{ left: props.base + '%' }} />}
        {props.best !== undefined && props.best !== props.value && <div class="mark best" style={{ left: props.best + '%' }} />}
        {props.value !== undefined && <div class="mark" style={{ left: props.value + '%' }} />}
      </div>
      <span class="hv">{props.text}</span>
    </div>
  );
}

// ---------------------------------------------------------------- sortable tables

export interface SortKey<T> { key: string; get: (r: T) => number | string; num?: boolean; /** first click sorts ascending (the smallest is the best) */ asc?: boolean }

/**
 * Sorting for hand-built tables (the generic SortTable cannot hold expandable rows): click a header to sort by it,
 * click again to reverse. Ties keep the incoming order, so callers pre-sort rows by their natural ranking.
 */
export function useSorted<T>(rows: T[], keys: SortKey<T>[], initial: string, initialDir = -1) {
  const [sort, setSort] = useState<{ key: string; dir: number }>({ key: initial, dir: initialDir });
  // an initial key with no column keeps the incoming order until a header is clicked
  const col = keys.find(c => c.key === sort.key);
  const idx = new Map(rows.map((r, i) => [r, i]));
  const sorted = col ? [...rows].sort((a, b) => {
    const x = col.get(a), y = col.get(b);
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'fr');
    return c * sort.dir || (idx.get(a)! - idx.get(b)!);
  }) : rows;
  const th = (key: string, label: ComponentChildren, opts: { num?: boolean; title?: string } = {}) => {
    const k = keys.find(c => c.key === key);
    const on = sort.key === key;
    return <th class={(opts.num ?? k?.num ? 'num ' : '') + 'sortable' + (on ? ' sorted' : '')} title={opts.title ? `${opts.title} · cliquer pour trier` : 'Cliquer pour trier'}
      aria-sort={on ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}
      onClick={() => setSort({ key, dir: on ? -sort.dir : (k?.num && !k.asc ? -1 : 1) })}>{label}<span class="sort-ar">{on ? (sort.dir > 0 ? ' ▲' : ' ▼') : ' ↕'}</span></th>;
  };
  /** a sort switch inside a header cell (sub-keys of one column) */
  const btn = (key: string, label: ComponentChildren, title?: string) => {
    const k = keys.find(c => c.key === key);
    const on = sort.key === key;
    return <button class={'sort-btn' + (on ? ' on' : '')} title={title ?? 'Trier'} onClick={e => { e.stopPropagation(); setSort({ key, dir: on ? -sort.dir : (k?.num && !k.asc ? -1 : 1) }); }}>{label}{on ? (sort.dir > 0 ? '▲' : '▼') : ''}</button>;
  };
  return { sorted, th, btn, sort };
}

// ---------------------------------------------------------------- distance filter of the planners

export interface RangeSetting { max: number | null; from: number }

export function rangeOf(page: string): RangeSetting { return store.view.ranges?.[page] ?? { max: null, from: -1 }; }
export function setRangeOf(page: string, r: RangeSetting) { setRange(page, r); }
function setRange(page: string, r: RangeSetting) { store.view.ranges = { ...(store.view.ranges ?? {}), [page]: r }; store.savePrefs(); store.bump(); }

/** Distance used by the filter: to the chosen planet, or to the nearest of your colonies. */
export function rangeDistance(r: RangeSetting, own: { id: number; x: number; y: number; name: string }[], pl: { x: number; y: number }): { d: number; ref: { id: number; name: string } | null } {
  const fixed = r.from >= 0 ? own.find(o => o.id === r.from) : undefined;
  const list = fixed ? [fixed] : own;
  let ref: typeof own[number] | null = null, d = Infinity;
  for (const o of list) { const x = Math.hypot(o.x - pl.x, o.y - pl.y); if (x < d) { d = x; ref = o; } }
  return { d, ref };
}

export function RangeFilter({ page, own }: { page: string; own: { id: number; name: string; pop: number }[] }) {
  useStore();
  const r = rangeOf(page);
  const from = r.from >= 0 && own.some(o => o.id === r.from) ? r.from : -1;
  return <div class="range-filter">
    <label class="field" title="Ne montrer que les mondes à moins de cette distance (vide : aucune limite)">Rayon max
      <span class="range-in"><input type="number" min={0} step={10} placeholder="illimité" value={r.max ?? ''} onInput={e => { const v = (e.target as HTMLInputElement).value; setRange(page, { ...r, from, max: v === '' ? null : Math.max(0, +v) }); }} /> al</span></label>
    <label class="field">autour de
      <select value={from} onChange={e => setRange(page, { ...r, from: +(e.target as HTMLSelectElement).value })}>
        <option value={-1}>la plus proche de vos colonies</option>
        {[...own].sort((a, b) => b.pop - a.pop).map(o => <option value={o.id}>{o.name}</option>)}
      </select></label>
    {[100, 200, 300].map(v => <button class={'small ghost' + (r.max === v ? ' on' : '')} onClick={() => setRange(page, { ...r, from, max: r.max === v ? null : v })}>{v} al</button>)}
  </div>;
}
