import { create } from 'zustand';
import type { PracticeEvent, PracticeHistoryEntry, PracticeQuestionSet } from '@shared/types/ipc';
import type { PracticeScore } from '@shared/types/session';
import { invoke, on } from '@renderer/lib/ipc';
import { useSession } from './session';

export type PracticePhase =
  'idle' | 'starting' | 'speaking' | 'listening' | 'scoring' | 'score' | 'finished';

export interface CurrentQuestion {
  index: number;
  total: number;
  question: string;
  category: string;
  /** Session-relative ms when the question was shown (answers collected after this). */
  shownAtMs: number;
}

interface PracticeState {
  phase: PracticePhase;
  useTts: boolean;
  current: CurrentQuestion | null;
  /** Next question received while a score is still on screen. */
  pending: CurrentQuestion | null;
  finishedPending: boolean;
  lastScore: PracticeScore | null;
  scores: PracticeScore[];
  /** Text the user edited by hand (null = use the collected transcript). */
  edited: string | null;
  error: string | null;
  sets: PracticeQuestionSet[];
  history: PracticeHistoryEntry[];
  loadSets: (profileId: string | null) => Promise<void>;
  loadHistory: (profileId: string | null) => Promise<void>;
  start: (opts: {
    profileId: string | null;
    setId: string;
    count: number;
    useTts: boolean;
  }) => Promise<void>;
  submit: (text: string) => Promise<void>;
  skip: () => Promise<void>;
  stop: () => Promise<void>;
  next: () => void;
  setPhase: (p: PracticePhase) => void;
  setEdited: (t: string | null) => void;
  reset: () => void;
}

function nowMs(): number {
  const s = useSession.getState().state.session;
  return s ? Date.now() - s.startedAt : 0;
}

export const usePractice = create<PracticeState>((set, get) => ({
  phase: 'idle',
  useTts: true,
  current: null,
  pending: null,
  finishedPending: false,
  lastScore: null,
  scores: [],
  edited: null,
  error: null,
  sets: [],
  history: [],
  loadSets: async (profileId) => set({ sets: await invoke('practice:sets', profileId) }),
  loadHistory: async (profileId) => set({ history: await invoke('practice:history', profileId) }),
  start: async (opts) => {
    set({
      phase: 'starting',
      useTts: opts.useTts,
      current: null,
      pending: null,
      lastScore: null,
      scores: [],
      edited: null,
      error: null,
      finishedPending: false,
    });
    try {
      await invoke('practice:start', opts);
    } catch (err) {
      set({ phase: 'idle', error: String(err) });
      throw err;
    }
  },
  submit: async (text) => {
    set({ phase: 'scoring', edited: null });
    await invoke('practice:submit', text);
  },
  skip: async () => {
    set({ edited: null, lastScore: null });
    await invoke('practice:skip');
  },
  stop: async () => {
    await invoke('practice:stop');
    set({ phase: 'finished', current: null, pending: null, finishedPending: false });
  },
  next: () => {
    const { pending, finishedPending, useTts } = get();
    if (pending) {
      set({
        current: { ...pending, shownAtMs: nowMs() },
        pending: null,
        lastScore: null,
        edited: null,
        phase: useTts ? 'speaking' : 'listening',
      });
    } else if (finishedPending) {
      set({ phase: 'finished', finishedPending: false, current: null, lastScore: null });
    }
  },
  setPhase: (phase) => set({ phase }),
  setEdited: (edited) => set({ edited }),
  reset: () =>
    set({
      phase: 'idle',
      current: null,
      pending: null,
      lastScore: null,
      scores: [],
      edited: null,
      error: null,
      finishedPending: false,
    }),
}));

on('practice:event', (ev: PracticeEvent) => {
  const s = usePractice.getState();
  switch (ev.type) {
    case 'question': {
      const q: CurrentQuestion = {
        index: ev.index,
        total: ev.total,
        question: ev.question,
        category: ev.category,
        shownAtMs: nowMs(),
      };
      if (s.phase === 'score') usePractice.setState({ pending: q });
      else
        usePractice.setState({
          current: q,
          pending: null,
          edited: null,
          lastScore: null,
          phase: s.useTts ? 'speaking' : 'listening',
          error: null,
        });
      break;
    }
    case 'listening':
      usePractice.setState({ phase: 'listening' });
      break;
    case 'scoring':
      usePractice.setState({ phase: 'scoring' });
      break;
    case 'score':
      usePractice.setState({
        phase: 'score',
        lastScore: ev.score,
        scores: [...s.scores, ev.score],
      });
      break;
    case 'finished':
      if (s.phase === 'score') usePractice.setState({ finishedPending: true, pending: null });
      else usePractice.setState({ phase: 'finished', current: null, pending: null });
      break;
    case 'error':
      usePractice.setState({
        error: ev.error,
        phase: s.phase === 'scoring' ? 'listening' : s.phase,
      });
      break;
  }
});
