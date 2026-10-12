// AES-256-GCM encryption for secrets at rest (exchange API keys, Anthropic key).
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PREFIX = 'v1';

export class SecretBox {
  private readonly key: Buffer;

  constructor(key: Buffer) {
    if (key.length !== 32) throw new Error('Master key must be 32 bytes');
    this.key = key;
  }

  /**
   * Loads the master key from KRYPTONIQ_MASTER_KEY (base64) or `<dataDir>/master.key`,
   * generating the file (mode 0600) on first run.
   */
  static load(dataDir: string, env: NodeJS.ProcessEnv = process.env): SecretBox {
    const fromEnv = env.KRYPTONIQ_MASTER_KEY;
    if (fromEnv) {
      const key = Buffer.from(fromEnv, 'base64');
      if (key.length !== 32) throw new Error('KRYPTONIQ_MASTER_KEY must be 32 bytes, base64 encoded');
      return new SecretBox(key);
    }
    const file = path.join(dataDir, 'master.key');
    if (existsSync(file)) {
      const key = Buffer.from(readFileSync(file, 'utf8').trim(), 'base64');
      if (key.length !== 32) throw new Error(`Corrupted master key at ${file}`);
      return new SecretBox(key);
    }
    mkdirSync(dataDir, { recursive: true });
    const key = randomBytes(32);
    writeFileSync(file, key.toString('base64'), { mode: 0o600 });
    chmodSync(file, 0o600);
    return new SecretBox(key);
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [PREFIX, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
  }

  decrypt(sealed: string): string {
    const parts = sealed.split(':');
    if (parts.length !== 4 || parts[0] !== PREFIX) throw new Error('Unsupported secret format');
    const [, iv, tag, ct] = parts as [string, string, string, string];
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8');
  }
}

/** `abcd…wxyz` style hint that never reveals more than 8 characters. */
export function secretHint(secret: string): string {
  const s = secret.trim();
  if (s.length <= 8) return '••••';
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}
