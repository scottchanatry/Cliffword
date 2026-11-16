import { CONTACT_EMAIL, externalLinkUrl, MARKETING_URL, mailtoUrl, PRIVACY_URL, SUPPORT_URL } from './links';

describe('links', () => {
  it('are the hosted pages of docs/STORE.md, with trailing slashes', () => {
    expect(PRIVACY_URL).toBe('https://scottchanatry.com/cliffword/privacy/');
    expect(SUPPORT_URL).toBe('https://scottchanatry.com/cliffword/support/');
    expect(MARKETING_URL).toBe('https://scottchanatry.com/cliffword/');
    expect(CONTACT_EMAIL).toBe('hello@scottchanatry.com');
  });

  it('builds mailto: URLs with the subject and body percent-encoded and CRLF line breaks', () => {
    expect(mailtoUrl(CONTACT_EMAIL)).toBe('mailto:hello@scottchanatry.com');
    expect(mailtoUrl('a@b.c', { subject: 'Cliffword: report a sentence', body: 'Hola & adiós?\nLine 2' })).toBe(
      'mailto:a@b.c?subject=Cliffword%3A%20report%20a%20sentence&body=Hola%20%26%20adi%C3%B3s%3F%0D%0ALine%202',
    );
  });

  it('names the URL of each outside link', () => {
    expect(externalLinkUrl('privacy')).toBe(PRIVACY_URL);
    expect(externalLinkUrl('support')).toBe(SUPPORT_URL);
    expect(externalLinkUrl('contact')).toBe('mailto:hello@scottchanatry.com');
  });
});
