import { describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../../app/shared/contracts';
import { TimerEngine } from '../../app/main/engine/timer-engine';
import { saveWithLogin } from '../../app/main/settings/save-with-login';

describe('immediate General save uses an actual OS state transaction', () => {
  it('does not mutate or persist when the actual OS snapshot is unavailable', async () => {
    const settings = defaultSettings(); settings.general.launchAtLogin = true;
    const save = vi.fn(), prepare = vi.fn().mockRejectedValue(new Error('read denied'));
    expect(await saveWithLogin({ save }, 0, settings, false, prepare)).toMatchObject({ ok: false, error: { code: 'LOGIN_READ_FAILED' } });
    expect(save).not.toHaveBeenCalled();
  });
  it('does not persist when OS rejects startup, and restores captured actual state', async () => {
    const engine = new TimerEngine(); const settings = defaultSettings(); settings.general.launchAtLogin = true;
    const save = vi.fn(), apply = vi.fn().mockRejectedValue(new Error('OS rejected')), rollback = vi.fn().mockResolvedValue(undefined);
    const prepare = vi.fn(async () => ({ apply, rollback }));
    expect(await saveWithLogin({ save }, 0, settings, false, prepare)).toMatchObject({ ok: false, error: { code: 'LOGIN_WRITE_FAILED', message: 'OS rejected' } });
    expect(save).not.toHaveBeenCalled(); expect(rollback).toHaveBeenCalledTimes(1);
    expect(engine.getSnapshot()).toMatchObject({ settingsRevision: 0, settings: { general: { launchAtLogin: false } } });
  });
  it('restores actual disabled OS state when saved preference says enabled and disk fails', async () => {
    let actual = false;
    const settings = defaultSettings();
    const save = vi.fn().mockResolvedValue({ ok: false, error: { code: 'SETTINGS_WRITE_FAILED', message: 'disk full' } });
    const prepare = vi.fn(async (enabled: boolean) => {
      const captured = actual;
      return { apply: async () => { actual = enabled; }, rollback: async () => { actual = captured; } };
    });
    expect(await saveWithLogin({ save }, 0, settings, true, prepare)).toMatchObject({ ok: false, error: { code: 'SETTINGS_WRITE_FAILED' } });
    expect(actual).toBe(false);
  });
  it('rolls back on disk failure and the same revision can retry successfully', async () => {
    const settings = defaultSettings(); settings.general.launchAtLogin = true;
    const save = vi.fn().mockResolvedValueOnce({ ok: false, error: { code: 'SETTINGS_WRITE_FAILED', message: 'disk full' } }).mockResolvedValueOnce({ ok: true, value: { settings, revision: 1 } });
    const apply = vi.fn().mockResolvedValue(undefined), rollback = vi.fn().mockResolvedValue(undefined), prepare = vi.fn(async () => ({ apply, rollback }));
    expect(await saveWithLogin({ save }, 0, settings, false, prepare)).toMatchObject({ ok: false, error: { code: 'SETTINGS_WRITE_FAILED' } });
    expect(rollback).toHaveBeenCalledTimes(1);
    const retry = await saveWithLogin({ save }, 0, settings, false, prepare); expect(retry.ok).toBe(true);
    const engine = new TimerEngine(); if (retry.ok) engine.updateSettings(retry.value.settings, retry.value.revision);
    expect(engine.getSnapshot()).toMatchObject({ settingsRevision: 1, settings: { general: { launchAtLogin: true } } });
    expect(apply).toHaveBeenCalledTimes(2); expect(rollback).toHaveBeenCalledTimes(1);
  });
  it('reports failed rollback instead of claiming restoration', async () => {
    const settings = defaultSettings(); settings.general.launchAtLogin = true;
    const save = vi.fn().mockResolvedValue({ ok: false, error: { code: 'SETTINGS_WRITE_FAILED', message: 'disk full' } });
    const prepare = vi.fn(async () => ({ apply: async () => undefined, rollback: async () => { throw new Error('rollback refused'); } }));
    expect(await saveWithLogin({ save }, 0, settings, false, prepare)).toMatchObject({ ok: false, error: { code: 'LOGIN_ROLLBACK_FAILED' } });
  });
  it('does not inspect or change OS registration for unrelated saves', async () => {
    const settings = defaultSettings(); settings.appearance.theme = 'dark'; settings.appearance.showTrayCountdown = false;
    const save = vi.fn().mockResolvedValue({ ok: true, value: { settings, revision: 1 } }), prepare = vi.fn();
    expect((await saveWithLogin({ save }, 0, settings, false, prepare)).ok).toBe(true); expect(prepare).not.toHaveBeenCalled();
  });
});
