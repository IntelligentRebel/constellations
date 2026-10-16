// 0.3.9: display and sound, for this browser (every game): text size, colours for colour blindness, music and signals.
import { useEffect, useState } from 'preact/hooks';
import { store } from '../store';
import { Modal } from '../components';
import { uiPrefs, setPrefs, onPrefs, TEXT_SCALES, type ColorMode } from '../prefs';
import { play, audioStarted } from '../audio';

const COLOR_MODES: { id: ColorMode; label: string; note: string }[] = [
  { id: 'normal', label: 'Couleurs standard', note: 'Vert pour ce qui va bien, rouge pour les ennemis et les dangers.' },
  { id: 'rg', label: 'Daltonisme rouge-vert', note: 'Deutéranopie, protanopie : le bleu remplace le vert, l\'orange remplace le rouge. Les couleurs des empires suivent une palette distinguable.' },
  { id: 'by', label: 'Daltonisme bleu-jaune', note: 'Tritanopie : vert d\'eau contre rose et rouge, les empires dans une palette adaptée.' },
];

export function PrefsDialog() {
  const [, tick] = useState(0);
  useEffect(() => onPrefs(() => tick(x => x + 1)), []);
  const p = uiPrefs;
  const pct = (v: number) => `${Math.round(v * 100)} %`;
  return <Modal title="Affichage et son" width={560} onClose={() => store.close('prefs')}>
    <p class="small muted">Réglages de ce navigateur, valables pour toutes les parties.</p>
    <h4>Taille du texte</h4>
    <div class="prefs-row">
      <div class="zoomgrp">{TEXT_SCALES.map(z => <button class={p.textScale === z ? 'primary' : ''} onClick={() => setPrefs({ textScale: z })}>{pct(z)}</button>)}</div>
    </div>
    <p class="small muted">Agrandit toute l'interface, carte comprise.</p>
    <h4>Couleurs</h4>
    {COLOR_MODES.map(m => <label class="radio"><input type="radio" name="cb" checked={p.colors === m.id} onChange={() => { setPrefs({ colors: m.id }); store.bump(); }} /> <span><b>{m.label}</b><br /><span class="small muted">{m.note}</span></span></label>)}
    <h4>Son</h4>
    <label class="chk"><input type="checkbox" checked={p.sound} onChange={e => setPrefs({ sound: (e.target as HTMLInputElement).checked })} /> Son activé</label>
    <div class="prefs-row"><span class="k">Musique</span><input type="range" min={0} max={1} step={0.05} value={p.music} disabled={!p.sound} onInput={e => setPrefs({ music: +(e.target as HTMLInputElement).value })} /><span class="small">{pct(p.music)}</span></div>
    <div class="prefs-row"><span class="k">Signaux</span><input type="range" min={0} max={1} step={0.05} value={p.sfx} disabled={!p.sound} onInput={e => setPrefs({ sfx: +(e.target as HTMLInputElement).value })} onChange={() => play('tech')} /><span class="small">{pct(p.sfx)}</span>
      <button class="ghost" disabled={!p.sound} onClick={() => { play('colony'); play('tech', 0.7); }}>Essayer</button></div>
    <p class="small muted">Une musique d'ambiance composée en direct, qui s'assombrit quand la guerre menace et se tend en pleine crise, et quelques signaux brefs : découverte, colonie, bataille, alerte. {!audioStarted() && 'Le son démarre au premier clic (règle des navigateurs).'}</p>
  </Modal>;
}
