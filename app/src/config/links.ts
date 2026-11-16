/**
 * The public pages and the contact address (docs/STORE.md, "Hosting and contact"). The same
 * URLs are entered in App Store Connect and the Play Console; the app links to them from
 * Settings (About) and the onboarding welcome screen, and "Report this sentence" writes to
 * CONTACT_EMAIL.
 */
export const PRIVACY_URL = 'https://scottchanatry.com/cliffword/privacy/';
export const SUPPORT_URL = 'https://scottchanatry.com/cliffword/support/';
export const MARKETING_URL = 'https://scottchanatry.com/cliffword/';
export const CONTACT_EMAIL = 'hello@scottchanatry.com';

/**
 * A mailto: URL with the subject and body percent-encoded (RFC 6068: spaces as %20, line breaks
 * as %0D%0A, so every mail app reads the same text).
 */
export function mailtoUrl(to: string, fields: { subject?: string; body?: string } = {}): string {
  const encode = (value: string) => encodeURIComponent(value.replace(/\r?\n/g, '\r\n'));
  const query = [
    ...(fields.subject !== undefined ? [`subject=${encode(fields.subject)}`] : []),
    ...(fields.body !== undefined ? [`body=${encode(fields.body)}`] : []),
  ];
  return `mailto:${to}${query.length > 0 ? `?${query.join('&')}` : ''}`;
}

/** The outside pages the app links to (Settings, About; the welcome screen's footer). */
export type ExternalLink = 'privacy' | 'support' | 'contact';

/** The URL behind each outside link: the two pages in the browser, a blank mail to the contact address. */
export function externalLinkUrl(link: ExternalLink): string {
  switch (link) {
    case 'privacy':
      return PRIVACY_URL;
    case 'support':
      return SUPPORT_URL;
    case 'contact':
      return mailtoUrl(CONTACT_EMAIL);
  }
}
