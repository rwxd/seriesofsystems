/**
 * Tiny WebAudio cues. No assets, no network. Silenced by the Settings toggle
 * and never started before a user gesture.
 */
type Cue = 'page' | 'deploy' | 'success' | 'fail' | 'click';

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    context ??= new Ctor();
    if (context.state === 'suspended') void context.resume();
    return context;
  } catch {
    return null;
  }
}

interface Note {
  freq: number;
  at: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
}

const CUES: Record<Cue, Note[]> = {
  page: [
    { freq: 880, at: 0, dur: 0.11, type: 'square', gain: 0.045 },
    { freq: 660, at: 0.14, dur: 0.16, type: 'square', gain: 0.045 },
  ],
  deploy: [
    { freq: 420, at: 0, dur: 0.08, type: 'triangle', gain: 0.05 },
    { freq: 620, at: 0.07, dur: 0.1, type: 'triangle', gain: 0.05 },
  ],
  success: [
    { freq: 523, at: 0, dur: 0.1, type: 'triangle', gain: 0.05 },
    { freq: 659, at: 0.09, dur: 0.1, type: 'triangle', gain: 0.05 },
    { freq: 784, at: 0.18, dur: 0.16, type: 'triangle', gain: 0.05 },
  ],
  fail: [
    { freq: 190, at: 0, dur: 0.22, type: 'sawtooth', gain: 0.035 },
    { freq: 140, at: 0.16, dur: 0.28, type: 'sine', gain: 0.05 },
  ],
  click: [{ freq: 680, at: 0, dur: 0.04, type: 'square', gain: 0.02 }],
};

export function playCue(cue: Cue, enabled: boolean): void {
  if (!enabled) return;
  const ctx = audioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  for (const note of CUES[cue]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = note.type ?? 'triangle';
    osc.frequency.setValueAtTime(note.freq, now + note.at);
    gain.gain.setValueAtTime(0, now + note.at);
    gain.gain.linearRampToValueAtTime(note.gain ?? 0.04, now + note.at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + note.at + note.dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now + note.at);
    osc.stop(now + note.at + note.dur + 0.02);
  }
}
