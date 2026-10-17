import '../i18n';
import { render } from 'preact';
import { App } from './app';
import './style.css';
import { applyPrefs, onPrefs } from './prefs';
import { store } from './store';
import './audio';
import { checkForUpdate } from './update';

applyPrefs();
onPrefs(() => store.bump());

render(<App />, document.getElementById('app')!);
// 0.3.9.18: the copy opened from the disk looks for a newer version (after the first paint)
setTimeout(() => { void checkForUpdate(); }, 1500);
