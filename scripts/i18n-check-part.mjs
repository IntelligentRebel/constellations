// Checks a translated part: node scripts/i18n-check-part.mjs <code> <N>
import fs from 'node:fs';
const [code, n] = process.argv.slice(2);
const c = JSON.parse(fs.readFileSync(`i18n/work/in-${n}.json`, 'utf8'));
const o = JSON.parse(fs.readFileSync(`i18n/work/${code}-p${n}.json`, 'utf8'));
const miss = c.filter(e => !(String(e.id) in o));
const need = e => [...new Set(e.fr.match(/\{\d+\}/g) || [])].filter(p => e.en.includes(p.slice(0, -1)));
const bad = c.filter(e => { const t = o[e.id]; if (t === undefined) return false; return need(e).some(p => !t.includes(p.slice(0, -1))) || (e.en.startsWith(' ') && !/^\s/.test(t) && !/^[　-鿿가-힯]/.test(t.trim()[0] ?? '')) || (e.en.endsWith(' ') && !/\s$/.test(t) && !/[　-鿿가-힯]$/.test(t.trim().slice(-1))); });
const unknown = c.filter(e => { const t = o[e.id]; return t !== undefined && (t.match(/\{(\d+)/g) || []).some(x => !e.fr.includes('{' + x.slice(1) + '}')); });
console.log(`${code} part ${n}: ${Object.keys(o).length} written, ${miss.length} missing${miss.length ? ' (' + miss.slice(0, 20).map(e => e.id).join(' ') + ')' : ''}, ${bad.length} to check${bad.length ? ' (' + bad.map(e => e.id).join(' ') + ')' : ''}, ${unknown.length} unknown placeholders${unknown.length ? ' (' + unknown.map(e => e.id).join(' ') + ')' : ''}`);
