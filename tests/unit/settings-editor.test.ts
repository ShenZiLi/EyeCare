import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsEditor } from '../../app/renderer/settings-editor';
import { TimerEngine } from '../../app/main/engine/timer-engine';
import type { Capabilities, Result, RuntimeSnapshot, SettingsV2 } from '../../app/shared/contracts';

const caps = Object.fromEntries(['input', 'mouse', 'lock', 'overlay', 'notification', 'tray', 'launchAtLogin'].map(key => [key, { state: 'available', reason: '' }])) as unknown as Capabilities;
function initial() { return { ...new TimerEngine().getSnapshot(), capabilities: caps, displays: [{ id: '1', label: 'Primary', primary: true, bounds: { x: 0, y: 0, width: 800, height: 600 }, scaleFactor: 1 }] }; }
function fixture() {
  let effective = initial();
  const persist = vi.fn(async (revision: number, settings: SettingsV2): Promise<Result<RuntimeSnapshot>> => {
    if (revision !== effective.settingsRevision) return { ok: false, error: { code: 'SETTINGS_CONFLICT', message: 'conflict', currentRevision: effective.settingsRevision } };
    effective = { ...effective, settings: structuredClone(settings), settingsRevision: revision + 1, sequence: effective.sequence + 1 };
    return { ok: true, value: effective };
  });
  const editor = new SettingsEditor(persist, vi.fn()); editor.accept(effective);
  const edit = (change: (settings: SettingsV2) => void, immediate = true) => { const draft = editor.state().draft!; change(draft); editor.edit(draft, immediate); };
  return { editor, persist, edit, get effective() { return effective; }, external(change: (settings: SettingsV2) => void) { const settings = structuredClone(effective.settings); change(settings); effective = { ...effective, settings, settingsRevision: effective.settingsRevision + 1, sequence: effective.sequence + 1 }; return effective; } };
}
afterEach(() => vi.useRealTimers());
describe('SettingsEditor serialized field intents', () => {
  it('keeps the latest numeric burst when an older save and snapshots arrive during input', async () => {
    vi.useFakeTimers(); const f = fixture();
    let release!: (value: Result<RuntimeSnapshot>) => void;
    f.persist.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    f.edit(s => { s.timer.intervalMinutes = 31; }, false);
    await vi.advanceTimersByTimeAsync(300);
    f.edit(s => { s.timer.intervalMinutes = 32; }, false);
    await vi.advanceTimersByTimeAsync(100);
    f.edit(s => { s.timer.intervalMinutes = 33; }, false);
    const prefix = { ...f.effective, settings: { ...f.effective.settings, timer: { ...f.effective.settings.timer, intervalMinutes: 31 } }, settingsRevision: 1, sequence: 1 };
    f.persist.mockImplementation(async (revision, settings) => ({ ok: true, value: { ...prefix, settings, settingsRevision: revision + 1, sequence: 3 } }));
    f.editor.accept({ ...prefix, sequence: 2 });
    release({ ok: true, value: prefix });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.editor.state().draft!.timer.intervalMinutes).toBe(33);
    await vi.advanceTimersByTimeAsync(300);
    expect(f.persist.mock.calls[1][1].timer.intervalMinutes).toBe(33);
    expect(f.editor.state().unsaved).toBe(false);
  });
  it('preserves a quick reversion to the effective timer value while the old edit is in flight', async () => {
    const f = fixture(); let release!: (value: Result<RuntimeSnapshot>) => void;
    f.persist.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    f.edit(s => { s.timer.intervalMinutes = 31; });
    f.edit(s => { s.timer.intervalMinutes = 30; });
    const first = { ...f.effective, settings: { ...f.effective.settings, timer: { ...f.effective.settings.timer, intervalMinutes: 31 } }, settingsRevision: 1, sequence: 1 };
    f.persist.mockImplementation(async (revision, settings) => ({ ok: true, value: { ...first, settings, settingsRevision: revision + 1, sequence: 2 } }));
    release({ ok: true, value: first });
    await vi.waitFor(() => expect(f.editor.state().unsaved).toBe(false));
    expect(f.persist.mock.calls[1][1].timer.intervalMinutes).toBe(30);
    expect(f.editor.state().draft!.timer.intervalMinutes).toBe(30);
    f.edit(s => { s.timer.intervalMinutes = 30; });
    expect(f.persist).toHaveBeenCalledTimes(2);
  });
  it('serializes rapid edits and keeps newer input when an older save finishes', async () => {
    const f = fixture(); let release!: (value: Result<RuntimeSnapshot>) => void;
    f.persist.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    f.edit(s => { s.timer.intervalMinutes = 31; });
    f.edit(s => { s.timer.intervalMinutes = 32; s.reminder.soundEnabled = true; });
    const first = { ...f.effective, settings: { ...f.effective.settings, timer: { ...f.effective.settings.timer, intervalMinutes: 31 } }, settingsRevision: 1, sequence: 1 };
    f.persist.mockImplementation(async (revision, settings) => ({ ok: true, value: { ...first, settings, settingsRevision: revision + 1, sequence: 2 } }));
    release({ ok: true, value: first });
    await vi.waitFor(() => expect(f.editor.state().unsaved).toBe(false));
    expect(f.persist).toHaveBeenCalledTimes(2);
    expect(f.persist.mock.calls[1][0]).toBe(1);
    expect(f.persist.mock.calls[1][1].timer.intervalMinutes).toBe(32);
    expect(f.persist.mock.calls[1][1].reminder.soundEnabled).toBe(true);
    expect(f.editor.state().draft!.timer.intervalMinutes).toBe(32);
  });
  it('debounces numeric bursts and blur flushes without saving an empty intermediate', async () => {
    vi.useFakeTimers(); const f = fixture();
    f.edit(s => { s.timer.intervalMinutes = NaN; }, false);
    await vi.advanceTimersByTimeAsync(100);
    f.edit(s => { s.timer.intervalMinutes = 45; }, false);
    await vi.advanceTimersByTimeAsync(299); expect(f.persist).not.toHaveBeenCalled();
    f.editor.flush(); await vi.advanceTimersByTimeAsync(0);
    expect(f.effective.settings.timer.intervalMinutes).toBe(45); expect(f.persist).toHaveBeenCalledTimes(1);
  });
  it('preserves invalid input across snapshots without blocking another field or section', async () => {
    const f = fixture(); f.edit(s => { s.timer.intervalMinutes = 0; });
    expect(f.editor.state().fields['timer.intervalMinutes']).toBeTruthy();
    f.edit(s => { s.reminder.visual = 'mask'; });
    await vi.waitFor(() => expect(f.effective.settings.reminder.visual).toBe('mask'));
    expect(f.effective.settings.timer.intervalMinutes).toBe(30);
    f.editor.accept(f.external(s => { s.appearance.theme = 'dark'; }));
    expect(f.editor.state().draft!.timer.intervalMinutes).toBe(0);
    expect(f.editor.state().draft!.appearance.theme).toBe('dark');
    f.edit(s => { s.timer.intervalMinutes = 40; });
    await vi.waitFor(() => expect(f.editor.state().unsaved).toBe(false));
    expect(f.effective.settings.timer.intervalMinutes).toBe(40);
  });
  it('saves only-sound choices atomically and blocks a missing channel', async () => {
    const f = fixture(); f.edit(s => { s.reminder.visual = 'none'; s.reminder.soundEnabled = true; });
    await vi.waitFor(() => expect(f.effective.settings.reminder.visual).toBe('none'));
    expect(f.persist).toHaveBeenCalledTimes(1);
    expect(f.persist.mock.calls[0][1].reminder).toEqual({ visual: 'none', soundEnabled: true });
    f.edit(s => { s.reminder.soundEnabled = false; });
    expect(f.editor.state().fields['reminder.soundEnabled']).toBeTruthy();
    expect(f.effective.settings.reminder.soundEnabled).toBe(true);
    f.edit(s => { s.reminder.visual = 'mask'; });
    await vi.waitFor(() => expect(f.editor.state().unsaved).toBe(false));
    expect(f.effective.settings.reminder).toEqual({ visual: 'mask', soundEnabled: false });
  });
  it('retains a failed save with retry enabled and merges into fresh external settings', async () => {
    const f = fixture(); f.persist.mockResolvedValueOnce({ ok: false, error: { code: 'SETTINGS_WRITE_FAILED', message: 'write failed' } });
    f.edit(s => { s.reminder.visual = 'mask'; });
    await vi.waitFor(() => expect(f.editor.state().failure?.code).toBe('SETTINGS_WRITE_FAILED'));
    expect(f.editor.state().pending).toBe(false); expect(f.editor.state().draft!.reminder.visual).toBe('mask');
    f.editor.accept(f.external(s => { s.timer.intervalMinutes = 55; })); f.editor.retry();
    await vi.waitFor(() => expect(f.editor.state().unsaved).toBe(false));
    expect(f.effective.settings.timer.intervalMinutes).toBe(55); expect(f.effective.settings.reminder.visual).toBe('mask');
  });
  it('requires explicit reapply after conflict and never writes other fields from an old draft', async () => {
    const f = fixture(); const external = f.external(s => { s.timer.intervalMinutes = 50; });
    f.edit(s => { s.reminder.soundEnabled = true; });
    await vi.waitFor(() => expect(f.editor.state().failure?.code).toBe('SETTINGS_CONFLICT'));
    f.editor.accept(external); f.editor.retry();
    await vi.waitFor(() => expect(f.editor.state().unsaved).toBe(false));
    expect(f.effective.settings.timer.intervalMinutes).toBe(50); expect(f.effective.settings.reminder.soundEnabled).toBe(true);
  });
  it('all General choices save immediately and repeated choices do not write', async () => {
    const f = fixture(); f.edit(s => { s.appearance.theme = 'dark'; s.appearance.showTrayCountdown = false; s.general.launchAtLogin = true; });
    await vi.waitFor(() => expect(f.editor.state().unsaved).toBe(false));
    expect(f.effective.settings.appearance).toEqual({ theme: 'dark', showTrayCountdown: false });
    expect(f.effective.settings.general.launchAtLogin).toBe(true);
    const calls = f.persist.mock.calls.length; f.edit(s => { s.appearance.theme = 'dark'; }); expect(f.persist).toHaveBeenCalledTimes(calls);
  });
  it('retains startup failure for retry while the effective setting stays unchanged', async () => {
    const f = fixture();
    f.persist.mockResolvedValueOnce({ ok: false, error: { code: 'AUTOSTART_FAILED', message: 'system refused' } });
    f.edit(s => { s.general.launchAtLogin = true; });
    await vi.waitFor(() => expect(f.editor.state().failure).not.toBeNull());
    expect(f.effective.settings.general.launchAtLogin).toBe(false);
    expect(f.editor.state().draft!.general.launchAtLogin).toBe(true);
    f.editor.retry(); await vi.waitFor(() => expect(f.editor.state().unsaved).toBe(false));
    expect(f.effective.settings.general.launchAtLogin).toBe(true);
  });
  it('restores defaults over invalid and failed intents without a manual save', async () => {
    const f = fixture(); f.edit(s => { s.timer.intervalMinutes = 0; });
    f.persist.mockRejectedValueOnce(new Error('connection lost'));
    f.edit(s => { s.reminder.visual = 'mask'; });
    await vi.waitFor(() => expect(f.editor.state().failure).not.toBeNull());
    f.editor.edit(initial().settings, true); f.editor.retry();
    await vi.waitFor(() => expect(f.editor.state().unsaved).toBe(false));
    expect(f.effective.settings).toEqual(initial().settings);
    expect(f.editor.state().fields).toEqual({});
  });
});
