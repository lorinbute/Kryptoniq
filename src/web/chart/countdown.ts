// How long until the last candle closes (FD-CHARTTV §5), as TradingView shows it under the current price.

const pad = (n: number) => String(n).padStart(2, '0');

/** "50:31" under an hour, "12:34:56" under a day, "3z 04:10" beyond; a candle already due shows "00:00". */
export function fmtBarCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (days > 0) return `${days}z ${pad(h)}:${pad(m)}`;
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}
