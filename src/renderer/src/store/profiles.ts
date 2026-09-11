import { create } from 'zustand';
import type { Profile } from '@shared/types/session';
import { invoke } from '@renderer/lib/ipc';

interface ProfilesState {
  profiles: Profile[];
  loaded: boolean;
  load: () => Promise<void>;
  save: (p: Partial<Profile> & { id?: string }) => Promise<Profile>;
  remove: (id: string) => Promise<void>;
}

export const useProfiles = create<ProfilesState>((set, get) => ({
  profiles: [],
  loaded: false,
  load: async () => set({ profiles: await invoke('profiles:list'), loaded: true }),
  save: async (p) => {
    const saved = await invoke('profiles:save', p);
    await get().load();
    return saved;
  },
  remove: async (id) => {
    await invoke('profiles:delete', id);
    await get().load();
  },
}));
