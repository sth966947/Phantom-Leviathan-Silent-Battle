// The captain's manual: MANUAL.md at the repository root, bundled into the game and shown in a
// full-screen reader with a contents column. Edit the Markdown to change it; nothing here needs to.
import text from '../../MANUAL.md?raw';

const esc = (t: string) => t.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
const slug = (t: string) => t.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Bold, italics, code and links inside a line. */
function inline(t: string): string {
  const code: string[] = [];
  let s = esc(t).replace(/`([^`]+)`/g, (_, c: string) => `\u0000${code.push(c) - 1}\u0000`);
  s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<i>$2</i>')
    .replace(/(^|[^\w])_([^_\s][^_]*?)_(?!\w)/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|#[\w-]+)\)/g, (_, l: string, u: string) => `<a href="${u}"${u.startsWith('#') ? '' : ' target="_blank" rel="noopener"'}>${l}</a>`);
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => `<code>${code[+i]}</code>`);
}

export interface Heading { level: number; id: string; text: string }

/** A small Markdown renderer for the manual: headings, paragraphs, lists (nested by indent), tables, quotes and rules. */
export function renderMarkdown(md: string): { html: string; headings: Heading[] } {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  const headings: Heading[] = [];
  const used = new Set<string>();
  let i = 0;
  const isList = (l: string) => /^\s*([-*]|\d+\.)\s+/.test(l);
  const isTable = (l: string) => /^\s*\|.*\|\s*$/.test(l);
  const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const blockStart = (l: string) => /^(#{1,6}\s|>|---+\s*$)/.test(l) || isList(l) || isTable(l);
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    const h = /^(#{1,6})\s+(.*)$/.exec(l);
    if (h) {
      const level = h[1].length;
      const html = inline(h[2]);
      let id = slug(h[2]) || 'section';
      for (let n = 2; used.has(id); n++) id = `${slug(h[2])}-${n}`;
      used.add(id);
      headings.push({ level, id, text: html.replace(/<[^>]+>/g, '') });
      out.push(`<h${level} id="${id}">${html}</h${level}>`);
      i++; continue;
    }
    if (/^---+\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
    if (l.startsWith('>')) {
      const q: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) q.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${renderMarkdown(q.join('\n')).html}</blockquote>`);
      continue;
    }
    if (isTable(l)) {
      const rows: string[][] = [];
      while (i < lines.length && isTable(lines[i])) rows.push(cells(lines[i++]));
      const sep = rows.length > 1 && rows[1].every((c) => /^:?-+:?$/.test(c));
      const head = sep ? rows[0] : null;
      const body = sep ? rows.slice(2) : rows;
      const thead = head && head.some((c) => c) ? `<thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>` : '';
      out.push(`<div class="mtable"><table>${thead}<tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (isList(l)) {
      // Collect the list's lines, then build it with a stack of open lists keyed by indent.
      const items: { indent: number; ordered: boolean; text: string }[] = [];
      while (i < lines.length && (isList(lines[i]) || (lines[i].trim() && /^\s+/.test(lines[i]) && items.length))) {
        const m = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (m) items.push({ indent: m[1].length, ordered: /\d/.test(m[2]), text: m[3] });
        else items[items.length - 1].text += ' ' + lines[i].trim();
        i++;
      }
      const stack: { indent: number; tag: string }[] = [];
      let html = '';
      for (const it of items) {
        while (stack.length && it.indent < stack[stack.length - 1].indent) html += `</li></${stack.pop()!.tag}>`;
        const top = stack[stack.length - 1];
        if (!top || it.indent > top.indent) {
          const tag = it.ordered ? 'ol' : 'ul';
          stack.push({ indent: it.indent, tag });
          html += `<${tag}><li>`;
        } else html += '</li><li>';
        html += inline(it.text);
      }
      while (stack.length) html += `</li></${stack.pop()!.tag}>`;
      out.push(html);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !(para.length && blockStart(lines[i]))) para.push(lines[i++].trim());
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return { html: out.join('\n'), headings };
}

/** The manual reader. It sits above every other screen; `open` reports whether it is up. */
export class Manual {
  private root: HTMLElement;
  private body: HTMLElement;
  private last: HTMLElement | null = null;
  onToggle: (open: boolean) => void = () => {};

  constructor() {
    const { html, headings } = renderMarkdown(text);
    const title = headings.find((h) => h.level === 1);
    const toc = headings.filter((h) => h.level === 2 || h.level === 3)
      .map((h) => `<li class="l${h.level}"><a href="#${h.id}" data-to="${h.id}">${esc(h.text)}</a></li>`).join('');
    this.root = document.createElement('div');
    this.root.className = 'manual';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Captain\'s manual');
    this.root.innerHTML = `<div class="manual-frame">
      <div class="sol-head"><span>${esc(title?.text ?? 'Manual')}</span><button class="manual-close">Close <kbd>Esc</kbd></button></div>
      <div class="manual-body"><nav class="manual-toc" aria-label="Contents"><ul>${toc}</ul></nav><article class="manual-text" tabindex="-1">${html}</article></div>
    </div>`;
    document.body.appendChild(this.root);
    this.body = this.root.querySelector('.manual-text')!;
    this.root.querySelector('.manual-close')!.addEventListener('click', () => this.close());
    this.root.addEventListener('click', (ev) => {
      if (ev.target === this.root) { this.close(); return; }
      const a = (ev.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]');
      if (!a) return;
      ev.preventDefault();
      this.root.querySelector(`[id="${a.getAttribute('href')!.slice(1)}"]`)?.scrollIntoView({ block: 'start' });
    });
  }
  get open() { return !this.root.hidden; }
  show() {
    if (this.open) return;
    this.last = document.activeElement as HTMLElement | null;
    this.root.hidden = false;
    this.body.focus({ preventScroll: true });
    this.onToggle(true);
  }
  close() {
    if (!this.open) return;
    this.root.hidden = true;
    this.last?.focus?.({ preventScroll: true });
    this.onToggle(false);
  }
  toggle() { if (this.open) this.close(); else this.show(); }
}
