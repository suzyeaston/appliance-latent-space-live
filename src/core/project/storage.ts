/**
 * Autosave to localStorage.
 *
 * Saving can fail — private windows, a full quota, a browser that refuses storage — and a
 * silent failure here loses work. Every attempt returns its outcome so the UI can show it.
 */

import { createProject, importProject, PROJECT_FORMAT, type ProjectFile } from './project';

export const STORAGE_KEY = 'appliance-latent-space:autosave:v1';

export type SaveOutcome =
  | { ok: true; at: Date }
  | { ok: false; reason: string };

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    const probe = '__als_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

export class ProjectStore {
  private readonly storage: StorageLike | null;

  constructor(storage?: StorageLike | null) {
    this.storage = storage === undefined ? defaultStorage() : storage;
  }

  get available(): boolean {
    return this.storage !== null;
  }

  save(project: ProjectFile): SaveOutcome {
    if (!this.storage) {
      return { ok: false, reason: 'This browser is not allowing local storage, so autosave is off.' };
    }
    const stamped = { ...project, format: PROJECT_FORMAT, savedAt: new Date().toISOString() };
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(stamped));
      return { ok: true, at: new Date(stamped.savedAt) };
    } catch (error) {
      const reason = (error as Error)?.name === 'QuotaExceededError'
        ? 'Local storage is full, so autosave failed. Export the project to keep it.'
        : `Autosave failed: ${(error as Error)?.message ?? 'unknown error'}`;
      return { ok: false, reason };
    }
  }

  load(): ProjectFile | null {
    if (!this.storage) return null;
    let text: string | null = null;
    try {
      text = this.storage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
    if (!text) return null;
    const result = importProject(text);
    if (!result.ok) return null;
    return createProject(result.project);
  }

  clear(): void {
    try {
      this.storage?.removeItem(STORAGE_KEY);
    } catch {
      /* nothing to do */
    }
  }
}
