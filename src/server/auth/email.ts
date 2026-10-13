// Mail through Resend (FD-USERS §6, FD-INVITE), as Serento.Web's ResendEmailSender. Development: the sender is
// Resend's test address (onboarding@resend.dev), which only delivers to the Resend account's own email.
//
// WHAT GOES TO THE LOG WHEN NO MAIL CAN BE SENT:
// - an activation link sets an account's first password: never logged; the admin who approved has it on the page;
// - a password-reset link is a temporary password for that account: logged only when there is no key at all (the
//   one case where nobody could ever use it otherwise), never after a refused or failed send (Serento's rule);
// - the admin's notice of a new request carries no secret.
import { httpRequest } from '../net/http.ts';
import type { Logger } from '../log.ts';

export interface MailSettings {
  apiKey: string | null;
  from: string;
}

export type MailKind = 'activate' | 'request' | 'reset' | 'reset-done';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

function content(kind: MailKind, name: string, link: string): { subject: string; html: string } {
  const hi = name ? `Salut, ${esc(name)},` : 'Salut,';
  const button = (label: string) =>
    `<p><a href="${esc(link)}" style="display:inline-block;padding:10px 16px;background:#e2b866;color:#07090e;border-radius:8px;text-decoration:none;font-weight:600">${label}</a></p><p style="color:#888;font-size:12px;word-break:break-all">${esc(link)}</p>`;
  if (kind === 'activate')
    return {
      subject: 'Sentiq · contul tău a fost aprobat',
      html: `<p>${hi}</p><p>Cererea ta de cont în Sentiq a fost aprobată. Setează-ți parola ca să intri. Linkul e valabil 7 zile.</p>${button('Activează contul')}<p>Dacă nu tu ai cerut contul, ignoră acest email.</p>`,
    };
  if (kind === 'request')
    // To the admin: `name` is the person asking ("Ana (ana@…)"), the link the Users page.
    return {
      subject: 'Sentiq · cerere nouă de cont',
      html: `<p>Salut,</p><p><strong>${esc(name)}</strong> a cerut un cont în Sentiq.</p>${button('Vezi cererea')}<p>O aprobi sau o respingi din pagina Utilizatori.</p>`,
    };
  if (kind === 'reset')
    return {
      subject: 'Sentiq · setează o parolă nouă',
      html: `<p>${hi}</p><p>Cineva a cerut o parolă nouă pentru contul tău Sentiq. Linkul e valabil o oră.</p>${button('Setează parola')}<p>Dacă nu tu ai cerut-o, ignoră acest email: parola rămâne aceeași.</p>`,
    };
  return {
    subject: 'Sentiq · parola a fost schimbată',
    html: `<p>${hi}</p><p>Parola contului tău Sentiq tocmai a fost schimbată, iar celelalte sesiuni au fost închise.</p><p>Dacă nu tu ai schimbat-o, folosește „Am uitat parola” cât mai repede.</p>`,
  };
}

export class Mailer {
  private readonly settings: () => MailSettings;
  private readonly log: Logger;
  constructor(settings: () => MailSettings, log: Logger) {
    this.settings = settings;
    this.log = log;
  }

  /** True when Resend accepted the mail. `link` is absent for notices without one. */
  async send(kind: MailKind, to: string, name: string, link = ''): Promise<boolean> {
    const { apiKey, from } = this.settings();
    const { subject, html } = content(kind, name, link);
    if (!apiKey) {
      if (kind === 'reset') this.log.warn(`email: no Resend key, so the ${kind} mail for ${to} was not sent. The link is written here instead: ${link}`);
      else this.log.warn(`email: no Resend key, the ${kind} mail for ${to} was not sent`);
      return false;
    }
    try {
      const r = await httpRequest('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject, html }),
        timeoutMs: 15_000,
      });
      if (r.status >= 200 && r.status < 300) {
        this.log.info(`email: ${kind} mail sent to ${to}`);
        return true;
      }
      const detail = r.body.slice(0, 300);
      const msg = `email: Resend refused the ${kind} mail for ${to} (HTTP ${r.status}: ${detail})${link ? '; the link is not logged' : ''}`;
      // Refused activation mails are expected in development (the admin passes the link on): a warning, not an error.
      if (kind === 'activate') this.log.warn(msg);
      else this.log.error(msg);
      return false;
    } catch (err) {
      this.log.error(`email: the ${kind} mail for ${to} could not be sent (${(err as Error).message})${link ? '; the link is not logged' : ''}`);
      return false;
    }
  }
}
