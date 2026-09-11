/** Web Speech API text-to-speech for the AI interviewer (v1; swappable later). */

let currentUtterance: SpeechSynthesisUtterance | null = null;

function pickVoice(): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === 'undefined') return null;
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return null;
  const preferred = ['Samantha', 'Karen', 'Daniel', 'Google US English', 'Microsoft Aria', 'Microsoft Zira'];
  for (const name of preferred) {
    const v = voices.find((x) => x.name.includes(name));
    if (v) return v;
  }
  return voices.find((v) => v.lang.startsWith('en') && v.localService) ?? voices.find((v) => v.lang.startsWith('en')) ?? voices[0] ?? null;
}

export function ttsAvailable(): boolean {
  return typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
}

/** Speak `text`; resolves when speech ends (or immediately when TTS is unavailable). */
export function speak(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (!ttsAvailable() || !text.trim()) {
      resolve();
      return;
    }
    stopSpeaking();
    const u = new SpeechSynthesisUtterance(text);
    const voice = pickVoice();
    if (voice) u.voice = voice;
    u.rate = 1.0;
    u.pitch = 1.0;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (currentUtterance === u) currentUtterance = null;
      resolve();
    };
    u.onend = finish;
    u.onerror = finish;
    currentUtterance = u;
    speechSynthesis.speak(u);
    // Safety net: some engines never fire onend for long texts.
    setTimeout(finish, Math.min(60000, 3000 + text.length * 90));
  });
}

export function stopSpeaking(): void {
  if (!ttsAvailable()) return;
  currentUtterance = null;
  speechSynthesis.cancel();
}
