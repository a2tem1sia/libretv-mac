'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { SmartImage } from './smart-image';
import { Icon } from './icon';
import { db, upsertHistory, type HistoryEntry } from '@/lib/db';
import { buildWatchUrl, cn, formatTime } from '@/lib/utils';
import { resolveSource, useAppStore } from '@/lib/store';

/** 剧集进度条最多画多少格；更长的剧改画一条连续进度 */
const STRIP_MAX = 40;

/** 首页：最近一部做主推（封面 + 剧集进度条），其余做「继续观看」海报排；无历史时不渲染 */
export function ContinueWatching() {
  const history = useLiveQuery(() => db.history.orderBy('timestamp').reverse().limit(13).toArray(), []);
  if (!history || history.length === 0) return null;
  const [hero, ...rest] = history;
  return (
    <>
      <Hero item={hero} />
      {rest.length > 0 && (
        <section className="mb-12">
          <h2 className="text-lg font-semibold text-content mb-4">继续观看</h2>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-x-4 gap-y-6">
            {rest.map((item) => (
              <ContinueCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function useEntryLink(item: HistoryEntry) {
  const customAPIs = useAppStore((s) => s.customAPIs);
  const envSources = useAppStore((s) => s.envSources);
  const source = resolveSource({ customAPIs, envSources }, item.sourceKey);
  const href = buildWatchUrl({
    sourceKey: item.sourceKey,
    vodId: item.vodId,
    index: item.episodeIndex,
    title: item.title,
    sourceUrl: source?.url,
    detail: source?.detail,
  });
  const percent =
    item.duration > 0 && item.playbackPosition > 10
      ? Math.min(100, Math.round((item.playbackPosition / item.duration) * 100))
      : 0;
  // 点击即置顶最近观看（与历史面板一致）
  const touch = () => upsertHistory({ ...item, timestamp: Date.now() }).catch(() => {});
  return { href, percent, sourceName: source?.name, touch };
}

/** optional：没有封面时什么都不画（主推区不放灰块） */
function Poster({ item, className, optional }: { item: HistoryEntry; className: string; optional?: boolean }) {
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);
  const [failed, setFailed] = useState(false);
  if (!item.pic || failed) return optional ? null : <div className={`${className} bg-hover`} aria-hidden />;
  return (
    <SmartImage
      url={item.pic}
      mode={imageProxyMode}
      customProxy={customImageProxy}
      alt=""
      className={`${className} object-cover bg-hover`}
      onExhausted={() => setFailed(true)}
    />
  );
}

/** 剧集进度条：看完的集、正在看的这一集（按播放进度部分填充）、没看的集 */
function EpisodeStrip({ current, total, percent }: { current: number; total: number; percent: number }) {
  const label = `已看 ${current} 集 · 共 ${total} 集`;
  if (total > STRIP_MAX) {
    const ratio = ((current + percent / 100) / total) * 100;
    return (
      <div className="flex flex-col gap-2 max-w-md" role="img" aria-label={label}>
        <div className="h-1.5 rounded-full bg-hover overflow-hidden">
          <div className="h-full bg-accent" style={{ width: `${ratio}%` }} />
        </div>
        <span className="text-[13px] text-faint tabular-nums">{label}</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 max-w-md" role="img" aria-label={label}>
      <div className="flex gap-[3px]">
        {Array.from({ length: total }, (_, i) => (
          <div key={i} className="relative h-1.5 flex-1 max-w-[18px] rounded-full bg-hover overflow-hidden">
            {i < current && <div className="absolute inset-0 bg-accent" />}
            {i === current && <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${percent}%` }} />}
          </div>
        ))}
      </div>
      <span className="text-[13px] text-faint tabular-nums">{label}</span>
    </div>
  );
}

function Hero({ item }: { item: HistoryEntry }) {
  const { href, percent, sourceName, touch } = useEntryLink(item);
  const remaining = item.duration > 0 ? Math.max(0, item.duration - item.playbackPosition) : 0;
  const series = item.totalEpisodes > 1;
  return (
    <section aria-label="继续观看" className="relative mb-12 overflow-hidden rounded-[20px] bg-card">
      {/* 封面放大虚化做底，左侧压暗保证文字对比度 */}
      <Poster optional item={item} className="absolute inset-0 w-full h-full scale-125 blur-3xl opacity-50" />
      <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-black via-black/85 to-black/40" /> {/* taste-skill-ignore */}
      <div className="relative flex items-center gap-8 p-6 sm:p-10 min-h-[340px]">
        <div className="flex flex-col gap-4 min-w-0 flex-1">
          <div className="text-[13px] text-muted">继续观看{sourceName ? ` · ${sourceName}` : ''}</div>
          <h2 className="text-[32px] leading-tight font-semibold text-content line-clamp-2">{item.title}</h2>
          <div className="text-sm text-muted tabular-nums">
            {series ? `第 ${item.episodeIndex + 1} 集` : '正片'}
            {remaining > 0 && ` · 剩余 ${formatTime(remaining)}`}
          </div>
          {series ? (
            <EpisodeStrip current={item.episodeIndex} total={item.totalEpisodes} percent={percent} />
          ) : (
            percent > 0 && (
              <div className="h-1.5 max-w-md rounded-full bg-hover overflow-hidden">
                <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
              </div>
            )
          )}
          <div className="mt-2">
            <Link
              href={href}
              onClick={touch}
              className="inline-flex items-center gap-2 h-11 px-6 rounded-full bg-content text-page text-[15px] font-semibold hover:opacity-90 transition-opacity"
            >
              <Icon name="play" className="w-4 h-4" />
              {series ? `继续播放 第 ${item.episodeIndex + 1} 集` : '继续播放'}
            </Link>
          </div>
        </div>
        <Poster optional item={item} className="hidden md:block w-48 aspect-[2/3] rounded-xl shrink-0" />
      </div>
    </section>
  );
}

function ContinueCard({ item }: { item: HistoryEntry }) {
  const { href, percent, touch } = useEntryLink(item);
  return (
    <Link
      href={href}
      onClick={touch}
      className="group flex flex-col gap-2 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-content/60"
    >
      <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-hover">
        <Poster item={item} className="w-full h-full transition-transform duration-300 group-hover:scale-105" />
      </div>
      <div className={cn('h-1 rounded-full bg-hover overflow-hidden', percent === 0 && 'invisible')}>
        <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium text-content truncate">{item.title}</div>
        <div className="text-xs text-faint tabular-nums">
          {item.totalEpisodes > 1 ? `第 ${item.episodeIndex + 1}/${item.totalEpisodes} 集` : '电影'}
        </div>
      </div>
    </Link>
  );
}
