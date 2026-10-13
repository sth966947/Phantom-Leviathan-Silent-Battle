// Broadband passive waterfall: bearing across, time down, newest row on top.
import { WF_BINS, type Game } from '../sim/sim';

const STOPS: [number, number[]][] = [[0, [4, 14, 24]], [0.22, [14, 52, 74]], [0.45, [52, 130, 138]], [0.72, [243, 176, 75]], [1, [255, 246, 222]]];

function ramp(v: number): number[] {
  v = Math.max(0, Math.min(1, v));
  for (let i = 1; i < STOPS.length; i++) {
    if (v <= STOPS[i][0]) {
      const [p0, c0] = STOPS[i - 1], [p1, c1] = STOPS[i], t = (v - p0) / (p1 - p0);
      return c0.map((x, j) => Math.round(x + (c1[j] - x) * t));
    }
  }
  return STOPS[STOPS.length - 1][1];
}

export class Waterfall {
  private ctx: CanvasRenderingContext2D;
  private lastT = -1;
  constructor(private canvas: HTMLCanvasElement) { this.ctx = canvas.getContext('2d')!; this.clear(); }

  clear() {
    this.ctx.fillStyle = '#020a12';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.lastT = -1;
  }

  draw(g: Game) {
    const w = g.waterfall;
    if (!w || w.t === this.lastT) return;
    this.lastT = w.t;
    const { canvas: cv, ctx } = this;
    ctx.drawImage(cv, 0, 0, cv.width, cv.height - 1, 0, 1, cv.width, cv.height - 1);
    const img = ctx.createImageData(cv.width, 1);
    const px = cv.width / WF_BINS;
    for (let i = 0; i < WF_BINS; i++) {
      const col = w.baffle[i] ? [30 + w.row[i] * 60, 24 + w.row[i] * 40, 22] : ramp(w.row[i]);
      for (let j = 0; j < px; j++) {
        const o = (i * px + j) * 4;
        img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }
}
