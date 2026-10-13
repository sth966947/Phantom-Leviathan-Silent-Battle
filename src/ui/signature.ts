// Narrowband signature display for the selected contact: frequency across, time
// down. Tonals are steady vertical lines; the propeller blade-rate line moves with speed.
import { contactById, type Game } from '../sim/sim';

const MAX_HZ = 200;

export class SignatureDisplay {
  private ctx: CanvasRenderingContext2D;
  private lastT = -1;
  private lastId: number | null = -1;
  constructor(private canvas: HTMLCanvasElement) { this.ctx = canvas.getContext('2d')!; this.clear(); }

  clear() {
    this.ctx.fillStyle = '#020a12';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.lastT = -1;
  }

  draw(g: Game) {
    const w = g.waterfall;
    if (g.selected !== this.lastId) { this.lastId = g.selected; this.clear(); }
    if (!w || w.t === this.lastT) return;
    this.lastT = w.t;
    const c = contactById(g, g.selected);
    const { canvas: cv, ctx } = this;
    ctx.drawImage(cv, 0, 0, cv.width, cv.height - 1, 0, 1, cv.width, cv.height - 1);
    const img = ctx.createImageData(cv.width, 1);
    const sig = c?.held ? c.sig : null;
    const row = new Float32Array(cv.width);
    for (let i = 0; i < cv.width; i++) row[i] = 0.08 + Math.random() * 0.14;
    if (sig) {
      if (sig.smear) for (let i = 0; i < 45; i++) row[i] += (0.25 + Math.random() * 0.25) * (1 - i / 45);
      for (const l of sig.lines) {
        const x = (l.hz / MAX_HZ) * cv.width;
        for (let i = Math.max(0, Math.floor(x - 3)); i < Math.min(cv.width, x + 3); i++) row[i] += l.level * Math.exp(-((i - x) ** 2) / 1.2);
      }
    }
    for (let i = 0; i < cv.width; i++) {
      const v = Math.min(1, row[i]);
      const o = i * 4;
      // Green-white phosphor, distinct from the amber broadband display.
      img.data[o] = Math.round(20 + 220 * v ** 1.6);
      img.data[o + 1] = Math.round(30 + 225 * v);
      img.data[o + 2] = Math.round(34 + 160 * v ** 1.3);
      img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }
}
