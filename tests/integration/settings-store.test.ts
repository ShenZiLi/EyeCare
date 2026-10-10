import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { SettingsStore } from '../../app/main/settings/settings-store';
import { defaultSettings } from '../../app/shared/contracts';

const directories: string[] = [];
async function directory() { const path = await mkdtemp(join(tmpdir(), 'eyecare-settings-')); directories.push(path); return path; }
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
describe('SettingsStore real filesystem persistence', () => {
  it('atomically saves settings, persists revisions, and does not persist runtime counters', async () => {
    const dir = await directory(); const store = new SettingsStore(dir);
    expect((await store.load()).settings).toEqual(defaultSettings());
    const s = defaultSettings(); s.appearance.theme = 'dark';
    expect(await store.save(0, s)).toMatchObject({ ok: true, value: { revision: 1 } });
    const loaded = await new SettingsStore(dir).load();
    expect(loaded.settings.appearance.theme).toBe('dark');
    expect(loaded.revision).toBe(1);
    expect(Object.keys(JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8')))).toEqual(['settings', 'revision']);
  });
  it('serializes simultaneous saves so exactly one expected revision succeeds', async () => {
    const store = new SettingsStore(await directory()); await store.load();
    const results = await Promise.all([store.save(0, defaultSettings()), store.save(0, defaultSettings())]);
    expect(results.filter(r => r.ok)).toHaveLength(1);
    expect(results[1]).toMatchObject({ ok: false, error: { code: 'SETTINGS_CONFLICT', currentRevision: 1 } });
  });
  it('never writes malformed settings or changes the effective revision on validation failure', async () => {
    const dir = await directory(); const store = new SettingsStore(dir); await store.load();
    await store.save(0, defaultSettings());
    const before = await readFile(join(dir, 'settings.json'), 'utf8');
    expect(await store.save(1, { ...defaultSettings(), schemaVersion: 2 })).toMatchObject({ ok: false });
    expect(await readFile(join(dir, 'settings.json'), 'utf8')).toBe(before);
    expect(await store.save(1, defaultSettings())).toMatchObject({ ok: true, value: { revision: 2 } });
  });
  it('recovers the last good settings from a corrupt primary and defaults when both copies fail', async () => {
    const dir = await directory(); const store = new SettingsStore(dir); await store.load();
    const first = defaultSettings(); first.appearance.theme = 'dark'; await store.save(0, first);
    const second = defaultSettings(); second.timer.intervalMinutes = 12; await store.save(1, second);
    await writeFile(join(dir, 'settings.json'), '{ broken');
    const recovered = await new SettingsStore(dir).load();
    expect(recovered.settings.appearance.theme).toBe('dark'); expect(recovered.revision).toBe(1); expect(recovered.warnings.length).toBeGreaterThan(0);
    await writeFile(join(dir, 'settings.last-good.json'), 'bad');
    const reset = await new SettingsStore(dir).load();
    expect(reset.settings).toEqual(defaultSettings()); expect(reset.warnings.length).toBeGreaterThan(0);
  });
  it('retains effective state after an actual write failure and allows the same revision to retry', async () => {
    const dir = await directory(); const path = join(dir, 'not-a-directory'); await writeFile(path, 'file');
    const store = new SettingsStore(path); await store.load();
    expect(await store.save(0, defaultSettings())).toMatchObject({ ok: false, error: { code: 'SETTINGS_WRITE_FAILED' } });
    expect(await store.save(0, defaultSettings())).toMatchObject({ ok: false, error: { code: 'SETTINGS_WRITE_FAILED' } });
  });
});
