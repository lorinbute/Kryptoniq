// The two tabs of the Settings page (FD-ADMINSET): the user's own settings and, for the admin only, everyone's.
import { NavLink } from 'react-router';
import { clsx } from 'clsx';
import { ShieldCheck, UserRound } from 'lucide-react';

const TABS = [
  { to: '/settings', label: 'Ale mele', icon: UserRound },
  { to: '/settings/admin', label: 'Admin', icon: ShieldCheck },
];

/** Shown to the admin only: everybody else has just their own settings. */
export function SettingsTabs() {
  return (
    <nav aria-label="Setări" className="flex gap-1 border-b border-line">
      {TABS.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end
          className={({ isActive }) =>
            clsx(
              '-mb-px inline-flex h-10 items-center gap-2 border-b-2 px-3 text-[14px] no-underline transition-colors hover:no-underline',
              isActive ? 'border-accent font-semibold text-text' : 'border-transparent text-muted hover:text-text',
            )
          }
        >
          <Icon size={15} strokeWidth={1.9} aria-hidden className="shrink-0" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
