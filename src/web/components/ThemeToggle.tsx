// The theme switch (FD-THEME §2): a sun on the dark theme, a moon on the light one; the label says what it does.
import { clsx } from 'clsx';
import { Moon, Sun } from 'lucide-react';
import { setTheme, useTheme } from '../theme.ts';

export function ThemeToggle({ className }: { className?: string }) {
  const theme = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  const label = next === 'light' ? 'Trece la tema luminoasă' : 'Trece la tema întunecată';
  const Icon = theme === 'dark' ? Sun : Moon;
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={label}
      title={label}
      className={clsx(
        'inline-grid size-9 shrink-0 place-items-center rounded-[10px] border border-line-strong bg-panel text-muted transition-colors hover:border-accent hover:bg-hover hover:text-text',
        className,
      )}
    >
      <Icon size={16} aria-hidden />
    </button>
  );
}
