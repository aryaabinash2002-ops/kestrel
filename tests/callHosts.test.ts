import { describe, expect, it } from 'vitest';
import { isCallTab, platformName } from '../extension/src/callHosts';

describe('call-host matcher', () => {
  it.each([
    'https://mongodb.zoom.us/j/92631284354?pwd=abc#success',
    'https://mongodb.zoom.us/wc/92631284354/join?fromPWA=1&pwd=abc',
    'https://app.zoom.us/wc/92631284354/join',
    'https://us05web.zoom.us/j/123',
    'https://us06web.zoom.us/wc/123/start',
    'https://zoom.us/j/123',
    'https://meet.google.com/abc-defg-hij',
    'https://teams.microsoft.com/v2/',
    'https://teams.live.com/meet/123',
    'https://company.webex.com/meet/x',
  ])('accepts %s', (url) => expect(isCallTab(url)).toBe(true));

  it.each([
    'http://mongodb.zoom.us/j/1',
    'https://zoom.com/j/1',
    'https://www.youtube.com/',
    'https://evil-zoom.us.example.com/',
    '',
    undefined,
  ])('rejects %s', (url) => expect(isCallTab(url as string | undefined)).toBe(false));

  it('names the platform', () => {
    expect(platformName('https://mongodb.zoom.us/wc/1/join')).toBe('Zoom');
    expect(platformName('https://meet.google.com/x')).toBe('Google Meet');
    expect(platformName('https://teams.microsoft.com/')).toBe('Microsoft Teams');
  });
});
