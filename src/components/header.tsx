'use client';

import Link from 'next/link';
import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ThemeToggle } from './theme';
import { SourceManagerDrawer } from './source-manager';
import { HistoryPanel } from './history-panel';
import { requestShowDownloadManager } from './download-manager';
import { Icon, type IconName } from './icon';
import { SearchHistoryDropdown, useSearchHistory } from './search-history';
import { cn } from '@/lib/utils';

/** 顶部导航：Logo、搜索框（首页外）、历史、设置 */
export function Header({ showSearch = false }: { showSearch?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [query, setQuery] = useState('');
  // 与首页搜索框共用同一套「最近搜索」下拉逻辑
  const searchHistory = useSearchHistory(query);

  const submitSearch = (text: string) => {
    const q = text.trim().slice(0, 100);
    if (!q) return;
    searchHistory.close();
    router.push(`/?s=${encodeURIComponent(q)}`, { scroll: false });
    // 顶栏搜索一并写入最近搜索（此前只有首页会记录）
    searchHistory.record(q);
  };

  const pickHistory = (text: string) => {
    setQuery(text);
    submitSearch(text);
  };

  return (
    <>
      {/* 桌面宽度：左侧固定侧栏（产品名 + 导航 + 资料库），当前项只靠文字变亮标识 */}
      <aside className="app-sidebar hidden lg:flex fixed inset-y-0 left-0 z-40 w-[224px] flex-col border-r border-line bg-page px-3 pt-5 pb-4">
        <Link href="/" className="flex items-center gap-2.5 px-3 mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-512.png" alt="" className="w-7 h-7 rounded-lg" />
          <span className="text-[17px] font-semibold text-content">LibreTV</span>
        </Link>
        <nav aria-label="主导航" className="flex flex-col gap-0.5">
          <SideLink href="/" active={pathname === '/'} icon="home">
            首页
          </SideLink>
          <SideLink href="/live" active={pathname === '/live'} icon="tv">
            直播
          </SideLink>
        </nav>
        <div className="px-3 mt-7 mb-1.5 text-xs text-faint">资料库</div>
        <div className="flex flex-col gap-0.5">
          <SideButton icon="clock" onClick={() => setHistoryOpen(true)}>
            观看历史
          </SideButton>
          <SideButton icon="download" onClick={requestShowDownloadManager}>
            下载
          </SideButton>
        </div>
        <div className="mt-auto flex flex-col gap-0.5">
          <SideButton icon="gear" onClick={() => setSettingsOpen(true)}>
            设置与资源
          </SideButton>
          <SideLink href="/about" active={pathname === '/about'} icon="info">
            关于
          </SideLink>
          <div className="px-1 pt-1">
            <ThemeToggle />
          </div>
        </div>
      </aside>

      {/* 窄屏顶栏；桌面宽度只在需要搜索框的页面保留 */}
      <header className={cn('sticky top-0 z-40 bg-page border-b border-line', !showSearch && 'lg:hidden')}>
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-3">
          <Link href="/" aria-label="LibreTV 首页" className="flex items-center gap-2 shrink-0 lg:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-512.png" alt="" className="w-7 h-7 rounded-lg" />
            <span className="text-base font-semibold text-content">LibreTV</span>
          </Link>

          {showSearch && (
            <form
              className="flex-1 max-w-xl hidden sm:block"
              onSubmit={(e) => {
                e.preventDefault();
                submitSearch(query);
              }}
            >
              <div ref={searchHistory.containerRef} className="relative">
                <input
                  className={cn(
                    'input w-full h-9',
                    // 展开时：上圆角与外框沿用聚焦样式，底边改为内部分隔线，与下拉拼成同一面板
                    searchHistory.visible &&
                      'rounded-b-none border-accent border-b-line bg-surface-raised focus-visible:ring-0'
                  )}
                  aria-label="搜索影片"
                  placeholder="搜索影片..."
                  value={query}
                  maxLength={100}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    searchHistory.resetActive();
                  }}
                  onFocus={searchHistory.onFocus}
                  onKeyDown={(e) => searchHistory.onKeyDown(e, pickHistory)}
                  role="combobox"
                  aria-expanded={searchHistory.visible}
                  aria-controls="header-search-history"
                  aria-autocomplete="list"
                  aria-activedescendant={
                    searchHistory.visible && searchHistory.activeIndex >= 0
                      ? `header-search-history-${searchHistory.activeIndex}`
                      : undefined
                  }
                />
                {searchHistory.visible && (
                  <SearchHistoryDropdown
                    id="header-search-history"
                    matches={searchHistory.matches}
                    activeIndex={searchHistory.activeIndex}
                    onPick={pickHistory}
                    onRemove={searchHistory.remove}
                    onClearAll={searchHistory.clearAll}
                  />
                )}
              </div>
            </form>
          )}

          <div className="flex-1 sm:hidden" />

          <nav className="flex items-center gap-1 ml-auto lg:hidden">
            <HeaderLink href="/live" active={pathname === '/live'}>
              直播
            </HeaderLink>
            <HeaderLink href="/about" active={pathname === '/about'}>
              关于
            </HeaderLink>
            <ThemeToggle />
            <IconButton label="观看历史" onClick={() => setHistoryOpen(true)}>
              <Icon name="clock" />
            </IconButton>
            <IconButton label="下载管理" onClick={requestShowDownloadManager}>
              <Icon name="download" />
            </IconButton>
            <IconButton label="设置" onClick={() => setSettingsOpen(true)}>
              <Icon name="gear" />
            </IconButton>
          </nav>
        </div>
      </header>

      <SourceManagerDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <HistoryPanel open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </>
  );
}

function HeaderLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        'px-2.5 py-1.5 rounded-md text-sm transition-colors',
        active ? 'text-content bg-hover' : 'text-muted hover:text-content'
      )}
    >
      {children}
    </Link>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className="p-2 rounded-md text-muted hover:text-content hover:bg-hover transition-colors"
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function SideLink({
  href,
  active,
  icon,
  children,
}: {
  href: string;
  active: boolean;
  icon: IconName;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-3 h-9 px-3 rounded-lg text-sm transition-colors hover:bg-hover',
        active ? 'text-content font-medium' : 'text-muted hover:text-content'
      )}
    >
      <Icon name={icon} className="w-[18px] h-[18px]" />
      {children}
    </Link>
  );
}

function SideButton({ icon, onClick, children }: { icon: IconName; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className="flex items-center gap-3 h-9 px-3 rounded-lg text-sm text-muted hover:text-content hover:bg-hover transition-colors text-left"
      onClick={onClick}
    >
      <Icon name={icon} className="w-[18px] h-[18px]" />
      {children}
    </button>
  );
}
