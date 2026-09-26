/**
 * TypeScript port of `js/appliance-control-map.js` from suzyeastonca (read-only upstream,
 * merged in PR #664). The behaviour is deliberately identical: same sanitising rules, same
 * first-claim-wins binding uniqueness, same control-event shape. `control-map.json` in this
 * folder is a byte copy of the upstream source of truth, so the semantic ids, keyboard keys
 * and MIDI assignments (channel 1, CC 21-26, notes 36-39) are inherited rather than invented.
 *
 * Pure: no DOM, no audio, no timers. Every input source — pointer, keyboard, a future Web MIDI
 * adapter — funnels through `createControlEvent` and nothing else reaches the engine. The AI
 * boundary is deliberately not a control source: proposals arrive as patterns, not as gestures.
 */

export const CONTROL_KINDS = ['continuous', 'momentary', 'toggle'] as const;
export const MIDI_BINDING_TYPES = ['cc', 'note'] as const;
export const INPUT_SOURCES = ['pointer', 'keyboard', 'midi'] as const;

export type ControlKind = (typeof CONTROL_KINDS)[number];
export type MidiBindingType = (typeof MIDI_BINDING_TYPES)[number];
export type InputSource = (typeof INPUT_SOURCES)[number];

export interface KeyboardBinding {
  key: string;
  step: number;
}

export interface MidiBinding {
  type: MidiBindingType;
  channel: number;
  number: number;
}

export interface HardwareBinding {
  source: string;
  notes: string;
}

export interface Control {
  id: string;
  label: string;
  description: string;
  kind: ControlKind;
  group: string;
  range: [number, number];
  default: number;
  keyboard: KeyboardBinding | null;
  midi: MidiBinding | null;
  hardware: HardwareBinding | null;
}

export interface ControlGroup {
  id: string;
  label: string;
}

export interface ControlMap {
  schemaVersion: string;
  instrumentId: string;
  instrumentName: string;
  groups: ControlGroup[];
  controls: Control[];
}

export interface ControlEvent {
  id: string;
  kind: ControlKind;
  group: string;
  value: number;
  source: InputSource;
  at: number;
}

export type ControlState = Record<string, number>;

const DEFAULT_RANGE: [number, number] = [0, 1];
const DEFAULT_STEP = 0.05;

type Unknown = Record<string, unknown>;

function isPlainObject(value: unknown): value is Unknown {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function sanitizeControlId(value: unknown): string {
  return typeof value === 'string' && /^[a-z][a-z0-9_]*$/.test(value) ? value : '';
}

function sanitizeSlug(value: unknown): string {
  return typeof value === 'string' && /^[a-z][a-z0-9-]*$/.test(value) ? value : '';
}

function sanitizeText(value: unknown, fallback: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || fallback;
}

function sanitizeRange(value: unknown): [number, number] {
  if (!Array.isArray(value) || value.length !== 2) return [...DEFAULT_RANGE];
  const [min, max] = value as unknown[];
  if (!isFiniteNumber(min) || !isFiniteNumber(max) || min >= max) return [...DEFAULT_RANGE];
  return [min, max];
}

// Keys are compared against KeyboardEvent.key, which reports a single space for Space.
function sanitizeKey(value: unknown): string {
  if (typeof value !== 'string' || !value.length) return '';
  if (value === ' ') return ' ';
  return value.trim().toLowerCase();
}

function sanitizeKeyboard(value: unknown): KeyboardBinding | null {
  if (!isPlainObject(value)) return null;
  const key = sanitizeKey(value['key']);
  if (!key) return null;
  const step = value['step'];
  return { key, step: isFiniteNumber(step) && step > 0 ? step : DEFAULT_STEP };
}

function sanitizeMidi(value: unknown): MidiBinding | null {
  if (!isPlainObject(value)) return null;
  const rawType = value['type'];
  const type = typeof rawType === 'string' ? rawType.trim().toLowerCase() : '';
  if (!MIDI_BINDING_TYPES.includes(type as MidiBindingType)) return null;
  const channel = value['channel'];
  const number = value['number'];
  if (!Number.isInteger(channel) || (channel as number) < 1 || (channel as number) > 16) return null;
  if (!Number.isInteger(number) || (number as number) < 0 || (number as number) > 127) return null;
  return { type: type as MidiBindingType, channel: channel as number, number: number as number };
}

// The appliance does not exist yet, so hardware bindings stay optional until there is
// something to solder them to.
function sanitizeHardware(value: unknown): HardwareBinding | null {
  if (!isPlainObject(value)) return null;
  const source = sanitizeText(value['source'], '');
  const notes = sanitizeText(value['notes'], '');
  if (!source && !notes) return null;
  return { source, notes };
}

export function clampControlValue(control: Control | null | undefined, value: unknown): number {
  if (!control) return 0;
  const numeric = isFiniteNumber(value) ? value : 0;
  if (control.kind !== 'continuous') return numeric >= 0.5 ? 1 : 0;
  const [min, max] = sanitizeRange(control.range);
  return Math.min(max, Math.max(min, numeric));
}

function normalizeControl(raw: unknown, groupIds: string[]): Control | null {
  if (!isPlainObject(raw)) return null;
  const id = sanitizeControlId(raw['id']);
  if (!id) return null;
  const kind = raw['kind'];
  if (!CONTROL_KINDS.includes(kind as ControlKind)) return null;

  const group = raw['group'];
  const control: Control = {
    id,
    label: sanitizeText(raw['label'], id),
    description: sanitizeText(raw['description'], ''),
    kind: kind as ControlKind,
    group: typeof group === 'string' && groupIds.includes(group) ? group : '',
    range: kind === 'continuous' ? sanitizeRange(raw['range']) : [...DEFAULT_RANGE],
    default: 0,
    keyboard: sanitizeKeyboard(raw['keyboard']),
    midi: sanitizeMidi(raw['midi']),
    hardware: sanitizeHardware(raw['hardware']),
  };
  const rawDefault = raw['default'];
  control.default = clampControlValue(control, isFiniteNumber(rawDefault) ? rawDefault : control.range[0]);
  return control;
}

export function midiBindingKey(binding: unknown): string {
  const sanitized = sanitizeMidi(binding);
  return sanitized ? `${sanitized.type}:${sanitized.channel}:${sanitized.number}` : '';
}

function normalizeGroups(raw: unknown): ControlGroup[] {
  const groups: ControlGroup[] = [];
  const seen: string[] = [];
  (Array.isArray(raw) ? raw : []).forEach((entry) => {
    if (!isPlainObject(entry)) return;
    const id = sanitizeControlId(entry['id']);
    if (!id || seen.includes(id)) return;
    seen.push(id);
    groups.push({ id, label: sanitizeText(entry['label'], id) });
  });
  return groups;
}

// Two controls fighting over one key or one CC would make the physical and browser
// instruments disagree, so the first claim wins and later duplicates lose the binding.
export function normalizeControlMap(raw: unknown): ControlMap {
  const source: Unknown = isPlainObject(raw) ? raw : {};
  const groups = normalizeGroups(source['groups']);
  const groupIds = groups.map((group) => group.id);
  const controls: Control[] = [];
  const claimedIds: string[] = [];
  const claimedKeys: string[] = [];
  const claimedMidi: string[] = [];

  (Array.isArray(source['controls']) ? (source['controls'] as unknown[]) : []).forEach((entry) => {
    const control = normalizeControl(entry, groupIds);
    if (!control || claimedIds.includes(control.id)) return;
    claimedIds.push(control.id);

    if (control.keyboard) {
      if (!claimedKeys.includes(control.keyboard.key)) claimedKeys.push(control.keyboard.key);
      else control.keyboard = null;
    }

    const key = midiBindingKey(control.midi);
    if (key) {
      if (!claimedMidi.includes(key)) claimedMidi.push(key);
      else control.midi = null;
    }

    controls.push(control);
  });

  return {
    schemaVersion: sanitizeText(source['schemaVersion'], '0.0.0'),
    instrumentId: sanitizeSlug(source['instrumentId']) || 'appliance-latent-space',
    instrumentName: sanitizeText(source['instrumentName'], 'The Appliance Latent Space'),
    groups,
    controls,
  };
}

export function controlById(map: ControlMap, id: string): Control | null {
  const wanted = sanitizeControlId(id);
  if (!wanted) return null;
  return map.controls.find((control) => control.id === wanted) ?? null;
}

export function resolveKeyBinding(map: ControlMap, key: string): Control | null {
  const wanted = sanitizeKey(key);
  if (!wanted) return null;
  return map.controls.find((control) => control.keyboard?.key === wanted) ?? null;
}

export function resolveMidiBinding(map: ControlMap, message: unknown): Control | null {
  const wanted = midiBindingKey(message);
  if (!wanted) return null;
  return map.controls.find((control) => midiBindingKey(control.midi) === wanted) ?? null;
}

export function createControlState(map: ControlMap): ControlState {
  const state: ControlState = {};
  map.controls.forEach((control) => {
    state[control.id] = clampControlValue(control, control.default);
  });
  return state;
}

export function applyKeyboardStep(
  control: Control,
  currentValue: number,
  options: { shiftKey?: boolean } = {},
): number {
  if (control.kind === 'momentary') return 1;
  if (control.kind === 'toggle') return clampControlValue(control, currentValue) ? 0 : 1;
  const step = control.keyboard && isFiniteNumber(control.keyboard.step) ? control.keyboard.step : DEFAULT_STEP;
  const next = clampControlValue(control, currentValue) + (options.shiftKey ? -step : step);
  // Holding a key walks this function hundreds of times; without the rounding the readout
  // drifts into 0.45000000000000007 territory within a few presses.
  return clampControlValue(control, Math.round(next * 1e6) / 1e6);
}

export function createControlEvent(
  control: Control,
  value: number,
  options: { source?: InputSource; at?: number } = {},
): ControlEvent {
  return {
    id: control.id,
    kind: control.kind,
    group: control.group,
    value: clampControlValue(control, value),
    source: INPUT_SOURCES.includes(options.source as InputSource) ? (options.source as InputSource) : 'pointer',
    at: isFiniteNumber(options.at) ? options.at : 0,
  };
}
