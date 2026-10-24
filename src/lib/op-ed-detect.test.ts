import { describe, expect, it } from 'vitest';
import { SAMPLE_RATE, findCommonSegment, fingerprint } from './op-ed-detect';

/** 可复现的伪随机「音乐」：每 0.25s 换一组随机音高的正弦叠加 */
function music(seconds: number, seed: number): Float32Array {
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const out = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  const step = Math.round(SAMPLE_RATE / 4);
  for (let i = 0; i < out.length; i += step) {
    const freqs = [rand(), rand(), rand()].map((r) => 300 + r * 1700);
    for (let k = i; k < Math.min(i + step, out.length); k++) {
      out[k] = freqs.reduce((sum, f) => sum + 0.2 * Math.sin((2 * Math.PI * f * k) / SAMPLE_RATE), 0);
    }
  }
  return out;
}

function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe('findCommonSegment', () => {
  const op = music(40, 7);

  it('finds the shared OP at different offsets in two episodes', () => {
    const noisyOp = op.map((v, i) => v + 0.01 * Math.sin(i * 12.9898));
    const a = concat(music(10, 1), op, music(60, 2));
    const b = concat(music(25, 3), noisyOp, music(50, 4));
    const r = findCommonSegment(fingerprint(a), fingerprint(b));
    expect(r).not.toBeNull();
    expect(r!.aStart).toBeCloseTo(10, 0);
    expect(r!.bStart).toBeCloseTo(25, 0);
    expect(r!.aEnd - r!.aStart).toBeGreaterThan(38);
    expect(r!.aEnd - r!.aStart).toBeLessThan(42);
  });

  it('returns null for unrelated audio and for shared silence', () => {
    const silence = new Float32Array(30 * SAMPLE_RATE);
    const a = concat(silence, music(60, 5));
    const b = concat(silence, music(60, 6));
    expect(findCommonSegment(fingerprint(a), fingerprint(b))).toBeNull();
  });
});
