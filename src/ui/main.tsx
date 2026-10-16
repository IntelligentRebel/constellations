import '../i18n';
import { render } from 'preact';
import { App } from './app';
import './style.css';
import { applyPrefs, onPrefs } from './prefs';
import { store } from './store';
import './audio';

applyPrefs();
onPrefs(() => store.bump());

render(<App />, document.getElementById('app')!);
