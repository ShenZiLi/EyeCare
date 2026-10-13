import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsEditor } from '../../app/renderer/settings-editor';
import { TimerEngine } from '../../app/main/engine/timer-engine';
import type { Capabilities, Result, RuntimeSnapshot, SettingsV1 } from '../../app/shared/contracts';

const caps = Object.fromEntries(['input', 'mouse', 'lock', 'overlay', 'notification', 'tray', 'launchAtLogin'].map(key => [key, { state: 'available', reason: '' }])) as unknown as Capabilities;
function initial() { return { ...new TimerEngine().getSnapshot(), capabilities: caps, displays: [{ id: '1', label: 'Primary', primary: true, bounds: { x: 0, y: 0, width: 800, height: 600 }, scaleFactor: 1 }] }; }
function fixture() {
  let effective = initial();
  const persist = vi.fn(async (revision: number, settings: SettingsV1): Promise<Result<RuntimeSnapshot>> => {
    if (revision !== effective.settingsRevision) return { ok: false, error: { code: 'SETTINGS_CONFLICT', message: 'conflict', currentRevision: effective.settingsRevision } };
    effective = { ...effective, settings: structuredClone(settings), settingsRevision: revision + 1, sequence: effective.sequence + 1 };
    return { ok: true, value: effective };
  });
  const editor = new SettingsEditor(persist, vi.fn()); editor.accept(effective);
  const edit = (change: (settings: SettingsV1) => void, auto = true, immediate = true) => { const draft = editor.state().draft!; change(draft); editor.edit(draft, auto, immediate); };
  return { editor, persist, edit, get effective() { return effective; }, external(change: (settings: SettingsV1) => void) { const settings = structuredClone(effective.settings); change(settings); effective = { ...effective, settings, settingsRevision: effective.settingsRevision + 1, sequence: effective.sequence + 1 }; return effective; } };
}
afterEach(() => vi.useRealTimers());
describe('SettingsEditor serialized field intents', () => {
  it('keeps the complete Chinese text when a saved prefix and runtime snapshots arrive during typing', async () => {
    vi.useFakeTimers(); const f = fixture();
    let release!: (value: Result<RuntimeSnapshot>) => void;
    f.persist.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    f.edit(s => { s.reminder.message = '请看看'; }, true, false);
    await vi.advanceTimersByTimeAsync(300);
    f.edit(s => { s.reminder.message = '请看看远'; }, true, false);
    await vi.advanceTimersByTimeAsync(100);
    f.edit(s => { s.reminder.message = '请看看远处'; }, true, false);
    const prefix = { ...f.effective, settings: { ...f.effective.settings, reminder: { ...f.effective.settings.reminder, message: '请看看' } }, settingsRevision: 1, sequence: 1 };
    f.persist.mockImplementation(async (revision, settings) => ({ ok: true, value: { ...prefix, settings, settingsRevision: revision + 1, sequence: 3 } }));
    f.editor.accept({ ...prefix, sequence: 2 });
    release({ ok: true, value: prefix });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.editor.state().draft!.reminder.message).toBe('请看看远处');
    await vi.advanceTimersByTimeAsync(300);
    expect(f.persist.mock.calls[1][1].reminder.message).toBe('请看看远处');
    expect(f.editor.state().draft!.reminder.message).toBe('请看看远处');
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
    f.edit(s => { s.timer.intervalMinutes = NaN; }, true, false);
    await vi.advanceTimersByTimeAsync(100);
    f.edit(s => { s.timer.intervalMinutes = 45; }, true, false);
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
  it('recovers coupled invalid channel and screen choices when the next edit completes them', async () => {
    const f = fixture(); f.edit(s => { s.reminder.visual = 'none'; });
    expect(f.persist).not.toHaveBeenCalled(); expect(f.editor.state().fields['reminder.visual']).toBeTruthy();
    f.edit(s => { s.reminder.soundEnabled = true; });
    await vi.waitFor(() => expect(f.effective.settings.reminder.visual).toBe('none'));
    f.edit(s => { s.reminder.visual = 'mask'; s.reminder.screenScope = 'selected'; });
    await vi.waitFor(() => expect(f.effective.settings.reminder.visual).toBe('mask'));
    expect(f.effective.settings.reminder.screenScope).toBe('all');
    f.edit(s => { s.reminder.screenIds = ['1']; });
    await vi.waitFor(() => expect(f.effective.settings.reminder.screenScope).toBe('selected'));
    expect(f.effective.settings.reminder.screenIds).toEqual(['1']);
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
  it('manual general drafts remain separate while appearance commits and repeated choices do not write', async () => {
    const f = fixture(); f.edit(s => { s.appearance.reduceTransparency = 'on'; }, false);
    expect(f.persist).not.toHaveBeenCalled();
    f.edit(s => { s.appearance.theme = 'dark'; });
    await vi.waitFor(() => expect(f.effective.settings.appearance.theme).toBe('dark'));
    expect(f.effective.settings.appearance.reduceTransparency).toBe('system'); expect(f.editor.state().manualDirty).toBe(true);
    const calls = f.persist.mock.calls.length; f.edit(s => { s.appearance.theme = 'dark'; }); expect(f.persist).toHaveBeenCalledTimes(calls);
    f.editor.saveManual(); await vi.waitFor(() => expect(f.editor.state().unsaved).toBe(false));
    expect(f.effective.settings.appearance.reduceTransparency).toBe('on');
  });
  it('retrying an automatic failure leaves a separate manual general draft unapplied', async () => {
    const f = fixture();
    f.edit(s => { s.appearance.reduceTransparency = 'on'; }, false);
    f.persist.mockRejectedValueOnce(new Error('connection lost'));
    f.edit(s => { s.reminder.visual = 'mask'; });
    await vi.waitFor(() => expect(f.editor.state().failure).not.toBeNull());
    expect(f.editor.state().failureIsManual).toBe(false);
    f.editor.retry();
    await vi.waitFor(() => expect(f.effective.settings.reminder.visual).toBe('mask'));
    expect(f.effective.settings.appearance.reduceTransparency).toBe('system');
    expect(f.editor.state().manualDirty).toBe(true);
  });
  it('retries a failed manual save without dropping its manual fields', async () => {
    const f = fixture(); f.edit(s => { s.appearance.reduceMotion = 'on'; }, false);
    f.persist.mockResolvedValueOnce({ ok: false, error: { code: 'SETTINGS_WRITE_FAILED', message: 'failed' } });
    f.editor.saveManual(); await vi.waitFor(() => expect(f.editor.state().failure).not.toBeNull());
    f.editor.retry(); await vi.waitFor(() => expect(f.editor.state().manualDirty).toBe(false));
    expect(f.effective.settings.appearance.reduceMotion).toBe('on');
  });
});
