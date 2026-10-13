import { describe, expect, it, vi } from 'vitest';
import { TimerEngine } from '../../app/main/engine/timer-engine';
import { defaultSettings, type Capabilities, type PlatformSample, type SettingsV2 } from '../../app/shared/contracts';

const caps = Object.fromEntries(['input', 'mouse', 'lock', 'overlay', 'notification', 'tray', 'launchAtLogin'].map(key => [key, { state: 'available', reason: '' }])) as unknown as Capabilities;
const display = { id: 'primary', label: 'Primary', primary: true, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 };
function sample(sequence: number, nowMs: number, changes: Partial<PlatformSample> = {}): PlatformSample { return { sequence, nowMs, clockTrusted: true, combinedIdleMs: 0, selectedSourceIdleMs: 0, lockState: 'unlocked', sleeping: false, displays: [display], capabilities: caps, systemTheme: 'light', reduceMotion: false, reduceTransparency: false, ...changes }; }
function harness(settings = defaultSettings()) {
  const engine = new TimerEngine(settings);
  let seq = 0, now = 0;
  engine.acceptSample(sample(seq++, now));
  return { engine, advance(ms: number, changes: Partial<PlatformSample> = {}) { now += ms; return engine.acceptSample(sample(seq++, now, changes)); }, run(seconds: number, changes: Partial<PlatformSample> = {}) { let result = engine.getSnapshot(); for (let i = 0; i < seconds; i++) result = this.advance(1000, changes).snapshot; return result; }, get now() { return now; } };
}
const minuteSettings = (mode: 'active' | 'fixed' = 'active'): SettingsV2 => { const s = defaultSettings(); s.timer.intervalMinutes = 1; s.timer.mode = mode; return s; };

describe('TimerEngine activity and temporal boundaries', () => {
  it('defaults to documented conservative startup with no effects until capability observations', () => {
    const engine = new TimerEngine();
    expect(engine.getSnapshot().settings).toEqual(defaultSettings());
    expect(engine.remindNow().effects).toEqual([]);
    expect(engine.getSnapshot().status).toBe('starting');
  });
  it('a restarted engine restores only preferences and begins a full new cycle', () => {
    const s = minuteSettings(); const original = harness(s); original.run(50);
    const restarted = new TimerEngine(s, 7);
    const result = restarted.acceptSample(sample(1, 1_000_000));
    expect(result.snapshot.settingsRevision).toBe(7);
    expect(result.snapshot.elapsedActiveMs).toBe(0);
    expect(result.snapshot.remainingMs).toBe(60_000);
    expect(result.effects).toEqual([]);
  });
  it('integrates fractional intersection at the fixed 60-second activity boundary', () => {
    const h = harness();
    for (let idle = 4000; idle <= 56_000; idle += 4000) h.advance(4000, { combinedIdleMs: idle });
    h.advance(4000, { combinedIdleMs: 60_000 });
    const result = h.advance(4000, { combinedIdleMs: 64_000 });
    expect(result.snapshot.elapsedActiveMs).toBe(60_000);
    expect(result.snapshot.status).toBe('short_idle');
  });
  it('credits the union when new input lands inside a sampling interval', () => {
    const h = harness();
    for (let idle = 5000; idle <= 60_000; idle += 5000) h.advance(5000, { combinedIdleMs: idle });
    h.advance(4000, { combinedIdleMs: 64_000 });
    const result = h.advance(4000, { combinedIdleMs: 1000 });
    expect(result.snapshot.elapsedActiveMs).toBe(61_000);
  });
  it('produces exactly one reminder at the active threshold and ignores duplicate observations', () => {
    const h = harness(minuteSettings());
    expect(h.run(59).currentReminderId).toBeNull();
    const due = h.advance(1000);
    expect(due.effects.filter(e => e.type === 'present')).toHaveLength(1);
    expect(h.engine.acceptSample(sample(60, 60_000)).effects).toEqual([]);
    expect(h.advance(1000).effects).toEqual([]);
    expect(h.engine.getSnapshot().elapsedActiveMs).toBe(60_000);
  });
  it('ignores missing intervals over five seconds and uses monotonic time despite wall-clock NTP jumps', () => {
    const h = harness(minuteSettings());
    vi.spyOn(Date, 'now').mockReturnValue(9_000_000_000_000);
    expect(h.advance(1000).snapshot.elapsedActiveMs).toBe(1000);
    expect(h.advance(5001).snapshot.elapsedActiveMs).toBe(1000);
    vi.mocked(Date.now).mockReturnValue(0);
    expect(h.advance(1000).snapshot.elapsedActiveMs).toBe(2000);
    expect(h.engine.acceptSample(sample(100, 0)).snapshot.elapsedActiveMs).toBe(2000);
    vi.restoreAllMocks();
  });
  it('clears 25 minutes of progress at the ten-minute long-idle threshold even while manually paused', () => {
    const h = harness();
    expect(h.run(25 * 60).elapsedActiveMs).toBe(25 * 60_000);
    h.engine.pause(null);
    for (let idle = 1000; idle <= 599_000; idle += 1000) h.advance(1000, { combinedIdleMs: idle, selectedSourceIdleMs: idle });
    expect(h.engine.getSnapshot().elapsedActiveMs).toBe(25 * 60_000);
    expect(h.advance(1000, { combinedIdleMs: 600_000, selectedSourceIdleMs: 600_000 }).snapshot.elapsedActiveMs).toBe(0);
    h.engine.resume(); h.advance(1000);
    expect(h.run(29 * 60).currentReminderId).toBeNull();
  });
  it('uses either keyboard or mouse through combined input regardless of source-specific age', () => {
    const h = harness();
    for (let i = 1; i <= 120; i++) h.advance(1000, { combinedIdleMs: 0, selectedSourceIdleMs: i * 1000 });
    expect(h.engine.getSnapshot().elapsedActiveMs).toBe(120_000);
    expect(h.engine.getSnapshot().status).toBe('counting');
  });
  it('fixed mode triggers during short idle, skips suppressed beats and does not replay missed periods', () => {
    const h = harness(minuteSettings('fixed'));
    const due = h.advance(60_000, { combinedIdleMs: 70_000, selectedSourceIdleMs: 70_000 });
    expect(due.effects).toEqual([]); // unobserved minute cannot dispatch a historical beat
    expect(due.snapshot.remainingMs).toBe(60_000);
    h.run(59, { combinedIdleMs: 70_000, selectedSourceIdleMs: 70_000 });
    const live = h.advance(1000, { combinedIdleMs: 70_000, selectedSourceIdleMs: 70_000 });
    expect(live.effects[0]?.type).toBe('present');
  });
  it('fixed mode advances to the next future beat after multiple locked periods', () => {
    const h = harness(minuteSettings('fixed'));
    h.advance(1000, { lockState: 'locked' });
    h.advance(179_000, { lockState: 'locked' });
    const restored = h.advance(1000);
    expect(restored.effects).toEqual([]);
    expect(restored.snapshot.remainingMs).toBe(59_000);
    expect(h.run(58).currentReminderId).toBeNull();
    expect(h.advance(1000).effects[0]?.type).toBe('present');
  });
  it.each([{ lockState: 'locked' as const }, { combinedIdleMs: 600_000 }])('fixed recovery exactly on a suppressed beat skips it and keeps the next future phase: %j', changes => {
    const h = harness(minuteSettings('fixed'));
    h.run(59, changes);
    const recovered = h.advance(1000);
    expect(recovered.effects).toEqual([]);
    expect(recovered.snapshot.remainingMs).toBe(60_000);
    h.run(59);
    expect(h.advance(1000).effects[0]?.type).toBe('present');
  });
  it('short lock preserves progress, long sleep clears it, neither contributes activity', () => {
    const h = harness(); h.run(20);
    h.advance(1000, { lockState: 'locked' }); h.advance(4000, { lockState: 'locked' });
    expect(h.advance(1000).snapshot.elapsedActiveMs).toBe(20_000);
    h.advance(1000, { sleeping: true }); h.advance(600_000, { sleeping: true });
    expect(h.advance(1000).snapshot.elapsedActiveMs).toBe(0);
  });
  it('measures lock absence from the actual first locked observation and checks the final duration on recovery', () => {
    const h = harness(); h.run(20);
    h.advance(4000, { lockState: 'locked' });
    h.advance(599_000, { lockState: 'locked' });
    expect(h.engine.getSnapshot().elapsedActiveMs).toBe(20_000);
    const recovered = h.advance(1000);
    expect(recovered.snapshot.elapsedActiveMs).toBe(0);
    expect(recovered.effects).toEqual([]);
  });
  it('untrusted clock clears unknown absence immediately, suppresses effects and retains no fallback interval on recovery', () => {
    const h = harness(); h.run(20);
    h.advance(1000, { sleeping: true });
    const fault = h.advance(1000, { clockTrusted: false });
    expect(fault.snapshot.elapsedActiveMs).toBe(0);
    expect(fault.snapshot.status).toBe('capability_error');
    expect(fault.snapshot.warnings.some(warning => warning.includes('保守清零'))).toBe(true);
    expect(h.engine.remindNow().effects).toEqual([]);
    expect(h.advance(1000).snapshot.elapsedActiveMs).toBe(0);
    expect(h.advance(1000).snapshot.elapsedActiveMs).toBe(1000);
  });
  it('timed pause resumes only at its deadline and contributes only the observed portion after expiry', () => {
    const h = harness(); h.run(10); h.engine.pause(15);
    h.advance(899_000);
    expect(h.engine.getSnapshot().status).toBe('paused');
    expect(h.advance(2000).snapshot.elapsedActiveMs).toBe(11_000);
    expect(h.engine.getSnapshot().status).toBe('counting');
  });
  it('lowering the long-idle threshold applies the new value immediately while paused', () => {
    const h = harness(); h.run(10); h.engine.pause(null);
    h.advance(1000, { combinedIdleMs: 120_000, selectedSourceIdleMs: 120_000 });
    expect(h.engine.getSnapshot().elapsedActiveMs).toBe(10_000);
    const s = defaultSettings(); s.timer.longIdleMinutes = 2;
    expect(h.engine.updateSettings(s, 1).snapshot.elapsedActiveMs).toBe(0);
    expect(h.engine.getSnapshot().status).toBe('paused');
  });
});

describe('TimerEngine unique lifecycle and shared suppression', () => {
  it.each(['flash', 'mask', 'notification', 'none'] as const)('all timer modes and %s channels share pause, lock and long-idle eligibility', visual => {
    for (const mode of ['active', 'fixed'] as const) {
      const s = minuteSettings(mode); s.reminder.visual = visual; s.reminder.soundEnabled = true;
      const h = harness(s);
      h.engine.pause(null); expect(h.engine.remindNow().effects).toEqual([]); h.engine.resume();
      h.advance(1000, { lockState: 'locked' }); expect(h.engine.remindNow().effects).toEqual([]);
      h.advance(1000, { combinedIdleMs: 600_000 }); expect(h.engine.remindNow().effects).toEqual([]);
    }
  });
  it.each(['active', 'fixed'] as const)('fail-closes unknown lock and invalid input in %s mode', mode => {
    const h = harness(minuteSettings(mode));
    h.advance(1000, { lockState: 'unknown' });
    expect(h.engine.remindNow().effects).toEqual([]);
    expect(h.engine.getSnapshot().status).toBe('capability_error');
    h.advance(1000, { combinedIdleMs: null });
    expect(h.engine.remindNow().effects).toEqual([]);
  });
  it('real mask acknowledgement confirms once; stale multi-screen messages cannot reset the next cycle', () => {
    const s = minuteSettings(); s.reminder.visual = 'mask';
    const h = harness(s);
    const event = h.engine.remindNow().effects.find(e => e.type === 'present');
    if (event?.type !== 'present') throw new Error('missing reminder');
    h.engine.recordReminderChannels(event.reminder.id, event.reminder.generation, [{ channel: 'visual', success: true, message: 'displayed' }]);
    expect(h.engine.resolveReminder(event.reminder.id, event.reminder.generation + 1, 'acknowledge').effects).toEqual([]);
    expect(h.engine.resolveReminder(event.reminder.id, event.reminder.generation, 'acknowledge').effects.filter(e => e.type === 'rest_confirmed')).toHaveLength(1);
    h.run(10);
    expect(h.engine.resolveReminder(event.reminder.id, event.reminder.generation, 'acknowledge').effects).toEqual([]);
    expect(h.engine.getSnapshot().elapsedActiveMs).toBe(10_000);
    expect(h.engine.getSnapshot().restConfirmedCount).toBe(1);
    expect(h.engine.getSnapshot().latestReminderResult?.channels[0]?.success).toBe(true);
  });
  it.each(['acknowledge', 'skip'] as const)('%s starts a full normal cycle and never reschedules the previous reminder', action => {
    const s = minuteSettings(); s.reminder.visual = 'mask';
    const h = harness(s); h.run(30);
    const event = h.engine.remindNow().effects[0]; if (event.type !== 'present') throw new Error();
    const resolved = h.engine.resolveReminder(event.reminder.id, event.reminder.generation, action);
    expect(resolved.snapshot.elapsedActiveMs).toBe(0);
    expect(resolved.snapshot.remainingMs).toBe(60_000);
    expect(resolved.snapshot.restConfirmedCount).toBe(action === 'acknowledge' ? 1 : 0);
    expect(h.run(59).currentReminderId).toBeNull();
    const next = h.advance(1000).effects[0]; if (next.type !== 'present') throw new Error();
    expect(next.reminder.id).not.toBe(event.reminder.id);
    expect(h.engine.resolveReminder(event.reminder.id, event.reminder.generation, action).effects).toEqual([]);
  });
  it('new mask diagnostics publish one sequence and show partial failures while keeping the mask interactive', () => {
    const s = minuteSettings(); s.reminder.visual = 'mask'; s.reminder.soundEnabled = true;
    const h = harness(s);
    const event = h.engine.remindNow().effects[0]; if (event.type !== 'present') throw new Error();
    const before = h.engine.getSnapshot().sequence;
    const channels = [{ channel: 'visual' as const, success: true, message: 'shown' }, { channel: 'sound' as const, success: false, message: 'audio device unavailable' }];
    const recorded = h.engine.recordReminderChannels(event.reminder.id, event.reminder.generation, channels);
    expect(recorded.snapshot.sequence).toBe(before + 1);
    expect(recorded.snapshot.currentReminderId).toBe(event.reminder.id);
    expect(recorded.snapshot.warnings).toContain('声音提醒失败：audio device unavailable');
    expect(h.engine.recordReminderChannels(event.reminder.id, event.reminder.generation, channels).snapshot.sequence).toBe(before + 1);
    expect(h.engine.resolveReminder(event.reminder.id, event.reminder.generation, 'acknowledge').snapshot.latestReminderResult?.channels).toEqual(channels);
  });
  it.each([{ lockState: 'locked' as const }, { sleeping: true }, { combinedIdleMs: 600_000 }, { lockState: 'unknown' as const }])('cancels a live reminder under suppression %j and never revives its generation', changes => {
    const h = harness(minuteSettings());
    const event = h.engine.remindNow().effects[0]; if (event.type !== 'present') throw new Error();
    expect(h.advance(1000, changes).effects[0]?.type).toBe('cancel');
    expect(h.advance(1000).effects).toEqual([]);
    expect(h.engine.settleReminder(event.reminder.id, event.reminder.generation, [{ channel: 'visual', success: true, message: '' }]).effects).toEqual([]);
    expect(h.engine.getSnapshot().restConfirmedCount).toBe(0);
  });
  it('all channels failing settles one cycle without retry; automatic flash never confirms rest', () => {
    const h = harness(minuteSettings());
    const event = h.engine.remindNow().effects[0]; if (event.type !== 'present') throw new Error();
    expect(h.engine.settleReminder(event.reminder.id, event.reminder.generation, [{ channel: 'visual', success: false, message: 'window unavailable' }]).snapshot.latestReminderResult?.outcome).toBe('failed');
    expect(h.advance(1000).effects).toEqual([]);
    expect(h.engine.getSnapshot().restConfirmedCount).toBe(0);
    const flash = h.engine.remindNow().effects[0]; if (flash.type !== 'present') throw new Error();
    h.advance(2000);
    const settled = h.engine.settleReminder(flash.reminder.id, flash.reminder.generation, [{ channel: 'visual', success: true, message: '' }]);
    expect(settled.snapshot.latestReminderResult?.outcome).toBe('automatic');
    expect(settled.snapshot.elapsedActiveMs).toBe(0);
    expect(settled.snapshot.restConfirmedCount).toBe(0);
  });
  it.each(['notification', 'none'] as const)('%s submission cannot acknowledge a rest and records partial channel failure once', visual => {
    const s = minuteSettings(); s.reminder.visual = visual; s.reminder.soundEnabled = true;
    const h = harness(s); const event = h.engine.remindNow().effects[0]; if (event.type !== 'present') throw new Error();
    expect(h.engine.resolveReminder(event.reminder.id, event.reminder.generation, 'acknowledge').effects).toEqual([]);
    const results = [{ channel: 'visual' as const, success: visual === 'notification', message: '' }, { channel: 'sound' as const, success: visual === 'none', message: 'sound result' }];
    expect(h.engine.settleReminder(event.reminder.id, event.reminder.generation, results).snapshot.latestReminderResult).toMatchObject({ outcome: 'automatic', channels: results });
    expect(h.engine.getSnapshot().warnings.some(warning => warning.includes('提醒失败'))).toBe(true);
    h.run(10);
    expect(h.engine.settleReminder(event.reminder.id, event.reminder.generation, results).effects).toEqual([]);
    expect(h.engine.getSnapshot().elapsedActiveMs).toBe(10_000);
    expect(h.engine.getSnapshot().restConfirmedCount).toBe(0);
  });
  it('theme applies immediately without changing progress and timer changes await immutable live reminder completion', () => {
    const s = minuteSettings(); s.reminder.visual = 'mask';
    const h = harness(s); h.run(20);
    const appearance = structuredClone(s); appearance.appearance.theme = 'dark'; appearance.appearance.showTrayCountdown = false;
    expect(h.engine.updateSettings(appearance, 1).snapshot.elapsedActiveMs).toBe(20_000);
    const event = h.engine.remindNow().effects[0]; if (event.type !== 'present') throw new Error();
    const next = structuredClone(appearance); next.timer.intervalMinutes = 2; next.reminder.visual = 'flash';
    expect(h.engine.updateSettings(next, 2).snapshot.currentReminderId).toBe(event.reminder.id);
    expect(h.engine.getSnapshot().statusReason).toContain('下一周期');
    expect(event.reminder.settings.reminder.visual).toBe('mask');
    expect(h.engine.resolveReminder(event.reminder.id, event.reminder.generation, 'skip').snapshot.remainingMs).toBe(120_000);
  });
  it('system theme reacts immediately, manual override persists and switching back does not reset progress', () => {
    const h = harness(); h.run(10);
    expect(h.advance(1000, { systemTheme: 'dark' }).snapshot.theme).toBe('dark');
    const s = defaultSettings(); s.appearance.theme = 'light';
    const manual = h.engine.updateSettings(s, 1);
    expect(manual.snapshot.theme).toBe('light'); expect(manual.snapshot.elapsedActiveMs).toBe(11_000);
    expect(manual.snapshot.reduceMotion).toBe(false);
    expect(h.advance(0, { reduceMotion: true, reduceTransparency: true }).snapshot).toMatchObject({ reduceMotion: true, reduceTransparency: true });
    expect(h.advance(1000, { systemTheme: 'dark' }).snapshot.theme).toBe('light');
    s.appearance.theme = 'system';
    expect(h.engine.updateSettings(s, 2).snapshot.theme).toBe('dark');
    expect(h.engine.getSnapshot().elapsedActiveMs).toBe(12_000);
  });
});
