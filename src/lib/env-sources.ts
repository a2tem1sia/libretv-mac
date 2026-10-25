import type { SourceConfig } from './types';

/**
 * 部署者通过 DEFAULT_SOURCES 环境变量预置的采集站。
 * 格式为 JSON 数组：[{"name":"源名","url":"https://.../api.php/provide/vod","detail":"https://...","isAdult":false}]
 * 可选 "key":"env_xxx" 固定该源的标识：缺省按位置取 env_<序号>，删掉中间的源会让后面的标识整体错位，
 * 观看历史与勾选状态随之指错源；写明 key 后增删任意条目都不影响其余源。
 *
 * EXTRA_SOURCES 格式相同，追加在后面（缺省标识 env_x<序号>）：桌面版把它写在本机用户目录的 app.env 里，
 * 用于不随安装包分发的源（例如成人源）。与 DEFAULT_SOURCES 标识冲突的条目被跳过。
 * 任一变量解析失败时告警并忽略该变量，不影响站点运行。
 */
export function getEnvSources(): SourceConfig[] {
  const base = parseSources('DEFAULT_SOURCES', 'env_');
  const keys = new Set(base.map((s) => s.key));
  const extra = parseSources('EXTRA_SOURCES', 'env_x').filter((s) => {
    if (!keys.has(s.key)) return true;
    console.warn(`[LibreTV] EXTRA_SOURCES 的 ${s.key} 与 DEFAULT_SOURCES 重复，已跳过`);
    return false;
  });
  return [...base, ...extra];
}

function parseSources(envName: 'DEFAULT_SOURCES' | 'EXTRA_SOURCES', keyPrefix: string): SourceConfig[] {
  const raw = process.env[envName];
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
      const finalKey = typeof key === 'string' ? key : `${keyPrefix}${i}`;
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
    console.warn(`[LibreTV] ${envName} 解析失败，已忽略：`, err instanceof Error ? err.message : err);
    return [];
  }
}
