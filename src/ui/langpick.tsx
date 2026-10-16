// Language picker (welcome screen and the "⋯" menu). The choice is remembered in this browser and applied by reloading.
import { LANG, LANGS, langAvailable, setLang } from '../i18n';
import { store } from './store';

export function LangPicker({ compact = false }: { compact?: boolean }) {
  const list = LANGS.filter(l => langAvailable(l.id));
  if (list.length < 2) return null;
  return <label class={'lang-pick' + (compact ? ' compact' : '')} title="Language / Langue">
    <span aria-hidden="true">🌐</span>
    <select value={LANG} onChange={e => {
      const id = (e.target as HTMLSelectElement).value;
      if (id === LANG) return;
      setLang(id);
      try { store.saveNow(); } catch { /* ignore */ }
      location.reload();
    }}>{list.map(l => <option value={l.id}>{l.name}</option>)}</select>
  </label>;
}
