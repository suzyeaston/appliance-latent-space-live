import { clamp01 } from './params';

export const VOCAL_RATE = 16000;
export const VOCAL_SECONDS = 20;
export interface VocalFX { level: number; tone: number; drive: number; echo: number }
export interface VocalTake { name: string; samples: string; fx: VocalFX }
export const DEFAULT_VOCAL_FX: VocalFX = { level: 0.7, tone: 0.8, drive: 0, echo: 0 };

export function readVocal(value: unknown): VocalTake | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') throw new Error('Invalid vocal take.');
  const v = value as VocalTake;
  if (typeof v.name !== 'string' || v.name.length > 60 || typeof v.samples !== 'string' ||
      !v.samples.length || v.samples.length > Math.ceil(VOCAL_RATE * VOCAL_SECONDS * 2 / 3) * 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v.samples)) throw new Error('Invalid or oversized vocal audio.');
  const bytes = atob(v.samples);
  if (!bytes.length || bytes.length % 2 || bytes.length > VOCAL_RATE * VOCAL_SECONDS * 2) throw new Error('Invalid vocal sample length.');
  if (!v.fx || ['level','tone','drive','echo'].some(k => {
    const n = v.fx[k as keyof VocalFX]; return typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1;
  })) throw new Error('Invalid vocal effects.');
  return { name: v.name, samples: v.samples, fx: { ...v.fx } };
}

export function encodeVocal(buffer: AudioBuffer): string {
  const source = buffer.getChannelData(0);
  const count = Math.min(VOCAL_RATE * VOCAL_SECONDS, Math.floor(buffer.duration * VOCAL_RATE));
  const bytes = new Uint8Array(count * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < count; i++) {
    const position = i * buffer.sampleRate / VOCAL_RATE;
    const a = Math.floor(position), fraction = position - a;
    let sample = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const data = channel === 0 ? source : buffer.getChannelData(channel);
      sample += (data[a] ?? 0) * (1 - fraction) + (data[a + 1] ?? data[a] ?? 0) * fraction;
    }
    sample /= buffer.numberOfChannels;
    view.setInt16(i * 2, Math.max(-1, Math.min(1, sample)) * 32767, true);
  }
  let raw = '';
  for (let i = 0; i < bytes.length; i += 8192) raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(raw);
}

export function vocalBuffer(context: BaseAudioContext, take: VocalTake): AudioBuffer {
  const raw = atob(take.samples);
  const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  const buffer = context.createBuffer(1, bytes.length / 2, VOCAL_RATE);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = view.getInt16(i * 2, true) / 32768;
  return buffer;
}

/** Spectrum centroid (brightness) and high-frequency share (edge), independent of volume. */
export function spectrumTimbre(bins: Uint8Array): { brightness: number; edge: number } {
  let sum = 0, weighted = 0, high = 0;
  bins.forEach((v,i) => { sum += v; weighted += v * i; if (i > bins.length * 0.35) high += v; });
  return sum ? { brightness: clamp01(weighted / sum / Math.max(1, bins.length - 1)), edge: high / sum } : { brightness: 0, edge: 0 };
}
