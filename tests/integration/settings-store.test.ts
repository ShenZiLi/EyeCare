import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { SettingsStore } from '../../app/main/settings/settings-store';
import { defaultSettings, resolveSettings, type SettingsV1 } from '../../app/shared/contracts';

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
    expect(await store.save(1, { ...defaultSettings(), schemaVersion: 3 })).toMatchObject({ ok: false });
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
  it('upgrades customized V1 while retaining eight core preferences and exact original backup bytes', async () => {
    const dir = await directory(); const settings = legacy();
    const original = JSON.stringify({ revision: 17, settings }, null, 4) + '\n';
    await writeFile(join(dir, 'settings.json'), original);
    const loaded = await new SettingsStore(dir).load();
    expect(loaded.warnings).toEqual([]); expect(loaded.revision).toBe(17);
    expect(loaded.settings).toEqual({ schemaVersion: 2, timer: { mode: 'fixed', intervalMinutes: 42, longIdleMinutes: 3 }, reminder: { visual: 'mask', soundEnabled: true }, appearance: { theme: 'dark', showTrayCountdown: false }, general: { launchAtLogin: false } });
    expect(await readFile(join(dir, 'settings.v1-backup.json'), 'utf8')).toBe(original);
    const stored = JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8'));
    expect(stored).toEqual({ settings: loaded.settings, revision: 17 });
    expect(resolveSettings(loaded.settings).reminder).toMatchObject({ volumePercent: 50, soundId: 'gentle', screenScope: 'all', message: '该让眼睛休息一下了' });
    const store = new SettingsStore(dir); await store.load(); await store.save(17, defaultSettings());
    expect(await readFile(join(dir, 'settings.v1-backup.json'), 'utf8')).toBe(original);
  });
  it('preserves the first backup on subsequent legacy recovery and upgrades last-good V1', async () => {
    const dir = await directory(); const first = JSON.stringify({ settings: legacy(), revision: 7 });
    await writeFile(join(dir, 'settings.json'), first); await new SettingsStore(dir).load();
    const lastGood = legacy(); lastGood.timer.intervalMinutes = 21;
    await writeFile(join(dir, 'settings.json'), 'broken'); await writeFile(join(dir, 'settings.last-good.json'), JSON.stringify({ settings: lastGood, revision: 8 }));
    const recovered = await new SettingsStore(dir).load();
    expect(recovered.settings.timer.intervalMinutes).toBe(21); expect(recovered.revision).toBe(8); expect(recovered.warnings).toContain('已恢复最后有效设置备份');
    expect(await readFile(join(dir, 'settings.v1-backup.json'), 'utf8')).toBe(first);
    expect((await new SettingsStore(dir).load()).settings.schemaVersion).toBe(2);
  });
  it.each(['save', 'restart'] as const)('preserves original on migration backup failure and retries on %s', async retry => {
    const dir = await directory(); const original = JSON.stringify({ settings: legacy(), revision: 3 });
    await writeFile(join(dir, 'settings.json'), original); await mkdir(join(dir, 'settings.v1-backup.json'));
    const store = new SettingsStore(dir); const loaded = await store.load();
    expect(loaded.settings.schemaVersion).toBe(2); expect(loaded.warnings.some(warning => warning.includes('升级未能写入'))).toBe(true);
    expect(await readFile(join(dir, 'settings.json'), 'utf8')).toBe(original);
    expect(await store.save(3, defaultSettings())).toMatchObject({ ok: false, error: { code: 'SETTINGS_WRITE_FAILED' } });
    expect(await readFile(join(dir, 'settings.json'), 'utf8')).toBe(original);
    await rm(join(dir, 'settings.v1-backup.json'), { recursive: true });
    if (retry === 'save') expect(await store.save(3, defaultSettings())).toMatchObject({ ok: true, value: { revision: 4 } });
    else expect((await new SettingsStore(dir).load()).warnings).toEqual([]);
    expect(await readFile(join(dir, 'settings.v1-backup.json'), 'utf8')).toBe(original);
    expect(JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8')).settings.schemaVersion).toBe(2);
  });
  it('preserves the original when atomic upgrade replacement fails after the backup was published', async () => {
    const dir = await directory(); const original = JSON.stringify({ settings: legacy(), revision: 6 });
    await writeFile(join(dir, 'settings.json'), original); await mkdir(join(dir, 'settings.json.tmp'));
    const store = new SettingsStore(dir); const loaded = await store.load();
    expect(loaded.settings.schemaVersion).toBe(2); expect(loaded.warnings.some(warning => warning.includes('升级未能写入'))).toBe(true);
    expect(await readFile(join(dir, 'settings.json'), 'utf8')).toBe(original);
    expect(await readFile(join(dir, 'settings.v1-backup.json'), 'utf8')).toBe(original);
    await rm(join(dir, 'settings.json.tmp'), { recursive: true });
    expect(await store.save(6, loaded.settings)).toMatchObject({ ok: true, value: { revision: 7 } });
    expect(await readFile(join(dir, 'settings.v1-backup.json'), 'utf8')).toBe(original);
    expect((await new SettingsStore(dir).load()).settings).toEqual(loaded.settings);
  });
  it('strictly rejects malformed legacy customization and unknown envelope fields rather than migrating them', async () => {
    const dir = await directory(); const settings = legacy(); settings.reminder.flashColor = 'javascript:bad';
    await writeFile(join(dir, 'settings.json'), JSON.stringify({ settings, revision: 2 }));
    expect((await new SettingsStore(dir).load()).settings).toEqual(defaultSettings());
    await writeFile(join(dir, 'settings.json'), JSON.stringify({ settings: legacy(), revision: 2, unknown: true }));
    expect((await new SettingsStore(dir).load()).settings).toEqual(defaultSettings());
    await expect(readFile(join(dir, 'settings.v1-backup.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

function legacy(): SettingsV1 {
  return { schemaVersion: 1,
    timer: { mode: 'fixed', intervalMinutes: 42, longIdleMinutes: 3, activeWindowSeconds: 120, activitySource: 'mouse' },
    reminder: { visual: 'mask', soundEnabled: true, soundId: 'bell', volumePercent: 77, flashOpacityPercent: 60, flashColor: '#aabbcc', fadeInMs: 200, holdMs: 1000, fadeOutMs: 300, snoozeMinutes: 2, screenScope: 'selected', screenIds: ['external'], message: 'A customized legacy message' },
    appearance: { theme: 'dark', showTrayCountdown: false, reduceMotion: 'on', reduceTransparency: 'on' }, general: { launchAtLogin: false } };
}
