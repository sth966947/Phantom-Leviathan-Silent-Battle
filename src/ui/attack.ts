// Attack plan: pick targets, a weapon and how many (1 to 4) for each. Each weapon is its own
// salvo: the fire-control computer times every Tomahawk to hit on the same second, every
// NSM on the same second, and so on (see planWave in the sim). Salvoes of different
// weapons keep their own times.
import { CLASSES } from '../sim/classes';
import { WEAPONS, contactLabel, isFriendlyClass, orders, planWave, type Game, type WaveItem, type WaveKey, type WavePlan, type WaveShot } from '../sim/sim';
import { brg, dist, fmtBrg, fmtRng } from '../sim/math';

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.round(s % 60))).padStart(2, '0')}`;

const NAMES: Record<WaveKey, string> = {
  mk48: 'Mk 48 torpedo', mk96: 'Mk 96 torpedo (exp.)', nsm: 'NSM', mst: 'Tomahawk anti-ship',
  asroc: 'ASROC', mjolnir: 'Mjolnir (exp.)', tlam: 'Tomahawk land attack',
};
const AT_SEA: WaveKey[] = ['mk48', 'mk96', 'nsm', 'mst', 'asroc', 'mjolnir'];
const ASHORE: WaveKey[] = ['tlam', 'mjolnir'];

interface Row { key: string; target: number; site: boolean; name: string; x: number; y: number; sub: boolean }
interface Pick { type: WaveKey; n: number }

/** What a salvo weapon will do to make its time, in a few words. */
function howText(s: WaveShot) {
  const t = mmss(s.flight);
  if (s.how === 'loiter') return `loiters near us, hits in ${t}`;
  if (s.how === 'loft') return `higher, longer arc, hits in ${t}`;
  if (s.how === 'slow') return `runs slow, hits in ${t}`;
  return `straight in, hits in ${t}`;
}

export class AttackPlan {
  open = false;
  private picks = new Map<string, Pick>();
  private rowKeys = '';
  constructor(private g: () => Game) {
    $('attackClose').addEventListener('click', () => this.close());
    $('attackFire').addEventListener('click', () => this.fire());
    $('attackRows').addEventListener('change', (ev) => {
      const el = ev.target as HTMLSelectElement, key = el.closest('tr')?.dataset.key;
      if (!key) return;
      const p = this.picks.get(key)!;
      if (el.dataset.f === 'type') p.type = el.value as WaveKey;
      else p.n = Number(el.value);
    });
  }
  toggle() { if (this.open) this.close(); else this.show(); }
  show() { this.open = true; $('attackView').hidden = false; this.rowKeys = ''; }
  close() { this.open = false; $('attackView').hidden = true; }

  /** Targets for the plan: every enemy or unknown ship and submarine with a solution, and the mission's sites ashore. */
  private rows(g: Game): Row[] {
    const out: Row[] = [];
    for (const c of g.contacts) {
      const v = g.vessels.find((x) => x.id === c.vid);
      if (!c.held || !c.est || c.air || !v?.alive || v.gone || isFriendlyClass(c.classified)) continue;
      out.push({ key: `c${c.id}`, target: c.id, site: false, name: contactLabel(c), x: c.est.x, y: c.est.y, sub: !!c.classified && CLASSES[c.classified].kind === 'sub' });
    }
    for (const s of g.sites) out.push({ key: `s${s.id}`, target: s.id, site: true, name: s.name, x: s.x, y: s.y, sub: false });
    return out;
  }

  /** The picks grouped into one salvo per weapon, in the order the weapons first appear. */
  private salvoes(rows: Row[]) {
    const out = new Map<WaveKey, WaveItem[]>();
    for (const r of rows) {
      const p = this.picks.get(r.key)!;
      if (p.n > 0) out.set(p.type, [...(out.get(p.type) ?? []), { target: r.target, site: r.site || undefined, n: p.n }]);
    }
    return out;
  }

  private fire() {
    const g = this.g(), rows = this.rows(g), before = g.waves.length;
    for (const [type, items] of this.salvoes(rows)) orders.wave(g, type, items);
    if (g.waves.length > before) for (const r of rows) this.picks.get(r.key)!.n = 0;
    this.rowKeys = '';
  }

  draw(g: Game) {
    if (!this.open) return;
    const rows = this.rows(g), o = g.own;
    for (const r of rows) if (!this.picks.has(r.key)) this.picks.set(r.key, { type: r.site ? 'tlam' : r.sub ? 'mk48' : g.flags.jammed ? 'nsm' : 'mst', n: 0 });
    const keys = rows.map((r) => r.key).join();
    const body = $('attackRows');
    if (keys !== this.rowKeys) {
      this.rowKeys = keys;
      body.innerHTML = rows.length ? rows.map((r) => {
        const p = this.picks.get(r.key)!;
        const types = (r.site ? ASHORE : AT_SEA).map((k) => `<option value="${k}"${k === p.type ? ' selected' : ''}>${NAMES[k]}</option>`).join('');
        const ns = [0, 1, 2, 3, 4].map((n) => `<option value="${n}"${n === p.n ? ' selected' : ''}>${n || '—'}</option>`).join('');
        return `<tr data-key="${r.key}"><td class="nm">${esc(r.name)}${r.site ? ' <span class="dim">ashore</span>' : ''}</td><td class="num brg"></td><td class="num rng"></td>`
          + `<td><select data-f="type" aria-label="Weapon for ${esc(r.name)}">${types}</select></td>`
          + `<td><select data-f="n" aria-label="How many at ${esc(r.name)}">${ns}</select></td><td class="how"></td></tr>`;
      }).join('') : '<tr><td colspan="6" class="empty">No targets with a solution yet. Build a solution on a contact first.</td></tr>';
    }
    const plans = [...this.salvoes(rows)].map(([type, items]) => ({ type, n: items.reduce((a, x) => a + x.n, 0), plan: planWave(g, type, items) as WavePlan }));
    for (const tr of body.querySelectorAll<HTMLTableRowElement>('tr[data-key]')) {
      const r = rows.find((x) => x.key === tr.dataset.key)!, p = this.picks.get(r.key)!;
      tr.querySelector('.brg')!.textContent = `${fmtBrg(brg(o, r))}°`;
      tr.querySelector('.rng')!.textContent = fmtRng(dist(o, r));
      const plan = p.n ? plans.find((x) => x.type === p.type)?.plan : undefined;
      const shot = plan?.ok ? plan.shots.find((s) => s.target === r.target && s.site === r.site) : null;
      tr.querySelector('.how')!.textContent = shot ? howText(shot) : '';
      tr.classList.toggle('on', p.n > 0);
    }
    // The salvoes share the tubes: check they fit together.
    const vls = o.vls.filter((x) => x <= 0).length, tt = o.tubes.filter((x) => x <= 0).length;
    const needV = plans.filter((x) => WEAPONS[x.type].vls).reduce((a, x) => a + x.n, 0), needT = plans.filter((x) => !WEAPONS[x.type].vls).reduce((a, x) => a + x.n, 0);
    const tubeWhy = needV > vls ? `The salvoes need ${needV} vertical tubes; ${vls} are loaded.` : needT > tt ? `The salvoes need ${needT} torpedo tubes; ${tt} are loaded.` : '';
    $('attackTubes').textContent = `Loaded: ${tt} of ${o.tubes.length} torpedo tubes, ${vls} of ${o.vls.length} vertical tubes${plans.length ? ` · this attack uses ${needT} and ${needV}` : ''}`;
    $('attackPlan').innerHTML = !plans.length ? 'Pick how many to send at one target or more.'
      : plans.map((x) => `<div class="${x.plan.ok ? '' : 'bad'}">${esc(NAMES[x.type])} × ${x.n}: ${x.plan.ok ? `all hit together in ${mmss(x.plan.tot - g.t)}` : esc(x.plan.why)}</div>`).join('')
        + (tubeWhy ? `<div class="bad">${esc(tubeWhy)}</div>` : '');
    ($('attackFire') as HTMLButtonElement).disabled = !!g.over || !plans.length || !!tubeWhy || plans.some((x) => !x.plan.ok);
    const live = g.waves.map((w) => mmss(w.tot - g.t)).join(', ');
    $('attackRead').textContent = live ? `salvoes in the air, hitting in ${live}` : 'each weapon is a salvo that hits together';
  }
}
