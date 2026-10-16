// Constellations i18n: finds the player-visible French text in the sources (string and template literals, JSX text)
// and rewrites it into calls to the runtime translator. The same code serves the extractor (which builds the
// catalogue to translate) and the build (which rewrites only the texts the catalogue knows): nothing is translated
// by hand in the sources, they stay in French.
import ts from 'typescript5';
import fs from 'node:fs';
import path from 'node:path';

/** Files whose strings are data keys (English names of Stars!) or proper names: never translated. */
export const SKIP_FILES = new Set(['src/data/techs.ts', 'src/data/hulls.ts', 'src/data/rules-raw.ts', 'src/data/traits-raw.ts', 'src/data/names.ts', 'src/data/types.ts', 'src/engine/types.ts', 'src/ui/art.ts', 'src/env.d.ts', 'src/i18n.ts', 'src/data/extras.ts', 'src/ui/backup.ts', 'src/ui/sharepage.ts']);

const JSX_SKIP_ATTR = new Set(['class', 'className', 'key', 'id', 'type', 'value', 'name', 'href', 'src', 'style', 'role', 'for', 'htmlFor', 'd', 'viewBox', 'fill', 'stroke', 'transform', 'points', 'width', 'height', 'x', 'y', 'cx', 'cy', 'r', 'rx', 'ry', 'xmlns', 'method', 'accept', 'autocomplete', 'inputmode', 'pattern', 'target', 'rel', 'csv', 'tab', 'kind', 'mode', 'size', 'align', 'dir', 'lang', 'step', 'min', 'max', 'color', 'hull', 'part', 'icon', 'dominantBaseline', 'textAnchor', 'text-anchor', 'stroke-width', 'strokeWidth', 'opacity', 'font-size', 'fontSize', 'loading', 'download', 'accessKey', 'tabIndex', 'tabindex', 'draggable', 'spellcheck', 'wrap', 'cols', 'rows', 'list', 'form', 'file', 'variant', 'sort', 'field', 'k2', 'data-tut']);
const CALL_SKIP = new Set(['get', 'has', 'delete', 'getItem', 'setItem', 'removeItem', 'open', 'close', 'goTab', 'querySelector', 'querySelectorAll', 'getElementById', 'addEventListener', 'removeEventListener', 'createElement', 'createElementNS', 'getContext', 'setAttribute', 'getAttribute', 'removeAttribute', 'includes', 'startsWith', 'endsWith', 'indexOf', 'lastIndexOf', 'split', 'getData', 'setData', 'toggleRule', 'setRule', 'require', 'import', 'postMessage', 'matchMedia', 'localeCompare', 'toLocaleString', 'toLocaleDateString', 'Intl', 'RegExp', 'test', 'match', 'search', 'execCommand', 'setProperty', 'getPropertyValue', 'seedFromString', 'Rng', 'hasDoctrine', 'hasSpecial', 'isRule', 'ruleOn', 'checkpoint', 'hasTrait', 'traitOf', 'fieldOf', 'byName', 'partByName', 'hullByName', 'findPart', 'findHull', 'designAtTech', 'autoDesign', 'ensureFaction']);

/** Object properties whose values are keys, not text. */
const PROP_SKIP = new Set(['id', 'kind', 'key', 'tab', 'type', 'cat', 'mode', 'value', 'field', 'purpose', 'hull', 'part', 'slot', 'sort', 'role', 'status', 'icon', 'csv', 'phase', 'stage', 't', 'by', 'about', 'target', 'task', 'action', 'prt', 'lrt', 'trait', 'doctrine', 'rule', 'cls', 'className', 'class', 'color', 'engine', 'stability', 'band', 'origin', 'weapon', 'file', 'format', 'shape', 'seed', 'ref', 'dialog', 'group', 'variant', 'stat', 'unitKey', 'tag', 'tags', 'lang', 'locale']);

const ACCENT = /[À-ÖØ-öø-ÿŒœ]/;
const FR_WORD = /(^|[\s'’(])(de|des|du|la|le|les|un|une|et|en|au|aux|à|est|sont|pas|par|pour|sur|dans|avec|sans|ou|qui|que|ne|plus|son|sa|ses|vos|votre|nos|notre|leur|leurs|ce|cette|ces|il|elle|ils|elles|on|vous|nous|an|ans|année|années|tous|tout|toute|toutes|aucun|aucune|chaque|ici|déjà|encore|moins|très|trop|peu)(?=$|[\s,.;:!?)'’])/i;

/** A literal that is player-visible French (or a French label), as opposed to a key, a class list, a path... */
export function looksVisible(text, englishKeys) {
  const t = text.replace(/\{\d+\}/g, ' ').replace(/\s+/g, ' ').trim();
  if (/^(rotate|translate|translateX|translateY|scale|matrix|skew|rgb|rgba|hsl|hsla|linear-gradient|radial-gradient|conic-gradient|url|calc|var|repeat|minmax|drop-shadow|blur|brightness|saturate|cubic-bezier)\(/.test(t)) return false;
  if (/^(bold |italic |normal )?\d*(px|em|rem|%)? ?[\w ,'"-]*(system-ui|sans-serif|serif|monospace)/.test(t)) return false;
  if (!/[A-Za-zÀ-ÿ]{2,}/.test(t)) return /^à$/.test(t) ? true : /\{\d+\}/.test(text) && /[A-Za-zÀ-ÿ]/.test(t) && !englishKeys.has(text) ? 'maybe' : false;
  if (englishKeys.has(text)) return false;
  if (/^(https?:|data:|#[0-9a-f]{3,8}$|rgba?\(|hsla?\(|var\(|calc\(|url\(|<|M\d|m\d)/i.test(t)) return false;
  if (/^[\w.-]+\.(json|csv|txt|png|html|svg|md)$/i.test(t)) return false;
  // code keys built from parts ("crisis:bulwark:{0}:{1}")
  if (/^[a-z][\w-]*:[\w-]*:?/.test(text) && !/\s/.test(text.replace(/\{\d+\}/g, ''))) return false;
  // a French elided word: "l'alliance", "d'escorte"
  if (/^[ldjmnst]['’][a-zà-ÿ]+$/i.test(t)) return true;
  // one token without a space: a key ("planet", "sim|3|e4") unless it is a capitalised or accented word
  if (!/\s/.test(t)) {
    // abbreviations end with a full stop: "Habit.", "Déf."
    if (/^[A-ZÀ-Ý][a-zà-ÿ'’-]+\.$/.test(t) || (ACCENT.test(t) && /^[A-Za-zÀ-ÿ'’-]+\.$/.test(t))) return true;
    if (/^[A-ZÀ-Ý][a-zà-ÿ'’-]+$/.test(t) && !/[A-Z].*[A-Z]/.test(t.slice(1))) return true;
    if (ACCENT.test(t) && /^[A-Za-zÀ-ÿ'’-]+$/.test(t)) return true;
    return /^[a-z]+$/.test(t) ? 'maybe' : false;
  }
  if (/^[a-z0-9_-]+( [a-z0-9_.:-]+)*$/.test(t) && !FR_WORD.test(' ' + t + ' ')) return 'maybe';
  return true;
}

/** JSX renders text by trimming each line and joining the non-empty ones with a space. */
export function jsxRendered(raw) {
  const lines = raw.split(/\r?\n/);
  if (lines.length === 1) return decode(raw);
  const out = [];
  lines.forEach((l, i) => {
    let s = l.replace(/\t/g, ' ');
    if (i > 0) s = s.replace(/^ +/, '');
    if (i < lines.length - 1) s = s.replace(/ +$/, '');
    if (s) out.push(s);
  });
  return decode(out.join(' '));
}
function decode(s) {
  return s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
}

function calleeName(call) {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return '';
}

/** Is this literal in a place where it is a key rather than text? */
function keyContext(node) {
  const p = node.parent;
  if (!p) return false;
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isExternalModuleReference(p) || ts.isImportTypeNode?.(p)) return true;
  if (ts.isLiteralTypeNode(p)) return true;
  if (ts.isPropertyAssignment(p) && p.name === node) return true;
  if (ts.isPropertyDeclaration?.(p) && p.name === node) return true;
  if (ts.isPropertySignature?.(p) && p.name === node) return true;
  if (ts.isMethodDeclaration?.(p) && p.name === node) return true;
  if (ts.isEnumMember(p)) return true;
  // a key-valued property holds keys ('stations', 'planet'), but sometimes a label ('Grand projet'): only keys are skipped
  if (ts.isPropertyAssignment(p) && p.initializer === node && PROP_SKIP.has(p.name.getText().replace(/['"]/g, '')) && /^[a-z][\w-]*$/.test(node.text ?? '')) return true;
  if (ts.isShorthandPropertyAssignment?.(p)) return true;
  if (ts.isElementAccessExpression(p) && p.argumentExpression === node) return true;
  if (ts.isCaseClause(p)) return true;
  if (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.InKeyword].includes(p.operatorToken.kind)) return true;
  if ((ts.isCallExpression(p) || ts.isNewExpression(p)) && p.arguments?.includes(node)) {
    const n = ts.isCallExpression(p) ? calleeName(p) : (ts.isIdentifier(p.expression) ? p.expression.text : '');
    if (CALL_SKIP.has(n)) return true;
  }
  if (ts.isJsxAttribute(p)) {
    const nm = p.name.getText();
    if (JSX_SKIP_ATTR.has(nm) || nm.startsWith('data-') || nm.startsWith('on')) return true;
  }
  // a string compared through a switch(x) or an array of keys used with includes: ['a', 'b'].includes(x)
  if (ts.isArrayLiteralExpression(p) && p.parent && ts.isPropertyAccessExpression(p.parent) && ['includes', 'indexOf'].includes(p.parent.name.text)) return true;
  // decorators, directives
  if (ts.isExpressionStatement(p)) return true;
  return false;
}

/**
 * Candidates of a file: [{ start, end, kind: 'str'|'tpl'|'jsx', key, args: [{ start, end }], vis }].
 * `vis` is true (French text), 'maybe' (a single word: listed for review) or false.
 */
export function collect(source, fileName, englishKeys) {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out = [];
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const text = node.text;
      if (!keyContext(node)) {
        const vis = looksVisible(text, englishKeys);
        if (vis) out.push({ start: node.getStart(sf), end: node.end, kind: 'str', key: text, args: [], vis, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, ctx: ctxOf(node), attr: !!node.parent && ts.isJsxAttribute(node.parent) });
      }
    } else if (ts.isTemplateExpression(node)) {
      let key = node.head.text;
      const args = [];
      node.templateSpans.forEach((sp, i) => { key += `{${i}}` + sp.literal.text; args.push({ start: sp.expression.getStart(sf), end: sp.expression.end }); });
      if (!keyContext(node)) {
        const vis = looksVisible(key, englishKeys);
        if (vis) out.push({ start: node.getStart(sf), end: node.end, kind: 'tpl', key, args, vis, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, ctx: ctxOf(node) });
      }
    } else if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      // the children of an element form one text: "Pertes : {0} des vôtres ({1} R)", where the placeholders are the
      // inner elements and expressions (translated on their own); the sentence stays whole for the translator
      const kids = node.children;
      const hasText = kids.some(k => ts.isJsxText(k) && /[A-Za-zÀ-ÿ]{2,}/.test(jsxRendered(k.getFullText(sf))));
      if (kids.length && hasText) {
        let key = '', n = 0;
        const args = [];
        for (const k of kids) {
          if (ts.isJsxText(k)) key += jsxRendered(k.getFullText(sf));
          else if (ts.isJsxExpression(k)) { if (!k.expression) continue; key += `{${n++}}`; args.push({ start: k.expression.getStart(sf), end: k.expression.end }); }
          else { key += `{${n++}}`; args.push({ start: k.getStart(sf), end: k.end }); }
        }
        const plain = key.replace(/\{\d+\}/g, '').trim();
        if (plain && !englishKeys.has(key.trim()) && /[A-Za-zÀ-ÿ]{2,}/.test(plain)) out.push({ start: kids[0].pos, end: kids[kids.length - 1].end, kind: 'jsx', key, args, vis: true, line: sf.getLineAndCharacterOfPosition(kids[0].pos).line + 1, ctx: ctxOf(kids[0]) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { sf, items: out };
}

function ctxOf(node) {
  // a short hint for the translator: the enclosing JSX attribute, property or call
  let p = node.parent, hops = 0;
  while (p && hops < 4) {
    if (ts.isJsxAttribute(p)) return 'attr:' + p.name.getText();
    if (ts.isPropertyAssignment(p) && p.name) return 'prop:' + p.name.getText().replace(/['"]/g, '');
    if (ts.isCallExpression(p)) return 'call:' + calleeName(p);
    if (ts.isJsxElement(p) || ts.isJsxFragment(p)) return 'jsx';
    p = p.parent; hops++;
  }
  return '';
}

/** Rewrites a file: only the candidates whose key the catalogue lists (and the locale literals). */
export function rewrite(source, fileName, englishKeys, known) {
  const { items } = collect(source, fileName, englishKeys);
  const use = items.filter(c => known.has(c.key)).sort((a, b) => a.start - b.start || b.end - a.end);
  // locale-dependent formatting: 'fr-FR' / 'fr' literals in toLocaleString / localeCompare
  const loc = [];
  for (const m of source.matchAll(/toLocaleString\((['"])fr-FR\1/g)) loc.push({ start: m.index + 'toLocaleString('.length, end: m.index + m[0].length, text: '__loc()' });
  for (const m of source.matchAll(/localeCompare\(([^,()]+(?:\([^()]*\))?[^,()]*), (['"])fr\2/g)) { const s = m.index + m[0].length - 4; loc.push({ start: s, end: s + 4, text: '__loc()' }); }
  for (const m of source.matchAll(/\.replace\((['"])\.\1, (['"]),\2\)/g)) { const s = m.index + m[0].length - 4; loc.push({ start: s, end: s + 3, text: '__dec()' }); }
  if (!use.length && !loc.length) return source;
  const render = (start, end) => {
    let out = '', at = start;
    const inside = use.filter(c => c.start >= start && c.end <= end);
    const locIn = loc.filter(l => l.start >= start && l.end <= end);
    const all = [...inside.map(c => ({ ...c, t: 'c' })), ...locIn.map(l => ({ ...l, t: 'l' }))].sort((a, b) => a.start - b.start || b.end - a.end);
    for (const c of all) {
      if (c.start < at) continue; // nested in one already rewritten
      out += source.slice(at, c.start);
      if (c.t === 'l') out += c.text;
      else if (c.kind === 'str') out += c.attr ? `{__t(${JSON.stringify(c.key)})}` : `__t(${JSON.stringify(c.key)})`;
      else if (c.kind === 'jsx') out += c.args.length ? `{__tj(${JSON.stringify(c.key)}, [${c.args.map(a => render(a.start, a.end)).join(', ')}])}` : `{__t(${JSON.stringify(c.key)})}`;
      else out += `__tf(${JSON.stringify(c.key)}, [${c.args.map(a => render(a.start, a.end)).join(', ')}])`;
      at = c.end;
    }
    return out + source.slice(at, end);
  };
  return render(0, source.length);
}

/** Every source file of the game, relative to the project root. */
export function sourceFiles(root) {
  const res = [];
  const walk = (d) => {
    for (const f of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
      const rel = path.posix.join(d, f.name);
      if (f.isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(f.name) && !f.name.endsWith('.d.ts')) res.push(rel);
    }
  };
  walk('src');
  return res.sort();
}

/** Strings that are English data keys (names of components, hulls, enum values...): never translated. */
export function englishKeySet(root) {
  const set = new Set();
  for (const rel of SKIP_FILES) {
    const p = path.join(root, rel);
    if (!fs.existsSync(p)) continue;
    const src = fs.readFileSync(p, 'utf8');
    const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true);
    const visit = (n) => { if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) { if (!ACCENT.test(n.text) && !FR_WORD.test(' ' + n.text + ' ')) set.add(n.text); } ts.forEachChild(n, visit); };
    visit(sf);
  }
  // union types and keys of the label table everywhere
  for (const rel of sourceFiles(root)) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, rel.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (n) => {
      if (ts.isLiteralTypeNode(n) && ts.isStringLiteral(n.literal)) set.add(n.literal.text);
      if (ts.isPropertyAssignment(n) && (ts.isStringLiteral(n.name))) set.add(n.name.text);
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return set;
}
