// 下载两种架构的 macOS ffmpeg（片头片尾识别用）到 vendor/，已存在则跳过。
// 来源与 ffmpeg-static 包相同：https://github.com/eugeneware/ffmpeg-static/releases
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const TAG = 'b6.1.1';
const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'vendor');
fs.mkdirSync(dir, { recursive: true });

for (const arch of ['arm64', 'x64']) {
  const out = path.join(dir, `ffmpeg-${arch}`);
  if (fs.existsSync(out)) continue;
  const url = `https://github.com/eugeneware/ffmpeg-static/releases/download/${TAG}/ffmpeg-darwin-${arch}.gz`;
  console.log(`下载 ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败：HTTP ${res.status}`);
  fs.writeFileSync(out, zlib.gunzipSync(Buffer.from(await res.arrayBuffer())), { mode: 0o755 });
}
