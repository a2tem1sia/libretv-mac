'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { SmartImage } from './smart-image';
import { Icon } from './icon';
import { db, upsertHistory, type HistoryEntry } from '@/lib/db';
import { buildWatchUrl, formatTime } from '@/lib/utils';
import { resolveSource, useAppStore } from '@/lib/store';

/** 首页沉浸式区块：最近一部做大幅主推，其余做「继续观看」横排；无历史时不渲染 */
export function ContinueWatching() {
  const history = useLiveQuery(() => db.history.orderBy('timestamp').reverse().limit(9).toArray(), []);
  if (!history || history.length === 0) return null;
  const [hero, ...rest] = history;
  return (
    <>
      <Hero item={hero} />
      {rest.length > 0 && (
        <section className="mb-10">
          <h2 className="text-lg font-bold text-content mb-3">继续观看</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
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

function Poster({ item, className }: { item: HistoryEntry; className: string }) {
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);
  const [failed, setFailed] = useState(false);
  if (!item.pic || failed) return <div className={`${className} bg-chip`} aria-hidden />;
  return (
    <SmartImage
      url={item.pic}
      mode={imageProxyMode}
      customProxy={customImageProxy}
      alt=""
      className={`${className} object-cover bg-chip`}
      onExhausted={() => setFailed(true)}
    />
  );
}

function Hero({ item }: { item: HistoryEntry }) {
  const { href, percent, sourceName, touch } = useEntryLink(item);
  const remaining = item.duration > 0 ? Math.max(0, item.duration - item.playbackPosition) : 0;
  return (
    <section className="relative -mx-4 sm:mx-0 mb-10 overflow-hidden sm:rounded-2xl bg-card">
      {/* 海报放大虚化做背景，压暗保证文字对比度 */}
      <Poster item={item} className="absolute inset-0 w-full h-full scale-110 blur-2xl opacity-40" />
      {/* 照片上的中性压暗层，保证文字对比度 */}
      <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-page via-page/80 to-page/30" /> {/* taste-skill-ignore */}
      <div className="relative flex items-end gap-6 p-6 sm:p-10 min-h-[320px]">
        <Poster item={item} className="hidden sm:block w-40 aspect-[2/3] rounded-lg shrink-0" />
        <div className="flex flex-col gap-3 min-w-0 max-w-xl">
          <div className="text-[13px] text-muted">
            继续观看{sourceName ? ` · ${sourceName}` : ''}
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold text-content leading-tight line-clamp-2">{item.title}</h2>
          <div className="text-sm text-muted">
            {item.totalEpisodes > 1 && `第 ${item.episodeIndex + 1}/${item.totalEpisodes} 集`}
            {remaining > 0 && ` · 剩余 ${formatTime(remaining)}`}
          </div>
          {percent > 0 && (
            <div className="h-1 w-full max-w-sm bg-white/20 rounded-full overflow-hidden">
              <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
            </div>
          )}
          <div className="flex flex-wrap gap-3 mt-2">
            <Link
              href={href}
              onClick={touch}
              className="inline-flex items-center gap-2 h-11 px-6 rounded-lg bg-white text-black font-bold hover:bg-white/90 transition-colors"
            >
              <Icon name="play" className="w-4 h-4" />
              {item.totalEpisodes > 1 ? `继续播放 第 ${item.episodeIndex + 1} 集` : '继续播放'}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function ContinueCard({ item }: { item: HistoryEntry }) {
  const { href, percent, touch } = useEntryLink(item);
  return (
    <Link href={href} onClick={touch} className="group flex flex-col gap-2">
      <div className="relative aspect-video rounded-xl overflow-hidden bg-chip">
        <Poster item={item} className="w-full h-full group-hover:scale-105 transition-transform duration-300" />
        {percent > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-white/25">
            <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
          </div>
        )}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium text-content truncate">{item.title}</div>
        {item.totalEpisodes > 1 && (
          <div className="text-xs text-faint">第 {item.episodeIndex + 1}/{item.totalEpisodes} 集</div>
        )}
      </div>
    </Link>
  );
}
