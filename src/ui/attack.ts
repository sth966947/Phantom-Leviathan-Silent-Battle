// Attack plan: pick targets, a weapon and how many (1 to 4) for each. Each weapon is its own
// salvo: the fire-control computer times every Tomahawk to hit on the same second, every
// NSM on the same second, and so on (see planWave in the sim). Salvoes of different
// weapons keep their own times. JATM and SM-6 go at aircraft all at once, fire and forget.
// The weapon and number pickers are up-down steppers: the arrows (or the arrow keys) step through them.
import { CLASSES } from '../sim/classes';
import { JATM_PER_CANISTER, finished, WEAPONS, bankFor, contactLabel, isFriendlyClass, orders, planWave, slotWeapon, type Game, type WaveItem, type WaveKey, type WavePlan, type WaveShot, type WeaponKey } from '../sim/sim';
import { brg, dist, fmtBrg, fmtRng } from '../sim/math';

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.round(s % 60))).padStart(2, '0')}`;

const NAMES: Record<WaveKey, string> = {
  mk48: 'Mk 48 torpedo', mk96: 'Mk 96 torpedo (exp.)', nsm: 'NSM', mst: 'Tomahawk anti-ship',
  asroc: 'ASROC', mjolnir: 'Mjolnir (exp.)', tlam: 'Tomahawk land attack', jatm: 'JATM', sm6: 'SM-6',
};
const AT_SEA: WaveKey[] = ['mk48', 'mk96', 'nsm', 'mst', 'asroc', 'mjolnir'];
const ASHORE: WaveKey[] = ['tlam', 'mjolnir'];
const AIR: WaveKey[] = ['jatm', 'sm6'];
/** A 1980s boat's own weapon in each slot (boats.ts), named for what it is. */
const OLD: Partial<Record<WeaponKey, string>> = { mk48old: 'Mk 48 torpedo', harpoon: 'Harpoon', tasm: 'Tomahawk anti-ship (TASM)', subroc: 'SUBROC', sealance: 'Sea Lance', stinger: 'Stinger' };
const real = (g: Game, k: WaveKey): WeaponKey | null => (k === 'tlam' ? (g.own.kit.tlam ? 'tlam' : null) : slotWeapon(g, k));
const nameOf = (g: Game, k: WaveKey) => { const r = real(g, k); return (r && OLD[r]) ?? NAMES[k]; };

type Kind = 'sea' | 'site' | 'air';
interface Row { key: string; target: number; site: boolean; kind: Kind; name: string; at: { x: number; y: number } | null; bearing: number; sub: boolean }
/** The weapons this boat can send at a row: only what she carries. */
const choices = (g: Game, r: Row) => (r.kind === 'air' ? AIR : r.kind === 'site' ? ASHORE : AT_SEA).filter((k) => real(g, k));
interface Pick { type: WaveKey; n: number }

/** What a salvo weapon will do to make its time, in a few words. */
function howText(s: WaveShot & { type: WaveKey }) {
  const t = mmss(s.flight);
  if (s.how === 'loiter') return `loiters near us, hits in ${t}`;
  if (WEAPONS[s.type].role === 'aa') return `fire and forget down its bearing${s.flight ? `, about ${mmss(s.flight)}` : ''}`;
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
    const body = $('attackRows');
    body.addEventListener('click', (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('.spin button');
      if (b) this.step(b.closest<HTMLElement>('.spin')!, Number(b.dataset.d));
    });
    body.addEventListener('keydown', (ev) => {
      const sp = (ev.target as HTMLElement).closest<HTMLElement>('.spin');
      if (!sp || (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown')) return;
      ev.preventDefault(); ev.stopPropagation();
      this.step(sp, ev.key === 'ArrowUp' ? -1 : 1);
    });
    body.addEventListener('wheel', (ev) => {
      const sp = (ev.target as HTMLElement).closest<HTMLElement>('.spin');
      if (!sp) return;
      ev.preventDefault();
      this.step(sp, ev.deltaY < 0 ? -1 : 1);
    }, { passive: false });
  }
  /** Step a picker: up (-1) is the previous weapon or one more; down (+1) the next weapon or one fewer. */
  private step(sp: HTMLElement, d: number) {
    const key = sp.closest('tr')?.dataset.key, r = this.lastRows.find((x) => x.key === key);
    if (!r) return;
    const p = this.picks.get(r.key)!;
    if (sp.dataset.f === 'type') {
      const g = this.g(), list = choices(g, r), i = list.indexOf(p.type);
      p.type = list[Math.max(0, Math.min(list.length - 1, i + d))] ?? p.type;
      sp.querySelector('span')!.textContent = nameOf(g, p.type);
    } else {
      p.n = Math.max(0, Math.min(4, p.n - d));
      sp.querySelector('span')!.textContent = p.n ? String(p.n) : '—';
    }
    sp.setAttribute('aria-valuetext', sp.querySelector('span')!.textContent!);
  }
  private lastRows: Row[] = [];
  /** Told when the plan opens or closes, so the game can hold still while the captain plans. */
  onToggle: (open: boolean) => void = () => {};
  toggle() { if (this.open) this.close(); else this.show(); }
  show() { if (this.open) return; this.open = true; $('attackView').hidden = false; this.rowKeys = ''; this.onToggle(true); }
  close() { if (!this.open) return; this.open = false; $('attackView').hidden = true; this.onToggle(false); }

  /** Targets for the plan: every enemy or unknown ship and submarine with a solution, every aircraft
   *  we hold a bearing on, and the mission's sites ashore. */
  private rows(g: Game): Row[] {
    const out: Row[] = [], o = g.own;
    for (const c of g.contacts) {
      const v = g.vessels.find((x) => x.id === c.vid);
      if (!c.held || !v?.alive || v.gone || isFriendlyClass(c.classified)) continue;
      if (c.air) {
        if (c.bearing === null) continue;
        out.push({ key: `c${c.id}`, target: c.id, site: false, kind: 'air', name: contactLabel(c), at: c.est ? { x: c.est.x, y: c.est.y } : null, bearing: c.bearing, sub: false });
      } else if (c.est) out.push({ key: `c${c.id}`, target: c.id, site: false, kind: 'sea', name: contactLabel(c), at: { x: c.est.x, y: c.est.y }, bearing: brg(o, c.est), sub: !!c.classified && CLASSES[c.classified].kind === 'sub' });
    }
    // Aircraft first: they are the ones closing fastest.
    out.sort((a, b) => Number(b.kind === 'air') - Number(a.kind === 'air'));
    for (const s of g.sites) out.push({ key: `s${s.id}`, target: s.id, site: true, kind: 'site', name: s.name, at: { x: s.x, y: s.y }, bearing: brg(o, s), sub: false });
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
    const fired = g.waves.length > before || rows.some((r) => this.picks.get(r.key)!.n > 0 && AIR.includes(this.picks.get(r.key)!.type));
    if (fired) for (const r of rows) this.picks.get(r.key)!.n = 0;
    this.rowKeys = '';
    // Salvoes away: back to the battle.
    if (fired) this.close();
  }

  draw(g: Game) {
    if (!this.open) return;
    const rows = this.lastRows = this.rows(g), o = g.own;
    for (const r of rows) if (!this.picks.has(r.key)) {
      const want: WaveKey = r.kind === 'air' ? 'jatm' : r.site ? 'tlam' : r.sub ? 'mk48' : g.flags.jammed ? 'nsm' : 'mst';
      this.picks.set(r.key, { type: real(g, want) ? want : choices(g, r)[0] ?? want, n: 0 });
    }
    const keys = rows.map((r) => r.key).join();
    const body = $('attackRows');
    if (keys !== this.rowKeys) {
      this.rowKeys = keys;
      body.innerHTML = rows.length ? rows.map((r) => {
        const p = this.picks.get(r.key)!;
        const spin = (f: string, label: string, val: string) => `<div class="spin" data-f="${f}" role="spinbutton" tabindex="0" aria-label="${label}" aria-valuetext="${esc(val)}">`
          + `<span>${esc(val)}</span><button type="button" tabindex="-1" data-d="-1" aria-label="Up">▲</button><button type="button" tabindex="-1" data-d="1" aria-label="Down">▼</button></div>`;
        return `<tr data-key="${r.key}"><td class="nm">${esc(r.name)}${r.site ? ' <span class="dim">ashore</span>' : r.kind === 'air' ? ' <span class="dim">aircraft</span>' : ''}</td><td class="num brg"></td><td class="num rng"></td>`
          + `<td>${spin('type', `Weapon for ${esc(r.name)}`, nameOf(g, p.type))}</td>`
          + `<td>${spin('n', `How many at ${esc(r.name)}`, p.n ? String(p.n) : '—')}</td><td class="how"></td></tr>`;
      }).join('') : '<tr><td colspan="6" class="empty">No targets with a solution yet. Build a solution on a contact first.</td></tr>';
    }
    const plans = [...this.salvoes(rows)].map(([type, items]) => ({ type, n: items.reduce((a, x) => a + x.n, 0), plan: planWave(g, type, items) as WavePlan }));
    for (const tr of body.querySelectorAll<HTMLTableRowElement>('tr[data-key]')) {
      const r = rows.find((x) => x.key === tr.dataset.key)!, p = this.picks.get(r.key)!;
      tr.querySelector('.brg')!.textContent = `${fmtBrg(r.at ? brg(o, r.at) : r.bearing)}°`;
      tr.querySelector('.rng')!.textContent = r.at ? fmtRng(dist(o, r.at)) : '—';
      const plan = p.n ? plans.find((x) => x.type === p.type)?.plan : undefined;
      const shot = plan?.ok ? plan.shots.find((s) => s.target === r.target && s.site === r.site) : null;
      tr.querySelector('.how')!.textContent = shot ? howText({ ...shot, type: p.type }) : '';
      tr.classList.toggle('on', p.n > 0);
    }
    // The salvoes share the tubes: check they fit together.
    // A JATM canister is one tube for up to seven, starting with the rounds left in the open one.
    const vls = o.vls.filter((x) => x <= 0).length, tt = o.tubes.filter((x) => x <= 0).length;
    const tubesFor = (x: { type: WaveKey; n: number }) => (x.type === 'jatm' ? Math.ceil(Math.max(0, x.n - o.jatm) / JATM_PER_CANISTER) : x.n);
    // A 1980s boat's Stingers take no tube; its Tomahawks go out of the torpedo tubes if it has no vertical ones.
    const bankOf = (x: { type: WaveKey }) => { const w = real(g, x.type); return !w || w === 'stinger' ? null : bankFor(o, w) === o.vls ? 'v' : 't'; };
    const needV = plans.filter((x) => bankOf(x) === 'v').reduce((a, x) => a + tubesFor(x), 0), needT = plans.filter((x) => bankOf(x) === 't').reduce((a, x) => a + x.n, 0);
    const tubeWhy = needV > vls ? `The salvoes need ${needV} vertical tubes; ${vls} are loaded.` : needT > tt ? `The salvoes need ${needT} torpedo tubes; ${tt} are loaded.` : '';
    $('attackTubes').textContent = `Loaded: ${tt} of ${o.tubes.length} torpedo tubes, ${vls} of ${o.vls.length} vertical tubes${plans.length ? ` · this attack uses ${needT} and ${needV}` : ''}`;
    $('attackPlan').innerHTML = !plans.length ? 'Pick how many to send at one target or more.'
      : plans.map((x) => `<div class="${x.plan.ok ? '' : 'bad'}">${esc(nameOf(g, x.type))} × ${x.n}: ${x.plan.ok ? `${WEAPONS[x.type].role === 'aa' ? 'all fire now, fire and forget' : `all hit together in ${mmss(x.plan.tot - g.t)}`}` : esc(x.plan.why)}</div>`).join('')
        + (tubeWhy ? `<div class="bad">${esc(tubeWhy)}</div>` : '');
    ($('attackFire') as HTMLButtonElement).disabled = finished(g) || !plans.length || !!tubeWhy || plans.some((x) => !x.plan.ok);
    const live = g.waves.map((w) => mmss(w.tot - g.t)).join(', ');
    $('attackRead').textContent = `game paused while you plan · ${live ? `salvoes in the air, hitting in ${live}` : 'each weapon is a salvo that hits together'}`;
  }
}
