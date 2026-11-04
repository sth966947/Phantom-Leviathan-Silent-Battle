import { describe, expect, it } from 'vitest';
import text from '../../MANUAL.md?raw';
import { renderMarkdown } from './manual';

describe('manual', () => {
  it('renders the manual with every main section', () => {
    const { html, headings } = renderMarkdown(text);
    const h2 = headings.filter((h) => h.level === 2).map((h) => h.text);
    for (const want of ['The three campaigns', 'USS Tang (SSN-805)', 'Weapons', 'Drones', 'Sensors', 'The game screen', 'Keyboard reference']) expect(h2).toContain(want);
    expect(new Set(headings.map((h) => h.id)).size).toBe(headings.length);
    expect(html).toContain('<table>');
    expect(html).not.toMatch(/\*\*/);
  });
  it('handles the Markdown the manual uses', () => {
    const { html } = renderMarkdown('# T\n\nA **b** and `c` and [d](https://e.f).\n\n- one\n  - two\n- three\n\n| a | b |\n|---|---|\n| 1 | <x> |');
    expect(html).toContain('<b>b</b>');
    expect(html).toContain('<code>c</code>');
    expect(html).toContain('<a href="https://e.f" target="_blank" rel="noopener">d</a>');
    expect(html).toContain('<ul><li>one<ul><li>two</li></ul></li><li>three</li></ul>');
    expect(html).toContain('<td>&lt;x&gt;</td>');
  });
});
