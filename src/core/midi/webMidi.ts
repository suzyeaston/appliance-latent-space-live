import {
  createControlEvent,
  resolveMidiBinding,
  type ControlEvent,
  type ControlMap,
  type ControlState,
} from '../control-map/controlMap';

export type MidiPacketType = 'cc' | 'note';

export interface DecodedMidiPacket {
  type: MidiPacketType;
  /** Human MIDI channel, 1..16. */
  channel: number;
  /** CC number or note number, 0..127. */
  number: number;
  /** Raw 7-bit value, 0..127. */
  rawValue: number;
  /** 0..1 normalized value. */
  value: number;
  /** Note-on with velocity 0 is treated as release. */
  pressed: boolean;
}

export interface MidiMessageLike {
  data: ArrayLike<number>;
}

export interface MidiInputLike {
  id: string;
  name?: string | null;
  manufacturer?: string | null;
  onmidimessage: ((event: MidiMessageLike) => void) | null;
}

export interface MidiAccessLike {
  inputs: { values(): IterableIterator<MidiInputLike> };
  onstatechange: (() => void) | null;
}

interface NavigatorWithMidi {
  requestMIDIAccess?: (options?: { sysex?: boolean; software?: boolean }) => Promise<MidiAccessLike>;
}

export interface MidiBridgeStatus {
  supported: boolean;
  connectedInputs: number;
  names: string[];
}

export interface WebMidiBridgeOptions {
  map: ControlMap;
  state: ControlState;
  now: () => number;
  onEvent: (event: ControlEvent) => void;
  onStatus?: (status: MidiBridgeStatus) => void;
}

/** Parse only CC, note-on and note-off. Other MIDI is intentionally ignored. */
export function decodeMidiMessage(data: ArrayLike<number>): DecodedMidiPacket | null {
  if (data.length < 2) return null;

  const status = Number(data[0] ?? 0);
  const command = status & 0xf0;
  const channel = (status & 0x0f) + 1;
  const number = Math.max(0, Math.min(127, Number(data[1] ?? 0)));
  const rawValue = Math.max(0, Math.min(127, Number(data[2] ?? 0)));

  if (command === 0xb0) {
    return {
      type: 'cc',
      channel,
      number,
      rawValue,
      value: rawValue / 127,
      pressed: rawValue > 0,
    };
  }

  if (command === 0x90 || command === 0x80) {
    const pressed = command === 0x90 && rawValue > 0;
    return {
      type: 'note',
      channel,
      number,
      rawValue,
      value: rawValue / 127,
      pressed,
    };
  }

  return null;
}

/** Convert raw MIDI into the same semantic ControlEvent used by pointer and keyboard input. */
export function midiPacketToControlEvent(
  map: ControlMap,
  state: ControlState,
  packet: DecodedMidiPacket,
  at: number,
): ControlEvent | null {
  const control = resolveMidiBinding(map, {
    type: packet.type,
    channel: packet.channel,
    number: packet.number,
  });
  if (!control) return null;

  if (control.kind === 'continuous') {
    if (packet.type !== 'cc') return null;
    const [min, max] = control.range;
    const value = min + packet.value * (max - min);
    return createControlEvent(control, value, { source: 'midi', at });
  }

  if (packet.type !== 'note') return null;

  if (control.kind === 'toggle') {
    // Note-off must not undo a toggle.
    if (!packet.pressed) return null;
    const current = state[control.id] ?? control.default;
    return createControlEvent(control, current >= 0.5 ? 0 : 1, { source: 'midi', at });
  }

  return createControlEvent(control, packet.pressed ? 1 : 0, { source: 'midi', at });
}

export class WebMidiBridge {
  private readonly options: WebMidiBridgeOptions;
  private readonly request: NavigatorWithMidi['requestMIDIAccess'] | null;
  private access: MidiAccessLike | null = null;
  private boundInputs = new Set<MidiInputLike>();

  constructor(options: WebMidiBridgeOptions) {
    this.options = options;
    const nav = navigator as unknown as NavigatorWithMidi;
    const request = nav.requestMIDIAccess;
    this.request = typeof request === 'function' ? request.bind(nav) : null;
  }

  get supported(): boolean {
    return Boolean(this.request);
  }

  async connect(): Promise<MidiBridgeStatus> {
    if (!this.request) {
      const status = { supported: false, connectedInputs: 0, names: [] };
      this.options.onStatus?.(status);
      return status;
    }

    this.access = await this.request({ sysex: false });
    this.access.onstatechange = () => {
      this.bindInputs();
      this.report();
    };

    this.bindInputs();
    return this.report();
  }

  private bindInputs(): void {
    this.boundInputs.forEach((input) => {
      input.onmidimessage = null;
    });
    this.boundInputs.clear();

    if (!this.access) return;

    for (const input of this.access.inputs.values()) {
      input.onmidimessage = (event) => {
        const packet = decodeMidiMessage(event.data);
        if (!packet) return;

        const controlEvent = midiPacketToControlEvent(
          this.options.map,
          this.options.state,
          packet,
          this.options.now(),
        );
        if (controlEvent) this.options.onEvent(controlEvent);
      };
      this.boundInputs.add(input);
    }
  }

  private report(): MidiBridgeStatus {
    const names = [...this.boundInputs].map((input) => {
      const maker = input.manufacturer?.trim();
      const name = input.name?.trim() || input.id;
      return maker && !name.toLowerCase().includes(maker.toLowerCase())
        ? `${maker} ${name}`
        : name;
    });

    const status = {
      supported: this.supported,
      connectedInputs: names.length,
      names,
    };
    this.options.onStatus?.(status);
    return status;
  }
}
