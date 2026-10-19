// The ten recovery codes, shown once (FD-USERS §7): copy, download, and say they are kept. Used by the two-factor
// setup every account goes through (FD-2FA §1) and by the Security page (new codes).
import { useState } from 'react';
import { Copy, Download } from 'lucide-react';
import { copyText } from '../clipboard.ts';

export function RecoveryCodes({ codes, onDone, doneLabel = 'Gata' }: { codes: string[]; onDone: () => void; doneLabel?: string }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const [kept, setKept] = useState(false);
  const text = `Sentiq — coduri de recuperare (fiecare merge o singură dată)\n\n${codes.join('\n')}\n`;
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sentiq-coduri-recuperare.txt';
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="flex flex-col gap-3 rounded-[14px] border border-accent-dim bg-accent/[0.05] p-4">
      <p className="text-[13.5px]">
        <strong>Păstrează aceste coduri într-un loc sigur.</strong> Fiecare îți deschide contul o singură dată dacă nu ai telefonul la tine. Nu le vei mai vedea.
      </p>
      <ol className="num grid grid-cols-2 gap-x-6 gap-y-1.5 text-[15px] tracking-[0.04em] sm:w-fit">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn" onClick={() => void copyText(text).then(setCopied)}>
          <Copy size={14} aria-hidden />
          {copied ? 'Copiate' : 'Copiază'}
        </button>
        <button type="button" className="btn" onClick={download}>
          <Download size={14} aria-hidden />
          Descarcă .txt
        </button>
        <label className="ml-1 inline-flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={kept} onChange={(e) => setKept(e.target.checked)} />
          Le-am salvat
        </label>
        <button type="button" className="btn btn-primary" disabled={!kept} onClick={onDone}>
          {doneLabel}
        </button>
      </div>
      {copied === false && (
        <div role="alert" className="text-[13px] text-bear">
          Browserul nu a permis copierea; folosește „Descarcă .txt” sau notează-le.
        </div>
      )}
    </div>
  );
}
