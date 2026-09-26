/**
 * The saved-file format, and the validator that guards the import button.
 *
 * A project file is plain versioned JSON. Importing one never evaluates anything: unknown keys
 * are dropped, every value is range-checked, and the pattern is only ever handed to the parser.
 */

import { parsePattern } from '../pattern/parse';
import type { PatternIssue } from '../pattern/types';

export const PROJECT_FORMAT = 'appliance-latent-space.project';
export const PROJECT_VERSION = 1;

export interface ProjectFile {
  format: string;
  version: number;
  instrumentId: string;
  title: string;
  pattern: string;
  controls: Record<string, number>;
  master: number;
  visualIntensity: number;
  reducedMotion: boolean;
  savedAt: string;
}

export interface ImportSuccess {
  ok: true;
  project: ProjectFile;
  /** Structural problems that were repaired rather than rejected. */
  warnings: string[];
  /** Pattern errors. The text still loads into the editor; it just will not play. */
  patternIssues: PatternIssue[];
}

export interface ImportFailure {
  ok: false;
  errors: string[];
}

export type ImportResult = ImportSuccess | ImportFailure;

export function createProject(input: Partial<ProjectFile> & { pattern: string }): ProjectFile {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    instrumentId: 'appliance-latent-space',
    title: input.title ?? 'Untitled',
    pattern: input.pattern,
    controls: { ...(input.controls ?? {}) },
    master: typeof input.master === 'number' ? input.master : 0.5,
    visualIntensity: typeof input.visualIntensity === 'number' ? input.visualIntensity : 0.7,
    reducedMotion: Boolean(input.reducedMotion),
    savedAt: input.savedAt ?? new Date().toISOString(),
  };
}

export function serializeProject(project: ProjectFile): string {
  return `${JSON.stringify(project, null, 2)}\n`;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function importProject(text: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: [`This file is not valid JSON. ${(error as Error).message}`] };
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['A project file must be a JSON object.'] };
  }

  const source = raw as Record<string, unknown>;
  const errors: string[] = [];
  const warnings: string[] = [];

  if (source['format'] !== PROJECT_FORMAT) {
    errors.push(`Not an Appliance Latent Space project (format was "${String(source['format'])}").`);
  }
  const version = source['version'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    errors.push('Missing or invalid version.');
  } else if (version > PROJECT_VERSION) {
    errors.push(`This file was written by a newer version (v${version}); this build reads v${PROJECT_VERSION}.`);
  }
  if (typeof source['pattern'] !== 'string' || !source['pattern'].trim()) {
    errors.push('The file has no pattern text.');
  }
  if (errors.length) return { ok: false, errors };

  const pattern = source['pattern'] as string;
  if (pattern.length > 200_000) {
    return { ok: false, errors: ['That pattern is implausibly large; refusing to load it.'] };
  }

  const controls: Record<string, number> = {};
  const rawControls = source['controls'];
  if (rawControls && typeof rawControls === 'object' && !Array.isArray(rawControls)) {
    Object.entries(rawControls as Record<string, unknown>).forEach(([key, value]) => {
      if (!/^[a-z][a-z0-9_]*$/.test(key)) {
        warnings.push(`Dropped control "${key}": not a valid control id.`);
        return;
      }
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        warnings.push(`Dropped control "${key}": value was not a number.`);
        return;
      }
      controls[key] = Math.min(1, Math.max(0, value));
    });
  } else if (rawControls !== undefined) {
    warnings.push('Ignored "controls": it was not an object.');
  }

  const title = typeof source['title'] === 'string' && source['title'].trim()
    ? (source['title'] as string).trim().slice(0, 120)
    : 'Untitled';
  if (typeof source['title'] === 'string' && (source['title'] as string).length > 120) {
    warnings.push('Title was truncated to 120 characters.');
  }

  const project: ProjectFile = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    instrumentId:
      typeof source['instrumentId'] === 'string' && /^[a-z][a-z0-9-]*$/.test(source['instrumentId'] as string)
        ? (source['instrumentId'] as string)
        : 'appliance-latent-space',
    title,
    pattern,
    controls,
    master: clampNumber(source['master'], 0, 1, 0.5),
    visualIntensity: clampNumber(source['visualIntensity'], 0, 1, 0.7),
    reducedMotion: Boolean(source['reducedMotion']),
    savedAt: typeof source['savedAt'] === 'string' ? (source['savedAt'] as string) : new Date().toISOString(),
  };

  const parsed = parsePattern(project.pattern);
  return {
    ok: true,
    project,
    warnings,
    patternIssues: parsed.ok ? [] : parsed.errors,
  };
}
