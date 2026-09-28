/**
 * Builds the control surface from the shared control map.
 *
 * Continuous controls are real range inputs, momentary and toggle controls are real buttons with
 * `aria-pressed` where it applies, and groups are real fieldsets. Every element carries
 * `data-control="<id>"`, matching the convention the upstream page template established, so a
 * future adapter can find them the same way.
 */

import {
  applyKeyboardStep,
  clampControlValue,
  createControlEvent,
  type Control,
  type ControlEvent,
  type ControlMap,
  type ControlState,
  type InputSource,
} from '../core/control-map/controlMap';
import { controlStatus } from '../core/control-map/status';
import { clear, formatValue, make } from './dom';

export interface ControlSurfaceOptions {
  map: ControlMap;
  state: ControlState;
  onEvent: (event: ControlEvent) => void;
  /** Audio-clock time for the event stamp, or 0 before audio exists. */
  now: () => number;
}

interface Bound {
  control: Control;
  input: HTMLInputElement | HTMLButtonElement;
  readout: HTMLOutputElement | null;
}

export class ControlSurface {
  private readonly options: ControlSurfaceOptions;
  private readonly bound = new Map<string, Bound>();

  constructor(container: HTMLElement, options: ControlSurfaceOptions) {
    this.options = options;
    clear(container);
    options.map.groups.forEach((group) => {
      const controls = options.map.controls.filter((control) => control.group === group.id);
      if (!controls.length) return;
      const fieldset = make('fieldset', { className: 'group' });
      fieldset.appendChild(make('legend', { text: group.label }));
      controls.forEach((control) => fieldset.appendChild(this.buildControl(control)));
      if (group.id === 'latent') {
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = 'Future sound model · not connected';
        details.append(summary, fieldset); container.appendChild(details);
      } else container.appendChild(fieldset);
    });
  }

  /** Reflect a value that changed somewhere else (keyboard, a loaded project, a reset). */
  reflect(id: string, value: number): void {
    const entry = this.bound.get(id);
    if (!entry) return;
    const clamped = clampControlValue(entry.control, value);
    if (entry.input instanceof HTMLInputElement) {
      entry.input.value = String(clamped);
    } else if (entry.control.kind === 'toggle') {
      entry.input.setAttribute('aria-pressed', clamped >= 0.5 ? 'true' : 'false');
    }
    if (entry.readout) entry.readout.textContent = formatValue(clamped);
  }

  private emit(control: Control, value: number, source: InputSource): void {
    this.options.onEvent(createControlEvent(control, value, { source, at: this.options.now() }));
  }

  private buildControl(control: Control): HTMLElement {
    const status = controlStatus(control.id);
    const disabled = status.state !== 'active';
    const row = make('div', {
      className: control.kind === 'continuous' ? 'control' : 'control control--button',
      attrs: { 'data-control-row': control.id, 'data-state': status.state },
    });

    const name = make('span', { className: 'control__name', text: control.label });
    if (control.keyboard) {
      const key = make('kbd', { text: control.keyboard.key === ' ' ? 'SPACE' : control.keyboard.key.toUpperCase() });
      key.setAttribute('aria-hidden', 'true');
      name.appendChild(key);
    }
    row.appendChild(name);

    const describedById = `control-note-${control.id}`;
    const note = make('p', {
      className: 'control__note',
      text: disabled ? `${control.description} — disabled: ${status.scope}` : `${control.description} — ${status.scope}`,
      attrs: { id: describedById },
    });

    if (control.kind === 'continuous') {
      const input = make('input', {
        attrs: {
          type: 'range',
          min: String(control.range[0]),
          max: String(control.range[1]),
          step: String(control.keyboard?.step ?? 0.01),
          'data-control': control.id,
          'aria-label': control.label,
          'aria-describedby': describedById,
        },
      }) as HTMLInputElement;
      input.value = String(this.options.state[control.id] ?? control.default);
      input.disabled = disabled;

      const readout = make('output', { text: formatValue(Number(input.value)) }) as HTMLOutputElement;
      input.addEventListener('input', () => {
        const value = Number(input.value);
        readout.textContent = formatValue(value);
        this.emit(control, value, 'pointer');
      });

      row.appendChild(input);
      row.appendChild(readout);
      row.appendChild(note);
      this.bound.set(control.id, { control, input, readout });
      return row;
    }

    const button = make('button', {
      className: 'btn btn--small',
      text: control.label,
      attrs: {
        type: 'button',
        'data-control': control.id,
        'aria-describedby': describedById,
        ...(control.kind === 'toggle' ? { 'aria-pressed': 'false' } : {}),
      },
    }) as HTMLButtonElement;
    button.disabled = disabled;

    if (control.kind === 'toggle') {
      button.addEventListener('click', () => {
        const next = button.getAttribute('aria-pressed') === 'true' ? 0 : 1;
        button.setAttribute('aria-pressed', next ? 'true' : 'false');
        this.emit(control, next, 'pointer');
      });
    } else {
      button.addEventListener('click', () => {
        this.emit(control, 1, 'pointer');
        this.emit(control, 0, 'pointer');
      });
    }

    row.appendChild(button);
    row.appendChild(note);
    this.bound.set(control.id, { control, input: button, readout: null });
    return row;
  }

  /**
   * Resolve a keypress into the next value for a control. Returns null when the control is not
   * wired up in this prototype, so a disabled control cannot be driven from the keyboard either.
   */
  stepFromKeyboard(control: Control, shiftKey: boolean): number | null {
    if (controlStatus(control.id).state !== 'active') return null;
    const current = clampControlValue(control, this.options.state[control.id] ?? control.default);
    return applyKeyboardStep(control, current, { shiftKey });
  }

  emitKeyboard(control: Control, value: number): void {
    this.emit(control, value, 'keyboard');
  }
}
