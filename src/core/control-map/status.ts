/**
 * What each control in the shared vocabulary actually does *in this prototype*.
 *
 * This is a separate layer on purpose. `control-map.json` and `controlMap.ts` are the shared
 * vocabulary copied from suzyeastonca and must not be bent to describe one front end's progress.
 * Anything marked `unimplemented` is rendered disabled with this explanation attached, so the
 * instrument never implies a latent space, a model or a toaster is running.
 */

export type ControlImplementation = 'active' | 'unimplemented';

export interface ControlStatus {
  state: ControlImplementation;
  /** Plain-language description of exactly what the control touches right now. */
  scope: string;
}

export const CONTROL_STATUS: Record<string, ControlStatus> = {
  browning: {
    state: 'active',
    scope: 'Master low-pass cutoff and voice harmonic colour. Audio only.',
  },
  destruction: {
    state: 'active',
    scope: 'Bounded waveshaper drive with level compensation. Audio only.',
  },
  latent_x: {
    state: 'unimplemented',
    scope: 'No latent space exists. Nothing is wired to this axis.',
  },
  latent_y: {
    state: 'unimplemented',
    scope: 'No latent space exists. Nothing is wired to this axis.',
  },
  neural_mix: {
    state: 'unimplemented',
    scope: 'No model runs in this prototype, so there is no wet signal to mix.',
  },
  memory: {
    state: 'active',
    scope: 'Two scopes at once: feedback-delay amount in the audio graph, and how long note trails persist on the canvas.',
  },
  freeze: {
    state: 'active',
    scope: 'Holds the sequencer on the current bar; the loop stops advancing until released.',
  },
  plunge: {
    state: 'active',
    scope: 'Starts playback from bar 1, or restarts the loop from bar 1 if it is already running.',
  },
  capture: {
    state: 'active',
    scope: 'Snapshots the current pattern text and control values into a recall slot in memory.',
  },
  kill: {
    state: 'active',
    scope: 'Immediate silence: cancels scheduled notes, stops every voice and clears the delay line.',
  },
};

export function controlStatus(id: string): ControlStatus {
  return (
    CONTROL_STATUS[id] ?? {
      state: 'unimplemented',
      scope: 'Not wired in this prototype.',
    }
  );
}

export function isActive(id: string): boolean {
  return controlStatus(id).state === 'active';
}
