// A passkey for the tests (FD-USERS §5, FD-TRADEUNLOCK): what a real authenticator answers, signed with a fresh key.
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';

/** A software authenticator: a P-256 key, attestation "none", user verification done. */
export function softAuthenticator(rpId: string, origin: string) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  const credId = randomBytes(16);
  const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64url');
  const rpHash = createHash('sha256').update(rpId).digest();
  let counter = 0;
  let userHandle = '';
  const authData = (flags: number, attested?: Buffer, signCount = counter) => {
    const count = Buffer.alloc(4);
    count.writeUInt32BE(signCount);
    return Buffer.concat([rpHash, Buffer.from([flags]), count, ...(attested ? [attested] : [])]);
  };
  return {
    id: b64(credId),
    create(options: { challenge: string; user: { id: string } }) {
      userHandle = options.user.id;
      const cose = new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.from(jwk.x, 'base64url')],
        [-3, Buffer.from(jwk.y, 'base64url')],
      ]);
      const len = Buffer.alloc(2);
      len.writeUInt16BE(credId.length);
      const attested = Buffer.concat([Buffer.alloc(16), len, credId, Buffer.from(isoCBOR.encode(cose))]);
      const attestationObject = isoCBOR.encode(new Map<string, unknown>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData(0x45, attested)]]) as never);
      const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin, crossOrigin: false }));
      return {
        id: b64(credId),
        rawId: b64(credId),
        type: 'public-key',
        response: { clientDataJSON: b64(clientData), attestationObject: b64(attestationObject), transports: ['internal'] },
        clientExtensionResults: {},
        authenticatorAttachment: 'platform',
      };
    },
    /** `signCount`: what a cloned authenticator would send (a counter behind the real one's). */
    get(options: { challenge: string }, handle = userHandle, signCount?: number) {
      counter++;
      const data = authData(0x05, undefined, signCount ?? counter);
      const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin, crossOrigin: false }));
      const signature = sign('sha256', Buffer.concat([data, createHash('sha256').update(clientData).digest()]), privateKey);
      return {
        id: b64(credId),
        rawId: b64(credId),
        type: 'public-key',
        response: { clientDataJSON: b64(clientData), authenticatorData: b64(data), signature: b64(signature), userHandle: handle },
        clientExtensionResults: {},
        authenticatorAttachment: 'platform',
      };
    },
  };
}
