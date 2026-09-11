import type { AppContext } from '../context';
import { handle } from '../ipc';

export function registerSessionHandlers(ctx: AppContext): void {
  const sm = ctx.sessions;
  handle('session:start', (_e, { profileId, mode }) => sm.start(profileId, mode));
  handle('session:stop', () => sm.stop());
  handle('session:state', () => sm.state());
  handle('session:list', () => ctx.db.listSessions());
  handle('session:delete', (_e, id) => {
    if (sm.session?.id === id) sm.stop();
    ctx.db.deleteSession(id);
  });
  handle('transcript:get', (_e, sessionId) =>
    sm.session?.id === sessionId ? sm.finals() : ctx.db.listUtterances(sessionId),
  );

  // Profiles are simple CRUD on the DB (document parsing is added in Milestone 7).
  handle('profiles:list', () => ctx.db.listProfiles());
  handle('profiles:get', (_e, id) => ctx.db.getProfile(id));
  handle('profiles:save', (_e, p) => ctx.db.saveProfile(p));
  handle('profiles:delete', (_e, id) => ctx.db.deleteProfile(id));
}
