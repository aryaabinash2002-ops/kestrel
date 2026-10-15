/** Web clients whose tab audio can be captured (shared by background + popup, unit-tested). */
export const CALL_HOSTS =
  /^https:\/\/(meet\.google\.com|[a-z0-9-]+\.zoom\.us|zoom\.us|teams\.microsoft\.com|teams\.live\.com|[a-z0-9.-]+\.webex\.com)\//i;

export function isCallTab(url?: string | null): boolean {
  return !!url && CALL_HOSTS.test(url);
}

/** Human name of the call platform for a URL ("Zoom", "Google Meet", ...). */
export function platformName(url?: string | null): string {
  const host = (url ?? '').toLowerCase();
  if (host.includes('zoom.us')) return 'Zoom';
  if (host.includes('meet.google.com')) return 'Google Meet';
  if (host.includes('teams.')) return 'Microsoft Teams';
  if (host.includes('webex.com')) return 'Webex';
  return 'Call';
}
