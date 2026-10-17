// 0.3.9.18: a newer version of the game is out (local copy only, see update.ts): its notes and how to get it.
import type { ComponentChildren } from 'preact';
import { Modal } from '../components';
import { store } from '../store';
import { VERSION } from '../version';
import { LOCALE } from '../../i18n';
import { useUpdate, releaseNotes, ONLINE_URL, RELEASES_URL } from '../update';

/** Bold, links and code inside a line of the notes (the notes are text from GitHub: no HTML is ever inserted). */
function inline(s: string): ComponentChildren[] {
  const out: ComponentChildren[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|`([^`]+)`/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    if (m[1] !== undefined) out.push(<b>{m[1]}</b>);
    else if (m[2] !== undefined) out.push(<a href={m[3]} target="_blank" rel="noopener noreferrer">{m[2]}</a>);
    else out.push(<code>{m[4]}</code>);
    last = re.lastIndex;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

/** The few kinds of lines the release notes use: headings, bullets, paragraphs. */
function Notes({ text }: { text: string }) {
  const blocks: ComponentChildren[] = [];
  let list: string[] = [], para: string[] = [];
  const flush = () => {
    if (para.length) { blocks.push(<p>{inline(para.join(' '))}</p>); para = []; }
    if (list.length) { blocks.push(<ul>{list.map(l => <li>{inline(l)}</li>)}</ul>); list = []; }
  };
  for (const raw of text.split('\n')) {
    const l = raw.trim();
    if (!l) { flush(); continue; }
    const h = l.match(/^#{1,6}\s+(.*)$/), b = l.match(/^[-*]\s+(.*)$/);
    if (h) { flush(); blocks.push(<h5>{inline(h[1])}</h5>); } else if (b) { if (para.length) flush(); list.push(b[1]); } else if (list.length) list[list.length - 1] += ' ' + l; else para.push(l);
  }
  flush();
  return <div class="release-notes">{blocks}</div>;
}

export function UpdateDialog() {
  const list = useUpdate();
  const latest = list[0];
  const close = () => store.close('update');
  if (!latest) return <Modal title="Mises à jour" width={560} onClose={close}><p>{`Vous avez la dernière version (${VERSION}).`}</p></Modal>;
  const mb = latest.htmlSize ? (Math.round(latest.htmlSize / 1e5) / 10).toLocaleString(LOCALE) : '';
  const date = (d: string) => { const t = Date.parse(d); return isNaN(t) ? '' : new Date(t).toLocaleDateString(LOCALE); };
  return <Modal title={`Nouvelle version : ${latest.version}`} width={720} onClose={close}
    footer={<button onClick={close}>Plus tard</button>} keepFooter>
    <p>{list.length > 1 ? `Vous jouez la version ${VERSION} : ${list.length} versions sont parues depuis.` : `Vous jouez la version ${VERSION}.`}</p>
    <div class="update-get">
      <a class="btn primary" href={latest.html ?? latest.zip ?? latest.page} target="_blank" rel="noopener noreferrer">{latest.html ? (mb ? `Télécharger le jeu (index.html, ${mb} Mo)` : 'Télécharger le jeu (index.html)') : 'Télécharger le jeu (.zip)'}</a>
      {latest.html && latest.zip && <a class="btn" href={latest.zip} target="_blank" rel="noopener noreferrer">Archive complète (.zip, avec les sources)</a>}
      <a class="btn ghost" href={ONLINE_URL} target="_blank" rel="noopener noreferrer">Jouer en ligne</a>
    </div>
    <p class="small muted">Remplacez votre ancien fichier par le nouveau, dans le même dossier et sous le même nom (index.html) : vos parties restent dans ce navigateur. Par précaution, exportez celles qui comptent avant de remplacer le fichier.</p>
    {list.map(r => <section class="release">
      <h4>{`Version ${r.version}`} <small class="muted">{date(r.date)}</small></h4>
      <Notes text={releaseNotes(r.body)} />
    </section>)}
    <p class="small"><a href={RELEASES_URL} target="_blank" rel="noopener noreferrer">Toutes les versions sur GitHub</a></p>
  </Modal>;
}
