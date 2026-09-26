import { describe, expect, it } from 'vitest';
import {
  PROJECT_FORMAT,
  PROJECT_VERSION,
  createProject,
  importProject,
  serializeProject,
} from '../../src/core/project/project';
import { ProjectStore, STORAGE_KEY, type StorageLike } from '../../src/core/project/storage';
import { defaultExample } from '../../src/core/pattern/examples';

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

describe('project files', () => {
  it('round trips through export and import unchanged', () => {
    const project = createProject({
      title: 'Cold Start',
      pattern: defaultExample().source,
      controls: { browning: 0.4, memory: 0.6 },
      master: 0.42,
      visualIntensity: 0.3,
      reducedMotion: true,
    });
    const result = importProject(serializeProject(project));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.title).toBe('Cold Start');
    expect(result.project.pattern).toBe(project.pattern);
    expect(result.project.controls).toEqual({ browning: 0.4, memory: 0.6 });
    expect(result.project.master).toBeCloseTo(0.42);
    expect(result.project.reducedMotion).toBe(true);
    expect(result.patternIssues).toHaveLength(0);
  });

  it('refuses things that are not project files', () => {
    expect(importProject('not json').ok).toBe(false);
    expect(importProject('[]').ok).toBe(false);
    expect(importProject('"a string"').ok).toBe(false);
    expect(importProject(JSON.stringify({ format: 'something-else', version: 1, pattern: 'x' })).ok).toBe(false);
    expect(importProject(JSON.stringify({ format: PROJECT_FORMAT, pattern: 'x' })).ok).toBe(false);
    expect(importProject(JSON.stringify({ format: PROJECT_FORMAT, version: 1 })).ok).toBe(false);
  });

  it('refuses a file from a newer version of the app', () => {
    const result = importProject(
      JSON.stringify({ format: PROJECT_FORMAT, version: PROJECT_VERSION + 1, pattern: 'tempo 90' }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain('newer version');
  });

  it('repairs suspect values instead of trusting them', () => {
    const result = importProject(
      JSON.stringify({
        format: PROJECT_FORMAT,
        version: 1,
        title: 'x'.repeat(400),
        pattern: defaultExample().source,
        controls: { browning: 44, 'Bad Key': 0.5, memory: 'loud' },
        master: 99,
        visualIntensity: -4,
        instrumentId: 'Not A Slug',
        somethingUnexpected: { nested: true },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.title).toHaveLength(120);
    expect(result.project.controls['browning']).toBe(1);
    expect(result.project.controls['Bad Key']).toBeUndefined();
    expect(result.project.controls['memory']).toBeUndefined();
    expect(result.project.master).toBe(1);
    expect(result.project.visualIntensity).toBe(0);
    expect(result.project.instrumentId).toBe('appliance-latent-space');
    expect(Object.keys(result.project)).not.toContain('somethingUnexpected');
    expect(result.warnings.length).toBeGreaterThanOrEqual(3);
  });

  it('loads a file whose pattern is broken, and says so', () => {
    const result = importProject(
      JSON.stringify({ format: PROJECT_FORMAT, version: 1, pattern: 'tempo 90\nbars 1\ngrid 4\nvoice a tone\n  play h9 . . .' }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.patternIssues.length).toBeGreaterThan(0);
    expect(result.project.pattern).toContain('h9');
  });

  it('refuses an implausibly large pattern', () => {
    const result = importProject(
      JSON.stringify({ format: PROJECT_FORMAT, version: 1, pattern: 'x'.repeat(200_001) }),
    );
    expect(result.ok).toBe(false);
  });
});

describe('autosave', () => {
  it('saves, reloads and reports the time', () => {
    const storage = memoryStorage();
    const store = new ProjectStore(storage);
    const outcome = store.save(createProject({ pattern: defaultExample().source, title: 'Saved' }));
    expect(outcome.ok).toBe(true);
    expect(storage.data.has(STORAGE_KEY)).toBe(true);
    const loaded = store.load();
    expect(loaded?.title).toBe('Saved');
  });

  it('reports a failure instead of losing it', () => {
    const storage = memoryStorage();
    storage.setItem = () => {
      const error = new Error('full');
      error.name = 'QuotaExceededError';
      throw error;
    };
    const outcome = new ProjectStore(storage).save(createProject({ pattern: 'tempo 90' }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toContain('Local storage is full');
  });

  it('survives a corrupted autosave', () => {
    const storage = memoryStorage();
    storage.setItem(STORAGE_KEY, '{ this is not json');
    expect(new ProjectStore(storage).load()).toBeNull();
  });

  it('works in a browser that refuses storage', () => {
    const store = new ProjectStore(null);
    expect(store.available).toBe(false);
    expect(store.load()).toBeNull();
    const outcome = store.save(createProject({ pattern: 'tempo 90' }));
    expect(outcome.ok).toBe(false);
  });
});
