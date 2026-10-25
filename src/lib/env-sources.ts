import type { SourceConfig } from './types';

/**
 * 部署者通过 DEFAULT_SOURCES 环境变量预置的采集站。
 * 格式为 JSON 数组：[{"name":"源名","url":"https://.../api.php/provide/vod","detail":"https://...","isAdult":false}]
 * 可选 "key":"env_xxx" 固定该源的标识：缺省按位置取 env_<序号>，删掉中间的源会让后面的标识整体错位，
 * 观看历史与勾选状态随之指错源；写明 key 后增删任意条目都不影响其余源。
 * 解析失败时告警并整体忽略，不影响站点运行。
 */
export function getEnvSources(): SourceConfig[] {
  const raw = process.env.DEFAULT_SOURCES;
  if (!raw || !raw.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('必须是 JSON 数组');
    const seen = new Set<string>();
    const list: SourceConfig[] = parsed.map((item, i) => {
      if (typeof item !== 'object' || item === null) {
        throw new Error(`第 ${i + 1} 项不是对象`);
      }
      const { name, url, detail, isAdult, key } = item as Record<string, unknown>;
      if (typeof name !== 'string' || !name.trim()) {
        throw new Error(`第 ${i + 1} 项缺少 name`);
      }
      if (typeof url !== 'string' || !/^https?:\/\//.test(url.trim())) {
        throw new Error(`第 ${i + 1} 项的 url 必须以 http:// 或 https:// 开头`);
      }
      if (key !== undefined && (typeof key !== 'string' || !/^env_[A-Za-z0-9_-]{1,40}$/.test(key))) {
        throw new Error(`第 ${i + 1} 项的 key 必须形如 env_xxx`);
      }
      const finalKey = typeof key === 'string' ? key : `env_${i}`;
      if (seen.has(finalKey)) throw new Error(`第 ${i + 1} 项的 key 与前面重复：${finalKey}`);
      seen.add(finalKey);
      return {
        key: finalKey,
        name: name.trim(),
        url: url.trim().replace(/\/+$/, ''),
        detail: typeof detail === 'string' && detail.trim() ? detail.trim() : undefined,
        isAdult: isAdult === true,
      };
    });
    return list;
  } catch (err) {
    console.warn('[LibreTV] DEFAULT_SOURCES 解析失败，已忽略：', err instanceof Error ? err.message : err);
    return [];
  }
}
