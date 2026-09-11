import { create } from 'zustand';
import type { AnswerCard, ScreenshotResult, Session, SessionSummary, Utterance } from '@shared/types/session';
import { invoke } from '@renderer/lib/ipc';

export type SessionRow = Session & { profileName: string | null; utteranceCount: number; answerCount: number };

export interface SessionDetailData {
  session: SessionRow;
  utterances: Utterance[];
  answers: AnswerCard[];
  screenshots: ScreenshotResult[];
}

interface ReviewState {
  sessions: SessionRow[];
  loaded: boolean;
  detail: SessionDetailData | null;
  detailLoading: boolean;
  generating: boolean;
  exporting: 'md' | 'pdf' | null;
  /** Sessions for which an automatic review was already attempted this app run. */
  autoTried: Set<string>;
  loadList: () => Promise<void>;
  openSession: (id: string) => Promise<SessionDetailData | null>;
  closeSession: () => void;
  deleteSession: (id: string) => Promise<void>;
  generate: (id: string) => Promise<SessionSummary>;
  exportSession: (id: string, format: 'md' | 'pdf') => Promise<string>;
}

export const useReview = create<ReviewState>((set, get) => ({
  sessions: [],
  loaded: false,
  detail: null,
  detailLoading: false,
  generating: false,
  exporting: null,
  autoTried: new Set<string>(),
  loadList: async () => {
    const sessions = await invoke('session:list');
    set({ sessions, loaded: true });
  },
  openSession: async (id) => {
    set({ detailLoading: true });
    try {
      let sessions = get().sessions;
      if (!sessions.some((s) => s.id === id)) {
        sessions = await invoke('session:list');
        set({ sessions, loaded: true });
      }
      const session = sessions.find((s) => s.id === id);
      if (!session) {
        set({ detail: null });
        return null;
      }
      const [utterances, answers, screenshots] = await Promise.all([
        invoke('transcript:get', id),
        invoke('answer:list', id),
        invoke('screenshot:list', id),
      ]);
      const detail: SessionDetailData = { session, utterances, answers, screenshots };
      set({ detail });
      return detail;
    } finally {
      set({ detailLoading: false });
    }
  },
  closeSession: () => set({ detail: null }),
  deleteSession: async (id) => {
    await invoke('session:delete', id);
    const detail = get().detail;
    set({ sessions: get().sessions.filter((s) => s.id !== id), detail: detail?.session.id === id ? null : detail });
  },
  generate: async (id) => {
    set({ generating: true });
    try {
      const summary = await invoke('review:generate', id);
      const patch = (s: SessionRow) => (s.id === id ? { ...s, summary } : s);
      const detail = get().detail;
      set({
        sessions: get().sessions.map(patch),
        detail: detail && detail.session.id === id ? { ...detail, session: { ...detail.session, summary } } : detail,
      });
      return summary;
    } finally {
      set({ generating: false });
    }
  },
  exportSession: async (id, format) => {
    set({ exporting: format });
    try {
      const { path } = await invoke('review:export', id, format);
      return path;
    } finally {
      set({ exporting: null });
    }
  },
}));
