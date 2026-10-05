import { describe, expect, it } from 'vitest';
import rawMap from '../../src/core/control-map/control-map.json';
import { createControlState, normalizeControlMap } from '../../src/core/control-map/controlMap';
import { decodeMidiMessage, midiPacketToControlEvent } from '../../src/core/midi/webMidi';

const map = normalizeControlMap(rawMap);

describe('Web MIDI decoding', () => {
  it('decodes channel-1 CC', () => {
    expect(decodeMidiMessage([0xb0, 21, 127])).toEqual({
      type: 'cc',
      channel: 1,
      number: 21,
      rawValue: 127,
      value: 1,
      pressed: true,
    });
  });

  it('decodes note-on and velocity-zero note-off', () => {
    expect(decodeMidiMessage([0x90, 36, 100])?.pressed).toBe(true);
    expect(decodeMidiMessage([0x90, 36, 0])?.pressed).toBe(false);
    expect(decodeMidiMessage([0x80, 36, 64])?.pressed).toBe(false);
  });

  it('keeps MIDI channels human-readable at 1..16', () => {
    expect(decodeMidiMessage([0x91, 36, 100])?.channel).toBe(2);
    expect(decodeMidiMessage([0x9f, 36, 100])?.channel).toBe(16);
  });

  it('ignores messages outside the bridge contract', () => {
    expect(decodeMidiMessage([0xe0, 0, 64])).toBeNull();
    expect(decodeMidiMessage([0xf8])).toBeNull();
  });
});

describe('MIDI to semantic control events', () => {
  it('maps CC21 to browning through the shared control map', () => {
    const packet = decodeMidiMessage([0xb0, 21, 127]);
    if (!packet) throw new Error('packet did not decode');

    expect(midiPacketToControlEvent(map, createControlState(map), packet, 2.5)).toEqual({
      id: 'browning',
      kind: 'continuous',
      group: 'tone',
      value: 1,
      source: 'midi',
      at: 2.5,
    });
  });

  it('maps momentary note-on and note-off', () => {
    const state = createControlState(map);
    const down = decodeMidiMessage([0x90, 36, 100]);
    const up = decodeMidiMessage([0x80, 36, 0]);
    if (!down || !up) throw new Error('packet did not decode');

    expect(midiPacketToControlEvent(map, state, down, 1)?.id).toBe('plunge');
    expect(midiPacketToControlEvent(map, state, down, 1)?.value).toBe(1);
    expect(midiPacketToControlEvent(map, state, up, 2)?.value).toBe(0);
  });

  it('toggles freeze on note-on and ignores note-off', () => {
    const state = createControlState(map);
    const down = decodeMidiMessage([0x90, 38, 100]);
    const up = decodeMidiMessage([0x80, 38, 0]);
    if (!down || !up) throw new Error('packet did not decode');

    expect(midiPacketToControlEvent(map, state, down, 1)?.value).toBe(1);
    state.freeze = 1;
    expect(midiPacketToControlEvent(map, state, down, 2)?.value).toBe(0);
    expect(midiPacketToControlEvent(map, state, up, 3)).toBeNull();
  });

  it('ignores unmapped notes and CCs', () => {
    const state = createControlState(map);
    const cc = decodeMidiMessage([0xb0, 7, 127]);
    const note = decodeMidiMessage([0x90, 60, 100]);
    if (!cc || !note) throw new Error('packet did not decode');

    expect(midiPacketToControlEvent(map, state, cc, 0)).toBeNull();
    expect(midiPacketToControlEvent(map, state, note, 0)).toBeNull();
  });
});
