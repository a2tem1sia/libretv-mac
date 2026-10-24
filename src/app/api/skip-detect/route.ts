import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { guardRequest, jsonError } from '@/lib/api-guard';
import { makeAbsolute, stripAdGroups } from '@/lib/m3u8';
import { SAMPLE_RATE, findCommonSegment, fingerprint } from '@/lib/op-ed-detect';
import type { SkipSegment } from '@/lib/skip-marks';
import { checkUpstreamAllowed } from '@/lib/ssrf';

export const runtime = 'nodejs';

/**
 * 片头片尾自动识别：取相邻两集开头/结尾各 5 分钟音频做指纹比对。
 * 依赖 ffmpeg（桌面版由 Electron 通过 FFMPEG_PATH 提供）；未配置时返回 501，前端静默跳过。
 */
const HEAD_SECONDS = 300;
const TAIL_SECONDS = 300;
const FFMPEG_TIMEOUT_MS = 180_000;
/** 公共片段离开头/结尾不足该秒数时归为「片头 / 片尾」，否则为中段 */
const EDGE_SNAP_SECONDS = 5;
const UA =
  process.env.USER_AGENT ||
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

interface EpisodeResult {
  duration: number;
  segments: SkipSegment[];
}

async function fetchText(url: string): Promise<string> {
  const verdict = await checkUpstreamAllowed(url);
  if (!verdict.ok) throw new Error(verdict.reason);
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`播放列表拉取失败：HTTP ${res.status}`);
  return res.text();
}

/** 把一集地址转成 ffmpeg 输入：m3u8 解析到 media 列表（与播放器同样过滤广告）后落临时文件；其他直接用 URL */
async function toFfmpegInput(url: string, adFilter: boolean, dir: string, name: string, depth = 0): Promise<string> {
  if (depth > 3) throw new Error('m3u8 嵌套过深');
  let text = await fetchText(url);
  if (!text.trimStart().startsWith('#EXTM3U')) return url;
  if (adFilter) text = stripAdGroups(text);

  if (text.includes('#EXT-X-STREAM-INF')) {
    // 音频各档相同，选码率最低的一档，少下载
    let best: { bw: number; url: string } | undefined;
    let pendingBw: number | undefined;
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (line.startsWith('#EXT-X-STREAM-INF')) pendingBw = parseInt(line.match(/BANDWIDTH=(\d+)/)?.[1] || '0', 10);
      else if (line && !line.startsWith('#') && pendingBw !== undefined) {
        if (!best || pendingBw < best.bw) best = { bw: pendingBw, url: makeAbsolute(line, url) };
        pendingBw = undefined;
      }
    }
    if (!best) throw new Error('master m3u8 无可用档位');
    return toFfmpegInput(best.url, adFilter, dir, name, depth + 1);
  }

  const abs = (u: string) => {
    const r = makeAbsolute(u, url);
    if (!/^https?:\/\//i.test(r)) throw new Error('播放列表含非 http 地址');
    return r;
  };
  const out = text
    .split('\n')
    .map((line) => {
      const t = line.trim();
      if (t.startsWith('#')) return t.replace(/URI="([^"]+)"/g, (_, u: string) => `URI="${abs(u)}"`);
      return t ? abs(t) : t;
    })
    .join('\n');
  const file = path.join(dir, `${name}.m3u8`);
  await fs.writeFile(file, out);
  return file;
}

/** 解码一段音频为 SAMPLE_RATE 单声道 PCM，同时从 ffmpeg 日志取总时长 */
function decodeAudio(input: string, range: 'head' | 'tail'): Promise<{ pcm: Float32Array; duration: number }> {
  const ffmpeg = process.env.FFMPEG_PATH!;
  const seek = range === 'head' ? ['-t', String(HEAD_SECONDS)] : ['-sseof', `-${TAIL_SECONDS}`];
  const args = [
    '-hide_banner', '-nostdin', '-loglevel', 'info',
    '-protocol_whitelist', 'file,http,https,tcp,tls,crypto',
    // user_agent 是 http 协议选项，本地 m3u8 文件输入不认（分片请求用 ffmpeg 默认 UA）
    ...(/^https?:/i.test(input) ? ['-user_agent', UA] : []),
    ...seek, '-i', input,
    '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', 'pipe:1',
  ];
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let stderr = '';
    const timer = setTimeout(() => proc.kill('SIGKILL'), FFMPEG_TIMEOUT_MS);
    proc.stdout.on('data', (c: Buffer) => chunks.push(c));
    proc.stderr.on('data', (c: Buffer) => {
      if (stderr.length < 64_000) stderr += c.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      clearTimeout(timer);
      const buf = Buffer.concat(chunks);
      const m = stderr.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
      const duration = m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
      if (!buf.length || !duration) {
        reject(new Error(`音频解码失败（ffmpeg ${code}）：${stderr.trim().split('\n').pop() ?? ''}`));
        return;
      }
      const usable = buf.length - (buf.length % 4);
      resolve({ pcm: new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + usable)), duration });
    });
  });
}

function opSegment(start: number, end: number): SkipSegment {
  return start <= EDGE_SNAP_SECONDS ? { type: 'opening', start: 0, end } : { type: 'middle', start, end };
}

function edSegment(start: number, end: number, duration: number): SkipSegment {
  return duration - end <= EDGE_SNAP_SECONDS ? { type: 'ending', start, end: -1 } : { type: 'middle', start, end };
}

export async function POST(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;
  if (!process.env.FFMPEG_PATH) return jsonError('当前部署不支持自动识别（缺少 ffmpeg）', 501);

  const body = (await req.json().catch(() => ({}))) as { a?: unknown; b?: unknown; adFilter?: unknown };
  if (typeof body.a !== 'string' || typeof body.b !== 'string') return jsonError('缺少 a / b 两集地址', 400);
  for (const u of [body.a, body.b]) {
    const verdict = await checkUpstreamAllowed(u);
    if (!verdict.ok) return jsonError(verdict.reason, 400);
  }
  const adFilter = body.adFilter !== false;

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'libretv-skip-'));
  try {
    const [inA, inB] = await Promise.all([
      toFfmpegInput(body.a, adFilter, dir, 'a'),
      toFfmpegInput(body.b, adFilter, dir, 'b'),
    ]);
    const [headA, headB, tailA, tailB] = await Promise.all([
      decodeAudio(inA, 'head'),
      decodeAudio(inB, 'head'),
      decodeAudio(inA, 'tail'),
      decodeAudio(inB, 'tail'),
    ]);
    const a: EpisodeResult = { duration: headA.duration, segments: [] };
    const b: EpisodeResult = { duration: headB.duration, segments: [] };

    const op = findCommonSegment(fingerprint(headA.pcm), fingerprint(headB.pcm));
    if (op) {
      a.segments.push(opSegment(op.aStart, op.aEnd));
      b.segments.push(opSegment(op.bStart, op.bEnd));
    }
    const ed = findCommonSegment(fingerprint(tailA.pcm), fingerprint(tailB.pcm));
    if (ed) {
      // 尾段 PCM 以视频结尾对齐：起点 = 时长 - 实际解码长度
      const offA = a.duration - tailA.pcm.length / SAMPLE_RATE;
      const offB = b.duration - tailB.pcm.length / SAMPLE_RATE;
      const segA = edSegment(offA + ed.aStart, offA + ed.aEnd, a.duration);
      const segB = edSegment(offB + ed.bStart, offB + ed.bEnd, b.duration);
      // 短片（不足两个窗口）头尾窗口重叠时，同一段会被识别两次
      if (!op || segA.start > op.aEnd) a.segments.push(segA);
      if (!op || segB.start > op.bEnd) b.segments.push(segB);
    }
    return NextResponse.json({ a, b });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : '识别失败', 502);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
