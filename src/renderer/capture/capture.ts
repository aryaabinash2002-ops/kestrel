// Hidden capture renderer — implemented in Milestone 2 (audio).
const logEl = document.getElementById('log');
const log = (m: string): void => {
  if (logEl) logEl.textContent += m + '\n';
  window.kestrelCapture.event({ type: 'log', message: m });
};
window.kestrelCapture.onRequest((req) => {
  if (req.cmd.type === 'ping') window.kestrelCapture.reply({ id: req.id, ok: true, result: 'pong' });
  else window.kestrelCapture.reply({ id: req.id, ok: false, error: 'capture engine not ready' });
});
log('capture renderer loaded');
