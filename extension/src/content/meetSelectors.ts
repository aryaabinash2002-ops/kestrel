/**
 * Every DOM selector used on meet.google.com lives here. Google changes Meet's markup
 * often; each entry lists candidates tried in order. If nothing matches, callers fail
 * silently — captions are only a backup transcript source.
 */
export const SELECTORS = {
  /** Container that holds live caption entries. */
  captionsRegion: [
    'div[aria-label="Captions"]',
    'div[aria-label="Live captions"]',
    '[jsname="dsyhDe"]',
    '[jsname="tgaKEf"]',
    '.a4cQT',
    'div[role="region"][aria-live]',
  ],
  /** One caption block (speaker + running text). */
  captionEntry: [
    '[jsname="dsyhDe"] > div',
    '.nMcdL',
    '.TBMuR',
    '[data-caption-entry]',
    ':scope > div',
  ],
  /** Speaker name inside a caption block. */
  captionSpeaker: ['.NWpY1d', '.zs7s8d', '.KcIKyf', '[data-self-name]', 'span:first-child'],
  /** Caption text inside a caption block. */
  captionText: ['.bh44bd', '.iTTPOb', '.ygicle', '[jsname="YSxPC"]', 'span:last-child'],
  /** Present only while in a call. */
  leaveCallButton: [
    'button[aria-label="Leave call"]',
    'button[aria-label*="Leave call"]',
    'button[aria-label*="leave call" i]',
    '[jsname="CQylAd"]',
    'button[data-tooltip*="Leave call"]',
  ],
  /** The self participant name Meet shows for the user (used to map captions to ME). */
  selfNames: ['You', 'Tú', 'Vous', 'Du', 'Você', 'あなた', 'आप'],
} as const;

export function query<T extends Element = Element>(
  candidates: readonly string[],
  root: ParentNode = document,
): T | null {
  for (const sel of candidates) {
    try {
      const el = root.querySelector<T>(sel);
      if (el) return el;
    } catch {
      /* invalid selector for this root */
    }
  }
  return null;
}

export function queryAll<T extends Element = Element>(
  candidates: readonly string[],
  root: ParentNode,
): T[] {
  for (const sel of candidates) {
    try {
      const list = Array.from(root.querySelectorAll<T>(sel));
      if (list.length) return list;
    } catch {
      /* ignore */
    }
  }
  return [];
}
