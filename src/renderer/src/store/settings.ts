import { create } from 'zustand';
import { DEFAULT_SETTINGS, type Settings, type SecretKey } from '@shared/types/settings';
import type { AppInfo, DeepPartial } from '@shared/types/ipc';
import { invoke, on } from '@renderer/lib/ipc';

interface SettingsState {
  settings: Settings;
  loaded: boolean;
  appInfo: AppInfo | null;
  secrets: Record<SecretKey, boolean>;
  secretBackend: 'keychain' | 'safeStorage' | 'plain';
  load: () => Promise<void>;
  update: (patch: DeepPartial<Settings>) => Promise<void>;
  refreshSecrets: () => Promise<void>;
}

export const useSettings = create<SettingsState>((set) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  appInfo: null,
  secrets: { anthropic: false, deepgram: false, assemblyai: false },
  secretBackend: 'keychain',
  load: async () => {
    const [settings, appInfo, secrets, secretBackend] = await Promise.all([
      invoke('settings:get'),
      invoke('app:info'),
      invoke('secrets:status'),
      invoke('secrets:backend'),
    ]);
    set({ settings, appInfo, secrets, secretBackend, loaded: true });
  },
  update: async (patch) => {
    const next = await invoke('settings:set', patch);
    set({ settings: next });
  },
  refreshSecrets: async () => {
    set({ secrets: await invoke('secrets:status') });
  },
}));

on('settings:changed', (settings) => useSettings.setState({ settings }));

export function applyTheme(theme: Settings['ui']['theme'], fontSize: number): void {
  const root = document.documentElement;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = theme === 'dark' || (theme === 'system' && prefersDark);
  root.classList.toggle('dark', dark);
  root.style.setProperty('--app-font-size', `${fontSize}px`);
}

useSettings.subscribe((s) => applyTheme(s.settings.ui.theme, s.settings.ui.fontSize));
