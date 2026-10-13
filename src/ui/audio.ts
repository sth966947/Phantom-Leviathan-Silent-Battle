// Small synthesized sound set. The context starts on the player's first click.
import type { Sound } from '../sim/sim';

let ac: AudioContext | null = null;

export function unlockAudio() {
  try {
    ac = ac ?? new AudioContext();
    void ac.resume();
  } catch { ac = null; }
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.2, when = 0, glideTo?: number) {
  if (!ac) return;
  const t0 = ac.currentTime + when;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(ac.destination);
  o.start(t0); o.stop(t0 + dur + 0.05);
}

function noise(dur: number, gain: number, freq: number) {
  if (!ac) return;
  const n = Math.floor(ac.sampleRate * dur), buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
  const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  src.buffer = buf; f.type = 'lowpass'; f.frequency.value = freq; g.gain.value = gain;
  src.connect(f).connect(g).connect(ac.destination); src.start();
}

const SOUNDS: Record<Sound, () => void> = {
  ping: () => tone(1350, 1.6, 'sine', 0.25),
  'ping-echo': () => { tone(1350, 1.6, 'sine', 0.25); tone(1330, 0.9, 'sine', 0.08, 1.1); },
  contact: () => { tone(880, 0.12, 'square', 0.05); tone(1100, 0.12, 'square', 0.05, 0.14); },
  launch: () => { noise(0.9, 0.6, 600); tone(160, 0.8, 'sawtooth', 0.06, 0, 60); },
  missile: () => { noise(1.6, 0.5, 1200); tone(90, 1.4, 'sawtooth', 0.05, 0.1, 400); },
  alarm: () => { for (let i = 0; i < 3; i++) { tone(740, 0.18, 'square', 0.07, i * 0.4); tone(560, 0.18, 'square', 0.07, i * 0.4 + 0.2); } },
  boom: () => { noise(2.8, 1.2, 260); tone(60, 2.2, 'sine', 0.5, 0, 30); },
};

export const play = (s: Sound) => SOUNDS[s]();
