import { create } from 'zustand';
import type { AnswerCard, Utterance } from '@shared/types/session';
import type { AnswerEvent, ScreenshotEvent, SessionState } from '@shared/types/ipc';
import type { ScreenshotResult } from '@shared/types/session';
import { invoke, on } from '@renderer/lib/ipc';

interface SessionStoreState {
  state: SessionState;
  utterances: Utterance[];
  interim: { ME: string; THEM: string };
  cards: AnswerCard[];
  chips: { id: string; question: string }[];
  screenshots: ScreenshotResult[];
  pendingQuestion: string | null;
  refresh: () => Promise<void>;
  start: (profileId: string | null) => Promise<void>;
  stop: () => Promise<void>;
  clearCards: () => void;
  dismissCard: (id: string) => void;
}

const MAX_UTTERANCES = 600;
const MAX_CARDS = 40;

export const useSession = create<SessionStoreState>((set, get) => ({
  state: { session: null, profile: null, listening: false },
  utterances: [],
  interim: { ME: '', THEM: '' },
  cards: [],
  chips: [],
  screenshots: [],
  pendingQuestion: null,
  refresh: async () => {
    const state = await invoke('session:state');
    const cards = await invoke('answer:current');
    const utterances = state.session ? await invoke('transcript:get', state.session.id) : [];
    set({ state, cards, utterances });
  },
  start: async (profileId) => {
    const state = await invoke('session:start', { profileId, mode: 'live' });
    set({ state, utterances: [], cards: [], chips: [], screenshots: [], interim: { ME: '', THEM: '' } });
  },
  stop: async () => {
    const state = await invoke('session:stop');
    set({ state, interim: { ME: '', THEM: '' } });
  },
  clearCards: () => {
    void invoke('answer:clear');
    set({ cards: [], chips: [] });
  },
  dismissCard: (id) => set({ cards: get().cards.filter((c) => c.id !== id) }),
}));

on('session:state', (state) => useSession.setState({ state }));

on('transcript:utterance', (u) => {
  const list = useSession.getState().utterances;
  const idx = list.findIndex((x) => x.id === u.id);
  let next: Utterance[];
  if (idx >= 0) {
    next = list.slice();
    next[idx] = u;
  } else {
    next = [...list, u];
    if (next.length > MAX_UTTERANCES) next = next.slice(next.length - MAX_UTTERANCES);
  }
  const interim = { ...useSession.getState().interim };
  if (u.isFinal && (u.speaker === 'ME' || u.speaker === 'THEM')) interim[u.speaker] = '';
  useSession.setState({ utterances: next, interim });
});

on('transcript:interim', ({ channel, text }) => {
  const interim = { ...useSession.getState().interim };
  interim[channel] = text;
  useSession.setState({ interim });
});

on('question:detected', (q) => useSession.setState({ pendingQuestion: q.text }));

function applyAnswerEvent(ev: AnswerEvent): void {
  const s = useSession.getState();
  switch (ev.type) {
    case 'start': {
      const cards = [ev.card, ...s.cards.filter((c) => c.id !== ev.card.id)].slice(0, MAX_CARDS);
      useSession.setState({ cards, pendingQuestion: null });
      break;
    }
    case 'delta': {
      useSession.setState({
        cards: s.cards.map((c) =>
          c.id === ev.id ? { ...c, headline: ev.headline, points: ev.points, content: ev.content } : c,
        ),
      });
      break;
    }
    case 'headline': {
      useSession.setState({
        cards: s.cards.map((c) =>
          c.id === ev.id ? { ...c, headline: ev.headline, latency: { ...c.latency, headlineDoneTs: ev.ts } } : c,
        ),
      });
      break;
    }
    case 'done': {
      useSession.setState({ cards: s.cards.map((c) => (c.id === ev.id ? ev.card : c)) });
      break;
    }
    case 'cancelled': {
      useSession.setState({
        cards: s.cards
          .map((c) => (c.id === ev.id ? { ...c, status: 'cancelled' as const } : c))
          .filter((c) => !(c.id === ev.id && !c.headline && !c.content)),
        pendingQuestion: null,
      });
      break;
    }
    case 'error': {
      useSession.setState({
        cards: s.cards.map((c) => (c.id === ev.id ? { ...c, status: 'error' as const, error: ev.error } : c)),
      });
      break;
    }
    case 'classified': {
      useSession.setState({
        cards: s.cards.map((c) => (c.id === ev.id ? { ...c, type: ev.questionType } : c)),
      });
      break;
    }
    case 'chip': {
      useSession.setState({ chips: [{ id: ev.id, question: ev.question }, ...s.chips].slice(0, 5), pendingQuestion: null });
      break;
    }
    case 'clear':
      useSession.setState({ cards: [], chips: [] });
      break;
  }
}

on('answer:event', applyAnswerEvent);

function applyScreenshotEvent(ev: ScreenshotEvent): void {
  const s = useSession.getState();
  switch (ev.type) {
    case 'start':
      useSession.setState({ screenshots: [ev.result, ...s.screenshots].slice(0, 20) });
      break;
    case 'delta':
      useSession.setState({
        screenshots: s.screenshots.map((x) => (x.id === ev.id ? { ...x, result: x.result + ev.text } : x)),
      });
      break;
    case 'done':
      useSession.setState({ screenshots: s.screenshots.map((x) => (x.id === ev.id ? ev.result : x)) });
      break;
    case 'error':
      useSession.setState({
        screenshots: s.screenshots.map((x) => (x.id === ev.id ? { ...x, status: 'error', result: x.result + `\n\n⚠ ${ev.error}` } : x)),
      });
      break;
  }
}

on('screenshot:event', applyScreenshotEvent);
