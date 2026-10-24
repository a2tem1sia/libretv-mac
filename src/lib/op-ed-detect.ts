/**
 * 片头片尾自动识别：同一部剧相邻两集的 OP/ED 音频几乎相同，
 * 对两集的开头（或结尾）音频做指纹，找出两者最长的公共片段即为 OP（或 ED）。
 *
 * 指纹为 Haitsma-Kalker 式子带能量差分：每帧 32 bit，相同音频的比特误差很低，
 * 不相关音频约为一半（16 bit）。本模块只做纯计算，解码见 api/skip-detect。
 */

/** 解码采样率：指纹只用 300-2000Hz，5512Hz 足够且数据量小 */
export const SAMPLE_RATE = 5512;
const FRAME = 2048;
const HOP = 512;
const BANDS = 33;
const LOW_HZ = 300;
const HIGH_HZ = 2000;
/** 单帧比特误差不超过该值视为匹配 */
const MAX_BIT_ERRORS = 8;
/** 公共片段内允许的连续不匹配帧数（约 0.75s），容忍局部压缩差异 */
const MAX_GAP_FRAMES = 8;
/** 低于该 RMS 的帧视为静音，不参与匹配（静音帧指纹全 0，会互相误配） */
const SILENCE_RMS = 0.005;

export const FRAME_SECONDS = HOP / SAMPLE_RATE;

export interface Fingerprint {
  hashes: Uint32Array;
  /** 每帧是否有声（静音帧不参与匹配） */
  voiced: Uint8Array;
}

/** 原地迭代 radix-2 FFT */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** PCM（-1..1，SAMPLE_RATE 单声道）→ 指纹 */
export function fingerprint(pcm: Float32Array): Fingerprint {
  const frames = pcm.length < FRAME ? 0 : Math.floor((pcm.length - FRAME) / HOP) + 1;
  const edges: number[] = [];
  for (let m = 0; m <= BANDS; m++) {
    const hz = LOW_HZ * Math.pow(HIGH_HZ / LOW_HZ, m / BANDS);
    edges.push(Math.round((hz * FRAME) / SAMPLE_RATE));
  }
  const win = new Float64Array(FRAME);
  for (let i = 0; i < FRAME; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1));

  const re = new Float64Array(FRAME);
  const im = new Float64Array(FRAME);
  const energies: Float64Array[] = [];
  const voicedAll = new Uint8Array(frames);
  for (let f = 0; f < frames; f++) {
    let sq = 0;
    for (let i = 0; i < FRAME; i++) {
      const s = pcm[f * HOP + i];
      sq += s * s;
      re[i] = s * win[i];
      im[i] = 0;
    }
    voicedAll[f] = Math.sqrt(sq / FRAME) >= SILENCE_RMS ? 1 : 0;
    fft(re, im);
    const e = new Float64Array(BANDS);
    for (let m = 0; m < BANDS; m++) {
      let sum = 0;
      for (let k = edges[m]; k < Math.max(edges[m + 1], edges[m] + 1); k++) sum += re[k] * re[k] + im[k] * im[k];
      e[m] = sum;
    }
    energies.push(e);
  }

  const n = Math.max(frames - 1, 0);
  const hashes = new Uint32Array(n);
  const voiced = new Uint8Array(n);
  for (let f = 1; f < frames; f++) {
    const cur = energies[f];
    const prev = energies[f - 1];
    let h = 0;
    for (let m = 0; m < 32; m++) {
      if (cur[m] - cur[m + 1] - (prev[m] - prev[m + 1]) > 0) h |= 1 << m;
    }
    hashes[f - 1] = h >>> 0;
    voiced[f - 1] = voicedAll[f] & voicedAll[f - 1];
  }
  return { hashes, voiced };
}

function popcount(x: number): number {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24);
}

export interface CommonSegment {
  /** 两段音频内的起止时间（秒，相对各自 PCM 起点） */
  aStart: number;
  aEnd: number;
  bStart: number;
  bEnd: number;
}

/**
 * 两段指纹的最长公共片段（任意错位），短于 minSeconds 返回 null。
 * 复杂度 O(nA·nB) 次 popcount：6 分钟音频约 3500 帧，千万级运算，百毫秒量级。
 */
export function findCommonSegment(a: Fingerprint, b: Fingerprint, minSeconds = 15): CommonSegment | null {
  const nA = a.hashes.length;
  const nB = b.hashes.length;
  let best = { len: 0, i: 0, j: 0 };
  for (let d = -(nB - 1); d < nA; d++) {
    const iStart = Math.max(0, d);
    const iEnd = Math.min(nA, nB + d);
    let runStart = -1;
    let lastHit = -1;
    for (let i = iStart; i < iEnd; i++) {
      const j = i - d;
      const hit = a.voiced[i] && b.voiced[j] && popcount(a.hashes[i] ^ b.hashes[j]) <= MAX_BIT_ERRORS;
      if (hit) {
        if (runStart < 0 || i - lastHit > MAX_GAP_FRAMES) runStart = i;
        lastHit = i;
        const len = lastHit - runStart + 1;
        if (len > best.len) best = { len, i: runStart, j: runStart - d };
      }
    }
  }
  if (best.len * FRAME_SECONDS < minSeconds) return null;
  const span = best.len * FRAME_SECONDS + (FRAME - HOP) / SAMPLE_RATE;
  return {
    aStart: best.i * FRAME_SECONDS,
    aEnd: best.i * FRAME_SECONDS + span,
    bStart: best.j * FRAME_SECONDS,
    bEnd: best.j * FRAME_SECONDS + span,
  };
}
