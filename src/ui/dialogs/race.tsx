// Race wizard (6 steps, Stars! rules) and race viewer.
import { useState } from 'preact/hooks';
import { store, useStore, fmt, fmtPeople } from '../store';
import { Modal, Row, Num } from '../components';
import type { Field, LRT, PRT, Race, ResearchCostLevel, LeftoverSpend } from '../../engine/types';
import { FIELDS } from '../../engine/types';
import { PRT_INFO, LRT_INFO, PRT_LIST, LRT_LIST, PREDEFINED_RACES, PREDEFINED_ORDER, PREDEFINED_LABELS, advantagePoints, habString, HAB_NAMES, cloneRace, habitableFraction, habCenter, sanitizeRace } from '../../engine/race';
import { FIELD_NAMES } from '../../engine/tech';
import { RACE_ICONS } from '../art';
import { BASE_ICONS, iconUnlocked, iconAchievement } from '../achievements';
import { Rng, seedFromString } from '../../engine/rng';

const LEFTOVER: Record<LeftoverSpend, string> = { surfaceMinerals: 'Minerais en surface', mines: 'Mines', factories: 'Usines', defenses: 'Défenses', mineralConcentrations: 'Concentrations de minerais' };

const RACES_KEY = 'constellations.v1.races';
/** custom races remembered in this browser (best effort) */
export function savedRaces(): Race[] {
  try { const a = JSON.parse(localStorage.getItem(RACES_KEY) ?? '[]'); return Array.isArray(a) ? a.map(r => sanitizeRace(r)).filter((r): r is Race => typeof r !== 'string') : []; } catch { return []; }
}
export function saveRace(r: Race) {
  try { const a = savedRaces().filter(x => x.name !== r.name); a.unshift(r); localStorage.setItem(RACES_KEY, JSON.stringify(a.slice(0, 20))); } catch { /* ignore */ }
}

export function randomRace(seed = Math.random().toString()): Race {
  const rng = new Rng(seedFromString(seed));
  for (let attempt = 0; attempt < 400; attempt++) {
    const r = PREDEFINED_RACES.Humanoid();
    r.prt = rng.pick(PRT_LIST);
    r.lrts = LRT_LIST.filter(() => rng.chance(0.18));
    if (r.lrts.includes('OBRM') && r.lrts.includes('ARM')) r.lrts = r.lrts.filter(l => l !== 'ARM');
    for (let i = 0; i < 3; i++) {
      r.immune[i] = rng.chance(0.08);
      const w = 20 + rng.int(60), c = 15 + rng.int(70);
      r.habLow[i] = Math.max(0, c - Math.trunc(w / 2)); r.habHigh[i] = Math.min(100, c + Math.trunc(w / 2));
    }
    r.growthRate = 10 + rng.int(9);
    r.popEfficiency = 8 + rng.int(6);
    r.factoryOutput = 8 + rng.int(6); r.factoryCost = 8 + rng.int(6); r.numFactories = 8 + rng.int(8);
    r.mineOutput = 8 + rng.int(6); r.mineCost = 3 + rng.int(6); r.numMines = 8 + rng.int(8);
    for (const f of FIELDS) r.researchCost[f] = rng.pick(['less', 'standard', 'standard', 'extra'] as ResearchCostLevel[]);
    if (r.prt === 'AR') { r.factoryOutput = 0; r.factoryCost = 0; r.numFactories = 0; r.mineOutput = 0; r.mineCost = 0; r.numMines = 0; }
    r.name = rng.pick(['Zorgien', 'Vélarien', 'Krokin', 'Lumen', 'Osmien', 'Tessaride', 'Quorlien', 'Hydrien']);
    r.pluralName = r.name + 's';
    r.icon = rng.int(BASE_ICONS);
    const pts = advantagePoints(r);
    if (pts >= 0 && pts < 60) return r;
  }
  return PREDEFINED_RACES.Humanoid();
}

export function RaceWizard({ initial, onDone, onCancel }: { initial?: Race; onDone: (r: Race) => void; onCancel: () => void }) {
  const [r, setR] = useState<Race>(initial ? cloneRace(initial) : PREDEFINED_RACES.Humanoid());
  const [step, setStep] = useState(1);
  const [preset, setPreset] = useState<string>('Humanoid');
  const [hoverTrait, setHoverTrait] = useState<string | null>(null);
  const pts = advantagePoints(r);
  const upd = (fn: (x: Race) => void) => { const c = cloneRace(r); fn(c); setR(c); setPreset('Custom'); };
  const isAR = r.prt === 'AR';
  return (
    <Modal title={`Assistant de race · étape ${step} sur 6`} wide onClose={onCancel} cls="wizard" footer={<>
      <span class={'adv ' + (pts < 0 ? 'neg' : '')} title="Points d'avantage restants : doivent rester positifs">Points d'avantage restants : <b>{pts}</b></span>
      <span class="sp" />
      <button onClick={onCancel}>Annuler</button>
      <button disabled={step === 1} onClick={() => setStep(step - 1)}>◀ Précédent</button>
      <button disabled={step === 6} onClick={() => setStep(step + 1)}>Suivant ▶</button>
      <button class="primary" disabled={pts < 0 || !r.name.trim()} onClick={() => onDone(r)} title={pts < 0 ? 'Il faut des points d\'avantage positifs' : ''}>Terminer</button>
    </>}>
      <div class="wiz-steps">{[1, 2, 3, 4, 5, 6].map(i => <button class={i === step ? 'on' : ''} onClick={() => setStep(i)}>{['Identité', 'Trait principal', 'Traits secondaires', 'Environnement', 'Économie', 'Recherche'][i - 1]}</button>)}</div>
      {step === 1 && <div class="wiz">
        <div class="form2">
          <label>Nom de la race</label><input value={r.name} onInput={e => upd(x => { x.name = (e.target as HTMLInputElement).value; })} />
          <label>Nom au pluriel</label><input value={r.pluralName} onInput={e => upd(x => { x.pluralName = (e.target as HTMLInputElement).value; })} />
          <label>Emblème</label><div class="icons">{RACE_ICONS.map((ic, i) => iconUnlocked(i) ? <button class={r.icon === i ? 'on' : ''} onClick={() => upd(x => { x.icon = i; })}>{ic}</button> : <button class="locked" disabled title={`Débloqué par le succès « ${iconAchievement(i)?.name ?? '?'} »`}>{ic}</button>)}</div>
        </div>
        <h4>Races prédéfinies</h4>
        <div class="presets">
          {PREDEFINED_ORDER.map(k => <label class="radio"><input type="radio" checked={preset === k} onChange={() => { setR(PREDEFINED_RACES[k]()); setPreset(k); }} /> {PREDEFINED_LABELS[k]} <span class="muted small">({PRT_INFO[PREDEFINED_RACES[k]().prt].code}, {advantagePoints(PREDEFINED_RACES[k]())} pts)</span></label>)}
          <label class="radio"><input type="radio" checked={preset === 'Random'} onChange={() => { setR(randomRace()); setPreset('Random'); }} /> Aléatoire</label>
          <label class="radio"><input type="radio" checked={preset === 'Custom'} onChange={() => setPreset('Custom')} /> Personnalisée</label>
        </div>
        <Row k="Dépenser jusqu'à 50 points restants en" v={<select value={r.leftover} onChange={e => upd(x => { x.leftover = (e.target as HTMLSelectElement).value as LeftoverSpend; })}>{Object.entries(LEFTOVER).map(([k, l]) => <option value={k}>{l}</option>)}</select>} />
      </div>}
      {step === 2 && <div class="wiz two">
        <div class="traits">{PRT_LIST.map(p => <label class="radio" onMouseEnter={() => setHoverTrait(p)}><input type="radio" checked={r.prt === p} onChange={() => upd(x => { x.prt = p as PRT; if (p === 'AR') { x.factoryOutput = 0; x.factoryCost = 0; x.numFactories = 0; x.mineOutput = 0; x.mineCost = 0; x.numMines = 0; } else if (x.numFactories === 0) { x.factoryOutput = 10; x.factoryCost = 10; x.numFactories = 10; x.mineOutput = 10; x.mineCost = 5; x.numMines = 10; } })} /> {PRT_INFO[p].name}</label>)}</div>
        <div class="trait-desc"><h4>{PRT_INFO[(hoverTrait && hoverTrait in PRT_INFO ? hoverTrait : r.prt) as PRT].name}</h4><p>{PRT_INFO[(hoverTrait && hoverTrait in PRT_INFO ? hoverTrait : r.prt) as PRT].desc}</p></div>
      </div>}
      {step === 3 && <div class="wiz two">
        <div class="traits">{LRT_LIST.map(l => <label class="chk" onMouseEnter={() => setHoverTrait(l)}><input type="checkbox" checked={r.lrts.includes(l)} onChange={e => upd(x => { const on = (e.target as HTMLInputElement).checked; x.lrts = on ? [...x.lrts.filter(y => !(l === 'ARM' && y === 'OBRM') && !(l === 'OBRM' && y === 'ARM')), l as LRT] : x.lrts.filter(y => y !== l); })} /> {LRT_INFO[l].name}</label>)}</div>
        <div class="trait-desc">{hoverTrait && hoverTrait in LRT_INFO ? <><h4>{LRT_INFO[hoverTrait as LRT].name}</h4><p>{LRT_INFO[hoverTrait as LRT].desc}</p></> : <p class="muted">Survolez un trait pour sa description. Les traits avantageux coûtent des points, les handicaps en rapportent.</p>}</div>
      </div>}
      {step === 4 && <div class="wiz">
        {[0, 1, 2].map(i => <HabEditor i={i} r={r} upd={upd} />)}
        <Row k="Taux de croissance maximal des colons par an" v={<><Num value={r.growthRate} min={1} max={20} onChange={v => upd(x => { x.growthRate = Math.max(1, Math.min(20, v)); })} width={60} /> %</>} />
        <p class="muted">{r.immune.every(Boolean) ? 'Toutes les planètes seront habitables pour votre race.' : `Environ une planète sur ${Math.max(1, Math.round(1 / Math.max(0.0001, habitableFraction(r))))} sera habitable pour votre race.`}</p>
      </div>}
      {step === 5 && <div class="wiz">
        {isAR && <p class="alert">Les races « Réalité alternative » n'ont ni usines ni mines : leur production dépend de l'habitabilité et de l'Énergie.</p>}
        <div class="econ">
          <EconRow label="Une ressource produite chaque année pour" unit="colons" v={r.popEfficiency * 100} min={700} max={2500} step={100} on={v => upd(x => { x.popEfficiency = v / 100; })} />
          <EconRow disabled={isAR} label="10 usines produisent" unit="ressources par an" v={r.factoryOutput} min={5} max={15} on={v => upd(x => { x.factoryOutput = v; })} />
          <EconRow disabled={isAR} label="Une usine coûte" unit="ressources" v={r.factoryCost} min={5} max={25} on={v => upd(x => { x.factoryCost = v; })} />
          <EconRow disabled={isAR} label="10 000 colons exploitent jusqu'à" unit="usines" v={r.numFactories} min={5} max={25} on={v => upd(x => { x.numFactories = v; })} />
          <label class="chk"><input type="checkbox" disabled={isAR} checked={r.factoriesCostLess} onChange={e => upd(x => { x.factoriesCostLess = (e.target as HTMLInputElement).checked; })} /> Les usines coûtent 1 kt de Germanium en moins</label>
          <EconRow disabled={isAR} label="10 mines extraient jusqu'à" unit="kt de chaque minerai par an" v={r.mineOutput} min={5} max={25} on={v => upd(x => { x.mineOutput = v; })} />
          <EconRow disabled={isAR} label="Une mine coûte" unit="ressources" v={r.mineCost} min={2} max={15} on={v => upd(x => { x.mineCost = v; })} />
          <EconRow disabled={isAR} label="10 000 colons exploitent jusqu'à" unit="mines" v={r.numMines} min={5} max={25} on={v => upd(x => { x.numMines = v; })} />
        </div>
      </div>}
      {step === 6 && <div class="wiz">
        <div class="research-costs">{FIELDS.map(f => <div class="rc"><h4>{FIELD_NAMES[f]}</h4>{(['extra', 'standard', 'less'] as ResearchCostLevel[]).map(l => <label class="radio"><input type="radio" checked={r.researchCost[f] === l} onChange={() => upd(x => { x.researchCost[f as Field] = l; })} /> {l === 'extra' ? 'Coûte 75 % de plus' : l === 'less' ? 'Coûte 50 % de moins' : 'Coût standard'}</label>)}</div>)}</div>
        <label class="chk"><input type="checkbox" checked={r.techsStartHigh} onChange={e => upd(x => { x.techsStartHigh = (e.target as HTMLInputElement).checked; })} /> Les domaines « +75 % » commencent au niveau 3 (4 pour Touche-à-tout)</label>
      </div>}
    </Modal>
  );
}

function EconRow({ label, unit, v, min, max, step, on, disabled }: { label: string; unit: string; v: number; min: number; max: number; step?: number; on: (v: number) => void; disabled?: boolean }) {
  return <div class={'econ-row' + (disabled ? ' dis' : '')}><span>{label}</span><Num value={v} min={min} max={max} step={step} onChange={x => on(Math.max(min, Math.min(max, step ? min + Math.round((x - min) / step) * step : Math.round(x))))} width={74} /><span class="muted">{unit}</span></div>;
}

function HabEditor({ i, r, upd }: { i: number; r: Race; upd: (fn: (x: Race) => void) => void }) {
  const lo = r.habLow[i], hi = r.habHigh[i], imm = r.immune[i];
  const shift = (d: number) => upd(x => { if (x.habLow[i] + d < 0 || x.habHigh[i] + d > 100) return; x.habLow[i] += d; x.habHigh[i] += d; });
  const grow = (d: number) => upd(x => { const nl = x.habLow[i] - d, nh = x.habHigh[i] + d; if (nh - nl < 0) return; x.habLow[i] = Math.max(0, nl); x.habHigh[i] = Math.min(100, nh); });
  const colors = ['#3b6fe0', '#c23b3b', '#2fa35a'];
  return <div class="hab-ed">
    <div class="hab-top"><b>{HAB_NAMES[i]}</b><span class="muted">{imm ? 'Immunisé' : `${habString(i, lo)} à ${habString(i, hi)} · centre ${habString(i, habCenter(r)[i])}`}</span></div>
    <div class="hab-row">
      <button disabled={imm} onClick={() => shift(-1)} title="Décaler à gauche">◀</button>
      <div class="hab-track">{!imm && <div class="hab-range" style={{ left: lo + '%', width: (hi - lo) + '%', background: colors[i] }} />}{imm && <div class="hab-range immune" style={{ left: '0%', width: '100%' }} />}</div>
      <button disabled={imm} onClick={() => shift(1)} title="Décaler à droite">▶</button>
    </div>
    <div class="hab-row small">
      <button disabled={imm} onClick={() => grow(1)}>« Élargir »</button>
      <label class="chk"><input type="checkbox" checked={imm} onChange={e => upd(x => { x.immune[i] = (e.target as HTMLInputElement).checked; })} /> Immunisé à la {HAB_NAMES[i].toLowerCase()}</label>
      <button disabled={imm} onClick={() => grow(-1)}>» Rétrécir «</button>
    </div>
  </div>;
}

export function RaceView() {
  const s = useStore();
  const g = s.game!, me = s.me!;
  const r = me.race;
  const set = g.settings;
  return (
    <Modal title={`Race : ${r.pluralName}`} wide onClose={() => s.close('raceView')}>
      <div class="raceview">
        <div>
          <h4>{RACE_ICONS[r.icon % RACE_ICONS.length]} {r.name} · {PRT_INFO[r.prt].name}</h4>
          <p class="small">{PRT_INFO[r.prt].desc}</p>
          <h4>Traits secondaires</h4>
          {r.lrts.length ? <ul class="small">{r.lrts.map(l => <li><b>{LRT_INFO[l].name}</b> · {LRT_INFO[l].desc}</li>)}</ul> : <p class="muted small">Aucun</p>}
        </div>
        <div>
          <h4>Environnement</h4>
          {[0, 1, 2].map(i => <Row k={HAB_NAMES[i]} v={r.immune[i] ? 'immunisé' : `${habString(i, r.habLow[i])} – ${habString(i, r.habHigh[i])}`} />)}
          <Row k="Croissance max." v={`${r.growthRate} % / an`} />
          <h4>Économie</h4>
          <Row k="Colons par ressource" v={fmtPeople(r.popEfficiency * 100)} />
          {r.prt !== 'AR' && <><Row k="Usines" v={`${r.factoryOutput} R / 10 usines · coût ${r.factoryCost} R${r.factoriesCostLess ? ' (−1 kt Ge)' : ''} · ${r.numFactories} pour 10 000 colons`} />
            <Row k="Mines" v={`${r.mineOutput} kt / 10 mines · coût ${r.mineCost} R · ${r.numMines} pour 10 000 colons`} /></>}
          <h4>Recherche</h4>
          {FIELDS.map(f => <Row k={FIELD_NAMES[f]} v={r.researchCost[f] === 'less' ? '−50 %' : r.researchCost[f] === 'extra' ? '+75 %' : 'standard'} />)}
        </div>
        <div>
          <h4>Paramètres de la partie</h4>
          <Row k="Nom" v={g.name} />
          <Row k="Univers" v={`${set.size} · densité ${set.density} · ${g.planets.length} planètes`} />
          <Row k="Positions" v={set.positions} />
          <Row k="Graine" v={set.seed} />
          <Row k="Événements aléatoires" v={set.randomEvents ? 'oui' : 'non'} />
          <Row k="Contacts anonymes" v={set.anonymousContacts ? 'oui (scanner pénétrant requis)' : 'non (identification dès la détection)'} />
          <Row k="Points d'avantage" v={advantagePoints(r)} />
        </div>
      </div>
    </Modal>
  );
}

export { store };
