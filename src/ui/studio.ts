import type { Score } from '../core/pattern/types';
import { DEFAULT_STYLE, MAX_EXAMPLES, distinctCount, distance, featuresFor, parseLibrary, predict, type Style, type VisualLibrary } from '../core/learning/visualModel';
import { el } from './dom';
const KEY = 'als-visual-library-v1';
interface StudioOptions {
  score: () => Score;
  controls: () => Record<string, number>;
  style: (style: Style) => void;
  edit: (tempo: number | null, voice: number | null, level: number | null) => boolean;
}
export class Studio {
  private data: VisualLibrary = { version: 1, examples: [], trained: [] };
  private look: Style = { ...DEFAULT_STYLE };
  private learned = false;
  private pending = false;
  private signature = '';
  private storageWarning = '';
  private options: StudioOptions;
  private message = el<HTMLElement>('learning-status');
  constructor(options: StudioOptions) {
    this.options = options;
    try { const saved = localStorage.getItem(KEY); if (saved) this.data = parseLibrary(JSON.parse(saved)); }
    catch { this.storageWarning = ' Visual storage unavailable or unreadable. Export your library to keep it.'; }
    for (const key of ['hue','orbit','spread','motion','trails'] as const) {
      const input = el<HTMLInputElement>(`look-${key}`);
      input.value = String(this.look[key]);
      input.addEventListener('input', () => {
        this.look[key] = Number(input.value);
        this.learned = false;
        el<HTMLInputElement>('use-learned').checked = false;
        this.options.style(this.look);
        this.renderStatus();
      });
    }
    el<HTMLButtonElement>('teach-look').onclick = () => {
      if (this.learned) { this.message.textContent = 'Switch to Design your look before teaching an example.'; return; }
      const features = featuresFor(options.score(), options.controls());
      if (this.data.examples.some(e => distance(e.features, features) < 1e-8)) {
        this.message.textContent = 'This musical setting already has an example. Change the music or tone controls, or undo the last example first.'; return;
      }
      if (this.data.examples.length >= MAX_EXAMPLES) { this.message.textContent = '128 examples reached. Export this library before starting another.'; return; }
      this.data.examples.push({ name: el<HTMLInputElement>('look-name').value.trim().slice(0,80) || `Study ${this.data.examples.length + 1}`, features, style: { ...this.look } });
      this.pending = true; this.renderStatus(); this.persist();
    };
    el<HTMLButtonElement>('train-looks').onclick = () => {
      if (distinctCount(this.data.examples) < 3) { this.message.textContent = 'Teach three different musical settings first. Choose another loop or change tempo / tone, then design its look.'; return; }
      this.data.trained = structuredClone(this.data.examples); this.pending = false;
      this.learned = true; el<HTMLInputElement>('use-learned').checked = true;
      this.refresh(); this.persist();
    };
    el<HTMLInputElement>('use-learned').onchange = e => {
      const input = e.currentTarget as HTMLInputElement;
      if (input.checked && distinctCount(this.data.trained) < 3) { input.checked = false; this.message.textContent = 'Teach three examples and press Train visual instrument first.'; return; }
      this.learned = input.checked; this.refresh();
    };
    el<HTMLButtonElement>('undo-look').onclick = () => {
      this.data.examples.pop(); this.pending = true; this.renderStatus(); this.persist();
    };
    el<HTMLButtonElement>('export-looks').onclick = () => {
      const blob = new Blob([JSON.stringify(this.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob); const a = document.createElement('a');
      a.href = url; a.download = 'my-visual-instrument.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    el<HTMLInputElement>('import-looks').onchange = async e => {
      const input = e.currentTarget as HTMLInputElement; const file = input.files?.[0]; if (!file) return;
      try {
        if (file.size > 1_000_000) throw new Error('Visual libraries must be under 1 MB.');
        const next = parseLibrary(JSON.parse(await file.text()));
        if (this.data.examples.length && !window.confirm('Replace your local visual library? Export it first if you want a backup.')) return;
        this.data = next; this.pending = false; this.learned = false;
        el<HTMLInputElement>('use-learned').checked = false; this.refresh(); this.persist();
      } catch (error) { this.message.textContent = error instanceof Error ? error.message : 'Could not import library.'; }
      finally { input.value = ''; }
    };
    el<HTMLInputElement>('quick-tempo').onchange = e => {
      const value = Number((e.currentTarget as HTMLInputElement).value);
      if (!Number.isFinite(value) || value < 20 || value > 300) { this.message.textContent = 'Tempo must be 20–300 BPM.'; return; }
      if (!options.edit(value, null, null)) this.message.textContent = 'Fix the pattern errors before using musical controls.';
      this.refresh();
    };
    el<HTMLButtonElement>('focus-stage').onclick = () => {
      document.body.classList.toggle('performing');
      el<HTMLButtonElement>('focus-stage').textContent = document.body.classList.contains('performing') ? 'Exit performance view' : 'Performance view';
      window.dispatchEvent(new Event('resize'));
    };
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape' && document.body.classList.contains('performing')) el<HTMLButtonElement>('focus-stage').click();
    });
    this.refresh();
  }
  refresh(): void {
    const score = this.options.score();
    // Do not steal an in-progress tempo edit.
    if (document.activeElement !== el('quick-tempo')) el<HTMLInputElement>('quick-tempo').value = String(score.tempo);
    const signature = JSON.stringify(score.voices.map(v => [v.name,v.level,v.muted]));
    if (signature !== this.signature && !el('voice-mixer').contains(document.activeElement)) {
      this.signature = signature; const mixer = el('voice-mixer'); mixer.replaceChildren();
      score.voices.forEach((voice, index) => {
        const label = document.createElement('label'); label.className = 'voice-level';
        const name = document.createElement('span'); name.textContent = `${voice.name}${voice.muted ? ' (muted in code)' : ''}`;
        const range = document.createElement('input'); range.type = 'range'; range.min = '0'; range.max = '1'; range.step = '0.01'; range.value = String(voice.level); range.setAttribute('aria-label', `${voice.name} level`);
        range.onchange = () => { if (!this.options.edit(null,index,Number(range.value))) this.message.textContent = 'Fix the pattern errors before changing levels.'; this.signature = ''; };
        label.append(name,range); mixer.append(label);
      });
    }
    const predicted = this.learned ? predict(this.data.trained, featuresFor(score,this.options.controls())) : null;
    this.options.style(predicted ?? this.look);
    this.renderStatus();
  }
  private renderStatus(): void {
    el('example-count').textContent = `${this.data.examples.length} taught · ${this.data.trained.length} trained`;
    el<HTMLButtonElement>('undo-look').disabled = !this.data.examples.length;
    el('visual-mode').textContent = this.learned ? 'YOUR EXAMPLE MODEL · LIVE' : 'DESIGNED VISUALS · MANUAL';
    this.message.textContent = this.learned
      ? `Following ${this.data.trained.length} of your examples. Colours and geometry respond to musical features and tone controls.${this.pending ? ' New teaching changes need retraining.' : ''}`
      : `Design mode. ${this.data.examples.length ? `${distinctCount(this.data.examples)} distinct musical examples saved.` : 'Your visual model is empty.'} Teach at least three different settings, then train.${this.pending ? ' Training changes pending.' : ''}`;
    this.message.textContent += this.storageWarning;
  }
  private persist(): void {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); }
    catch { this.storageWarning = ' Browser storage failed; export your visual library now.'; this.message.textContent += this.storageWarning; }
  }
}
