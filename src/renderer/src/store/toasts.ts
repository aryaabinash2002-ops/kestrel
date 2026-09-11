import { create } from 'zustand';
import type { Toast } from '@shared/types/ipc';
import { on } from '@renderer/lib/ipc';
import { uid } from '@shared/utils';

interface ToastState {
  toasts: (Toast & { id: string })[];
  push: (t: Toast) => void;
  dismiss: (id: string) => void;
}

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (t) => {
    const id = t.id ?? uid('toast');
    set({ toasts: [...get().toasts.filter((x) => x.id !== id), { ...t, id }] });
    if (!t.sticky) setTimeout(() => get().dismiss(id), t.kind === 'error' ? 8000 : 4500);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

on('toast', (t) => useToasts.getState().push(t));

export const toast = (t: Toast) => useToasts.getState().push(t);
