// Passkeys in the browser: what a failed ceremony means to the person (sign-in, Security, switching trading on).
import { WebAuthnError } from '@simplewebauthn/browser';
import { errorMessage } from './api.ts';

/** A WebAuthn failure the person can understand (cancelled, no passkey for this site…). */
export function passkeyMessage(err: unknown): string {
  if (err instanceof WebAuthnError) {
    if (err.code === 'ERROR_CEREMONY_ABORTED' || (err.cause instanceof Error && err.cause.name === 'NotAllowedError')) return 'Operația a fost anulată sau a expirat.';
    if (err.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') return 'Acest dispozitiv are deja un passkey pentru contul tău.';
    if (err.code === 'ERROR_INVALID_DOMAIN' || err.code === 'ERROR_INVALID_RP_ID') return 'Passkey-urile merg doar pe http://localhost sau pe HTTPS.';
    return err.message;
  }
  if (err instanceof Error && err.name === 'NotAllowedError') return 'Operația a fost anulată sau a expirat.';
  return errorMessage(err);
}
