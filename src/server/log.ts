// Minimal logger: console + rotating-by-day file in data/logs, with secret redaction.
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

const SECRET_RE = /("?(?:apiKey|api_key|secret|password|pwd|passphrase|claudeKey|x-api-key)"?\s*[:=]\s*)"?[^",\s}]+"?/gi;

export function redact(msg: string): string {
  return msg.replace(SECRET_RE, '$1"[redacted]"');
}

export function createLogger(dir: string | null, quiet = false): Logger {
  if (dir) mkdirSync(dir, { recursive: true });
  const write = (level: string, msg: string) => {
    const line = `${new Date().toISOString()} ${level} ${redact(msg)}`;
    if (!quiet) (level === 'ERROR' ? console.error : console.log)(line);
    if (dir) {
      try {
        appendFileSync(path.join(dir, `sentiq-${line.slice(0, 10)}.log`), line + '\n');
      } catch {
        // logging must never crash the app
      }
    }
  };
  return {
    info: (m) => write('INFO', m),
    warn: (m) => write('WARN', m),
    error: (m) => write('ERROR', m),
  };
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };
