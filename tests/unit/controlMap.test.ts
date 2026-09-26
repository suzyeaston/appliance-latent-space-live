import { describe, expect, it } from 'vitest';
import rawMap from '../../src/core/control-map/control-map.json';
import {
  applyKeyboardStep,
  clampControlValue,
  createControlEvent,
  createControlState,
  midiBindingKey,
  normalizeControlMap,
  resolveKeyBinding,
  resolveMidiBinding,
} from '../../src/core/control-map/controlMap';
import { CONTROL_STATUS, controlStatus } from '../../src/core/control-map/status';

const map = normalizeControlMap(rawMap);

/**
 * The map is a byte copy of the suzyeastonca source of truth. These assertions pin the values
 * that a future toaster or MIDI adapter has to agree with, so a careless edit here shows up as a
 * failure rather than as two instruments that disagree.
 */
describe('the shared control vocabulary', () => {
  it('keeps every semantic id from upstream', () => {
    expect(map.controls.map((control) => control.id)).toEqual([
      'browning',
      'destruction',
      'latent_x',
      'latent_y',
      'neural_mix',
      'memory',
      'freeze',
      'plunge',
      'capture',
      'kill',
    ]);
  });

  it('keeps the upstream MIDI assignments on channel 1', () => {
    expect(map.controls.filter((c) => c.midi).every((c) => c.midi?.channel === 1)).toBe(true);
    expect(midiBindingKey(map.controls[0]?.midi)).toBe('cc:1:21');
    expect(resolveMidiBinding(map, { type: 'cc', channel: 1, number: 26 })?.id).toBe('memory');
    expect(resolveMidiBinding(map, { type: 'note', channel: 1, number: 39 })?.id).toBe('kill');
    expect(resolveMidiBinding(map, { type: 'note', channel: 2, number: 39 })).toBeNull();
  });

  it('never needs the duplicate-binding rescue on the shipped map', () => {
    const keys = map.controls.filter((c) => c.keyboard).map((c) => c.keyboard?.key);
    const midi = map.controls.filter((c) => c.midi).map((c) => midiBindingKey(c.midi));
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(midi).size).toBe(midi.length);
    expect(keys.length).toBe(10);
  });

  it('resolves the space binding to plunge', () => {
    expect(resolveKeyBinding(map, ' ')?.id).toBe('plunge');
    expect(resolveKeyBinding(map, 'K')?.id).toBe('kill');
  });

  it('lets the first claim win when two controls fight over a binding', () => {
    const rescued = normalizeControlMap({
      groups: [{ id: 'tone', label: 'tone' }],
      controls: [
        { id: 'first', kind: 'continuous', group: 'tone', keyboard: { key: 'b' }, midi: { type: 'cc', channel: 1, number: 21 } },
        { id: 'second', kind: 'continuous', group: 'tone', keyboard: { key: 'b' }, midi: { type: 'cc', channel: 1, number: 21 } },
      ],
    });
    expect(rescued.controls[0]?.keyboard?.key).toBe('b');
    expect(rescued.controls[1]?.keyboard).toBeNull();
    expect(rescued.controls[1]?.midi).toBeNull();
  });

  it('drops malformed controls instead of half-accepting them', () => {
    const cleaned = normalizeControlMap({
      groups: [{ id: 'tone', label: 'tone' }],
      controls: [
        { id: 'Bad Id', kind: 'continuous' },
        { id: 'no_kind' },
        { id: 'ok', kind: 'toggle', group: 'nope' },
      ],
    });
    expect(cleaned.controls.map((c) => c.id)).toEqual(['ok']);
    expect(cleaned.controls[0]?.group).toBe('');
  });

  it('clamps continuous values and squares off switch values', () => {
    const browning = map.controls.find((c) => c.id === 'browning');
    const freeze = map.controls.find((c) => c.id === 'freeze');
    expect(clampControlValue(browning ?? null, 4)).toBe(1);
    expect(clampControlValue(browning ?? null, -2)).toBe(0);
    expect(clampControlValue(browning ?? null, Number.NaN)).toBe(0);
    expect(clampControlValue(freeze ?? null, 0.6)).toBe(1);
    expect(clampControlValue(freeze ?? null, 0.4)).toBe(0);
  });

  it('steps continuous controls without floating-point drift', () => {
    const browning = map.controls.find((c) => c.id === 'browning');
    if (!browning) throw new Error('missing control');
    let value = 0.35;
    for (let i = 0; i < 6; i += 1) value = applyKeyboardStep(browning, value, {});
    expect(value).toBe(0.65);
    expect(applyKeyboardStep(browning, value, { shiftKey: true })).toBe(0.6);
    expect(applyKeyboardStep(browning, 1, {})).toBe(1);
  });

  it('builds control events with a validated source', () => {
    const kill = map.controls.find((c) => c.id === 'kill');
    if (!kill) throw new Error('missing control');
    expect(createControlEvent(kill, 1, { source: 'midi', at: 2.5 })).toEqual({
      id: 'kill',
      kind: 'momentary',
      group: 'gesture',
      value: 1,
      source: 'midi',
      at: 2.5,
    });
    expect(createControlEvent(kill, 1, { source: 'telepathy' as never }).source).toBe('pointer');
  });

  it('starts every control at its documented default', () => {
    expect(createControlState(map)).toEqual({
      browning: 0.35,
      destruction: 0,
      latent_x: 0.5,
      latent_y: 0.5,
      neural_mix: 0,
      memory: 0.25,
      freeze: 0,
      plunge: 0,
      capture: 0,
      kill: 0,
    });
  });
});

describe('implementation status', () => {
  it('describes every control in the map', () => {
    map.controls.forEach((control) => {
      expect(CONTROL_STATUS[control.id], `missing status for ${control.id}`).toBeDefined();
      expect(controlStatus(control.id).scope.length).toBeGreaterThan(10);
    });
  });

  it('does not claim a latent space or a model is running', () => {
    expect(controlStatus('latent_x').state).toBe('unimplemented');
    expect(controlStatus('latent_y').state).toBe('unimplemented');
    expect(controlStatus('neural_mix').state).toBe('unimplemented');
  });

  it('labels the two scopes of memory', () => {
    const scope = controlStatus('memory').scope.toLowerCase();
    expect(scope).toContain('delay');
    expect(scope).toContain('trail');
  });
});
