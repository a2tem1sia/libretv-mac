'use client';

import { cn } from '@/lib/utils';

/** 开关：开为白（反相），关为深灰；不用强调色——强调色只留给数据 */
export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-content/60',
        checked ? 'bg-content' : 'bg-hover'
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute top-0.5 left-0.5 h-4 w-4 rounded-full transition-transform',
          checked ? 'translate-x-4 bg-page' : 'bg-faint'
        )}
      />
    </button>
  );
}
