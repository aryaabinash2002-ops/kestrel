import type { AppContext } from '../context';
import { handle, emit } from '../ipc';

export function registerAnswerHandlers(ctx: AppContext): void {
  const engine = ctx.answers;
  handle('answer:now', () => engine.answerNow());
  handle('answer:cancel', (_e, id) => engine.cancel(id));
  handle('answer:clear', () => engine.clear());
  handle('answer:current', () => engine.current());
  handle('answer:chat', (_e, text) => engine.chat(text));
  handle('answer:list', (_e, sessionId) => ctx.db.listAnswers(sessionId));
  handle('llm:warm', () => engine.warm());

  ctx.hotkeys.on('answerNow', () => {
    ctx.windows.showPanel();
    engine.answerNow();
  });
  ctx.hotkeys.on('clearCards', () => engine.clear());

  ctx.settings.onChange((next, prev) => {
    if (JSON.stringify(next.models) !== JSON.stringify(prev.models)) void engine.warm();
  });

  // Re-create the Anthropic client when the key changes.
  const origSet = ctx.secrets.set.bind(ctx.secrets);
  ctx.secrets.set = async (key, value) => {
    await origSet(key, value);
    if (key === 'anthropic') {
      ctx.llm.invalidate();
      emit('toast', { kind: 'info', title: 'Anthropic key updated' });
    }
  };
}
