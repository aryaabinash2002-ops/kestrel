import type { AppContext } from '../context';
import { handle } from '../ipc';
import type { SecretKey } from '@shared/types/settings';

async function testKey(key: SecretKey, value: string): Promise<{ ok: boolean; message: string }> {
  try {
    if (key === 'deepgram') {
      const res = await fetch('https://api.deepgram.com/v1/projects', { headers: { Authorization: `Token ${value}` } });
      return res.ok ? { ok: true, message: 'Deepgram key accepted' } : { ok: false, message: `Deepgram responded ${res.status}` };
    }
    if (key === 'assemblyai') {
      const res = await fetch('https://api.assemblyai.com/v2/transcript?limit=1', { headers: { Authorization: value } });
      return res.ok ? { ok: true, message: 'AssemblyAI key accepted' } : { ok: false, message: `AssemblyAI responded ${res.status}` };
    }
    const res = await fetch('https://api.anthropic.com/v1/models?limit=1', {
      headers: { 'x-api-key': value, 'anthropic-version': '2023-06-01' },
    });
    return res.ok ? { ok: true, message: 'Anthropic key accepted' } : { ok: false, message: `Anthropic responded ${res.status}` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export function registerTranscriptionHandlers(ctx: AppContext): void {
  handle('transcript:state', () => ctx.transcription.states());
  handle('secrets:test', async (_e, key) => {
    const value = await ctx.secrets.get(key);
    if (!value) return { ok: false, message: 'No key stored' };
    return testKey(key, value);
  });
}
