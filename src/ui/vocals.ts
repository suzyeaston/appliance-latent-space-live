import { DEFAULT_VOCAL_FX, VOCAL_RATE, VOCAL_SECONDS, encodeVocal, readVocal, vocalBuffer, type VocalTake, type VocalFX } from '../core/audio/vocals';
import { el } from './dom';

interface Options {
  context: () => Promise<AudioContext | null>;
  play: (take: VocalTake, preview: boolean) => void;
  attach: (scene: number) => void;
  effects: (fx: VocalFX) => void;
}

export class Vocals {
  private take: VocalTake | null = null;
  private fx: VocalFX = { ...DEFAULT_VOCAL_FX };
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private timer = 0;
  private request = 0;
  private busy = false;
  private storageWarning = '';
  private status = el<HTMLElement>('vocal-status');
  constructor(private options: Options) {
    try { const raw = localStorage.getItem('als-vocal-v1'); if (raw) this.take = readVocal(JSON.parse(raw)); }
    catch { this.status.textContent = 'Vocal storage is unavailable. Export your set after saving a take to a scene.'; }
    if (this.take) { this.fx = { ...this.take.fx }; this.status.textContent = 'Restored your vocal take. Save it into a scene or export your set.'; }
    el<HTMLButtonElement>('vocal-record').onclick = () => void this.record();
    el<HTMLButtonElement>('vocal-stop').onclick = () => this.stopRecording();
    el<HTMLButtonElement>('vocal-preview').onclick = () => {
      const take = this.snapshot(); if (take) options.play(take, true);
    };
    el<HTMLButtonElement>('vocal-remove').onclick = () => { this.select(null); this.status.textContent = 'Current take removed. Saved scenes retain their takes.'; };
    el<HTMLButtonElement>('vocal-attach').onclick = () => {
      const value = el<HTMLSelectElement>('vocal-scene').value; if (value !== '') options.attach(Number(value));
    };
    for (const key of ['level','tone','drive','echo'] as const) {
      const input = el<HTMLInputElement>(`vocal-${key}`);
      input.oninput = () => { this.fx[key] = Number(input.value); this.options.effects(this.fx); this.persist(); };
    }
    el<HTMLInputElement>('vocal-name').onchange = () => {
      if (this.take) { this.take.name = el<HTMLInputElement>('vocal-name').value.trim().slice(0,60) || 'Vocal take'; this.persist(); }
    };
    window.addEventListener('pagehide', () => this.cancel());
    this.reflect();
  }
  snapshot(): VocalTake | null { return this.take ? { ...this.take, fx: { ...this.fx } } : null; }
  select(take: VocalTake | null): void {
    this.take = take ? structuredClone(take) : null;
    this.fx = { ...(take?.fx ?? DEFAULT_VOCAL_FX) }; this.reflect(); this.persist();
  }
  private reflect(): void {
    for (const key of ['level','tone','drive','echo'] as const) el<HTMLInputElement>(`vocal-${key}`).value = String(this.fx[key]);
    el<HTMLInputElement>('vocal-name').value = this.take?.name ?? 'Vocal take';
    el<HTMLButtonElement>('vocal-preview').disabled = !this.take || this.busy;
    el<HTMLButtonElement>('vocal-remove').disabled = !this.take || this.busy;
    el<HTMLButtonElement>('vocal-attach').disabled = !this.take || this.busy || el<HTMLSelectElement>('vocal-scene').value === '';
    el<HTMLButtonElement>('vocal-record').disabled = this.busy;
    el<HTMLButtonElement>('vocal-stop').disabled = !this.recorder && !this.busy;
    el('vocal-take').textContent = this.take ? `${this.take.name} · ${(atob(this.take.samples).length / 2 / VOCAL_RATE).toFixed(1)} seconds` : 'No vocal take yet';
  }
  refreshScenes(scenes: Array<{name: string} | null>): void {
    const select = el<HTMLSelectElement>('vocal-scene'); select.replaceChildren();
    const empty = document.createElement('option'); empty.value = ''; empty.textContent = 'Choose a saved scene'; select.append(empty);
    scenes.forEach((scene,index) => { if (scene) { const option = document.createElement('option'); option.value = String(index); option.textContent = `${index+1} · ${scene.name}`; select.append(option); } });
    select.onchange = () => this.reflect(); this.reflect();
  }
  async record(): Promise<void> {
    if (this.busy) return;
    const policyDocument = document as Document & { permissionsPolicy?: { allowsFeature(name:string):boolean }; featurePolicy?: { allowsFeature(name:string):boolean } };
    const policy = policyDocument.permissionsPolicy ?? policyDocument.featurePolicy;
    if (policy && !policy.allowsFeature('microphone')) {
      this.status.textContent = 'Recording is blocked by the embed. The WordPress iframe needs allow="microphone; autoplay; fullscreen". You can also open the instrument in its own tab.'; return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      this.status.textContent = 'Recording needs a browser with microphone support and HTTPS. Try opening the instrument in its own tab.'; return;
    }
    this.busy = true; const request = ++this.request; this.reflect();
    let stream: MediaStream | null = null;
    try {
      const context = await this.options.context();
      if (!context || request !== this.request) { if (request === this.request) { this.busy = false; this.reflect(); } return; }
      this.status.textContent = 'Allow microphone access. Use headphones; the microphone is not monitored.';
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true } });
      if (request !== this.request) { stream.getTracks().forEach(t => t.stop()); return; }
      this.stream = stream;
      const recorder = new MediaRecorder(stream); this.recorder = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      recorder.onerror = () => { this.cancel(); this.status.textContent = 'Recording failed. Your previous take is retained.'; };
      recorder.onstop = async () => {
        stream?.getTracks().forEach(t => t.stop()); this.stream = null; this.recorder = null; window.clearTimeout(this.timer);
        if (request !== this.request) return;
        this.status.textContent = 'Preparing your take…'; this.reflect();
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType });
          if (!blob.size || blob.size > 8_000_000) throw new Error('No usable audio was recorded. Try again.');
          const decoded = await context.decodeAudioData(await blob.arrayBuffer());
          // The offline renderer resamples with its antialiasing filter before PCM encoding.
          const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(Math.min(VOCAL_SECONDS,decoded.duration) * VOCAL_RATE)), VOCAL_RATE);
          const source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start();
          const audio = await offline.startRendering();
          if (request !== this.request) return;
          this.take = { name: el<HTMLInputElement>('vocal-name').value.trim().slice(0,60) || 'Vocal take', samples: encodeVocal(audio), fx: { ...this.fx } };
          this.persist(); this.status.textContent = 'Take ready. Preview with FX, then add it to a saved scene or save a new phrase. Takes start on the first bar and play once per phrase.' + this.storageWarning;
        } catch (error) { this.status.textContent = error instanceof Error ? error.message : 'Could not decode the recording.'; }
        finally { if (request === this.request) { this.busy = false; this.reflect(); } }
      };
      recorder.start(); this.status.textContent = `Recording… stops after ${VOCAL_SECONDS} seconds, or press Stop recording.`;
      this.timer = window.setTimeout(() => this.stopRecording(), VOCAL_SECONDS * 1000); this.reflect();
    } catch (error) {
      stream?.getTracks().forEach(t => t.stop());
      this.busy = false; this.reflect();
      this.status.textContent = error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Microphone access was denied or blocked by the embed. Allow it in browser settings; the WordPress iframe needs allow="microphone; autoplay; fullscreen". You can also open the instrument in its own tab.'
        : `Could not record: ${error instanceof Error ? error.message : 'microphone unavailable'}. Your previous take is retained.`;
    }
  }
  stopRecording(): void {
    if (this.recorder?.state === 'recording') this.recorder.stop();
    else if (this.busy) this.cancel();
  }
  cancel(): void {
    this.request++; window.clearTimeout(this.timer);
    if (this.recorder?.state === 'recording') this.recorder.stop();
    this.stream?.getTracks().forEach(t => t.stop()); this.stream = null; this.recorder = null; this.busy = false; this.reflect();
  }
  playAt(context: BaseAudioContext, at: number, play: (buffer: AudioBuffer, at: number, fx: VocalFX) => void): void {
    const take = this.snapshot(); if (take) play(vocalBuffer(context,take), at, take.fx);
  }
  private persist(): void {
    try { localStorage.setItem('als-vocal-v1',JSON.stringify(this.snapshot())); }
    catch { this.storageWarning = ' Vocal storage is full or blocked. Save the take to a scene and export your set now.'; this.status.textContent += this.storageWarning; }
  }
}
