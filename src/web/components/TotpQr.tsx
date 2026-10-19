// An authenticator's secret waiting for its first code (FD-USERS §7, FD-2FA): the QR code to scan and the same key
// written out, for the two-factor setup and for a change of authenticator.

/** Black on white with a quiet zone (made on the server): what phone cameras read best, also on a dark page. */
export function TotpQrImage({ qr, size = 220 }: { qr: string; size?: number }) {
  return <img src={qr} alt="Cod QR pentru aplicația de autentificare" width={size} height={size} className="shrink-0 rounded-[10px] bg-white" style={{ width: size, height: size }} />;
}

export function TotpManualKey({ secret }: { secret: string | null }) {
  if (!secret) return null;
  return (
    <p className="text-muted">
      Nu poți scana? Introdu cheia de mână: <span className="num break-all text-text select-all">{secret}</span>
    </p>
  );
}
