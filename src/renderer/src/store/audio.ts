import { create } from 'zustand';
import type { AudioDevices, AudioState } from '@shared/types/audio';
import type { TranscriptionState } from '@shared/types/transcription';
import type { ExtensionState } from '@shared/types/extension';
import { invoke, on } from '@renderer/lib/ipc';

interface AudioStoreState {
  state: AudioState | null;
  levels: { ME: number; THEM: number };
  devices: AudioDevices;
  transcription: Record<'ME' | 'THEM', TranscriptionState | null>;
  extension: ExtensionState | null;
  refresh: () => Promise<void>;
  refreshDevices: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export const useAudio = create<AudioStoreState>((set) => ({
  state: null,
  levels: { ME: 0, THEM: 0 },
  devices: { inputs: [], outputs: [] },
  transcription: { ME: null, THEM: null },
  extension: null,
  refresh: async () => {
    const [state, transcription, extension] = await Promise.all([
      invoke('audio:state'),
      invoke('transcript:state'),
      invoke('extension:state'),
    ]);
    const map: Record<'ME' | 'THEM', TranscriptionState | null> = { ME: null, THEM: null };
    for (const t of transcription) map[t.channel] = t;
    set({ state, transcription: map, extension });
  },
  refreshDevices: async () => {
    set({ devices: await invoke('audio:listDevices') });
  },
  start: async () => {
    set({ state: await invoke('audio:start') });
  },
  stop: async () => {
    set({ state: await invoke('audio:stop') });
  },
}));

on('audio:state', (state) => useAudio.setState({ state }));
on('audio:level', (l) => {
  const prev = useAudio.getState().levels;
  useAudio.setState({ levels: { ...prev, [l.channel]: l.level } });
});
on('transcription:state', (t) => {
  const prev = useAudio.getState().transcription;
  useAudio.setState({ transcription: { ...prev, [t.channel]: t } });
});
on('extension:state', (extension) => useAudio.setState({ extension }));
