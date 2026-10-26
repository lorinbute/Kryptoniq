// "The server does not answer" (FD-ONLINE §3): under the top bar, and in the chart's full screen too (FD-CHARTAUDIT §7).
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { api } from '../api.ts';

/** Polled by the top bar status dot and the offline banner (one shared query). */
export function usePing() {
  return useQuery({ queryKey: ['ping'], queryFn: () => api.get<{ ok: boolean }>('/api/ping'), refetchInterval: 15_000, retry: 0 });
}

/** Sentiq opened on the computer that runs it (http://localhost), not on its public or network address. */
const isThisComputer = () => ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

/**
 * Shown when the server stops answering: pages keep their last data, this says it may be stale. `framed`: a box of its
 * own (in the chart's full screen), not a strip across the page; a polite status there, since the page's own banner
 * (behind the full screen, still read) already alerts.
 */
export function OfflineBanner({ framed = false }: { framed?: boolean }) {
  const ping = usePing();
  if (!ping.isError) return null;
  return (
    <div role={framed ? 'status' : 'alert'} className={clsx('border-bear/40 bg-bear/10 text-[13.5px]', framed ? 'rounded-xl border px-4 py-2.5' : 'border-b px-4 py-2.5 sm:px-6')}>
      {/* FD-ONLINE §3: what to do depends on where Sentiq is opened (this Mac, or the public address). */}
      {isThisComputer() ? (
        <>
          Serverul Sentiq nu răspunde. Datele afișate pot fi vechi; deschide <strong>Sentiq.app</strong> sau rulează <code>scripts/sentiq.sh start</code>.
        </>
      ) : (
        'Serverul Sentiq nu răspunde. Datele afișate pot fi vechi; pagina revine singură când serverul răspunde.'
      )}
    </div>
  );
}
