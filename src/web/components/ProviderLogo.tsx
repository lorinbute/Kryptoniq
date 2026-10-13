// The logo of an exchange or broker (FD-SENTIQ §2), or a badge with its initials when there is none.
import { useState } from 'react';
import { clsx } from 'clsx';
import { providerById } from '../../shared/providers.ts';
import { coinHue } from '../icons.ts';

export function ProviderLogo({ id, size = 32, className }: { id: string; size?: number; className?: string }) {
  const p = providerById(id);
  const [failed, setFailed] = useState(false);
  const name = p?.name ?? id;
  if (p?.logo && !failed) {
    return (
      <img
        src={`/provider-logos/${p.logo}`}
        alt=""
        width={size}
        height={size}
        className={clsx('shrink-0 rounded-[22%] object-contain', className)}
        style={{ width: size, height: size }}
        onError={() => setFailed(true)}
      />
    );
  }
  const hue = coinHue(name);
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      className={clsx('inline-flex shrink-0 items-center justify-center rounded-[22%] font-bold', className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38), background: `hsl(${hue} 35% 22%)`, color: `hsl(${hue} 70% 78%)` }}
      aria-hidden
    >
      {initials}
    </span>
  );
}
