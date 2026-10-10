import { describe, expect, it } from 'vitest';
import { defaultSettings, type Capabilities, type DisplayInfo } from '../../app/shared/contracts';
import { validateSettings } from '../../app/main/settings/validation';

describe('SettingsV1 strict trust boundary', () => {
  it('accepts and clones the complete documented defaults', () => {
    const settings = defaultSettings(); const result = validateSettings(settings);
    expect(result).toEqual({ ok: true, value: settings });
    if (result.ok) { result.value.timer.intervalMinutes = 1; expect(settings.timer.intervalMinutes).toBe(30); }
  });
  it.each([null, [], {}, { ...defaultSettings(), extra: true }, { ...defaultSettings(), timer: { ...defaultSettings().timer, extra: 1 } }, { ...defaultSettings(), schemaVersion: 2 }])('rejects malformed or future/unknown fields: %j', payload => { expect(validateSettings(payload).ok).toBe(false); });
  it('rejects fractional, NaN and overflow values rather than silently coercing', () => {
    for (const intervalMinutes of [0, 241, 1.5, NaN, Infinity, '30']) expect(validateSettings({ ...defaultSettings(), timer: { ...defaultSettings().timer, intervalMinutes } }).ok).toBe(false);
  });
  it('validates idle-window relation, usable channels and selection as explicit product errors', () => {
    const s = defaultSettings(); s.timer.longIdleMinutes = 1; s.timer.activeWindowSeconds = 61;
    expect(validateSettings(s)).toMatchObject({ ok: false, error: { code: 'INVALID_IDLE_WINDOW' } });
    s.timer.activeWindowSeconds = 60; s.reminder.visual = 'none';
    expect(validateSettings(s)).toMatchObject({ ok: false, error: { code: 'NO_REMINDER_CHANNEL' } });
    s.reminder.soundEnabled = true; s.reminder.volumePercent = 0;
    expect(validateSettings(s).ok).toBe(false);
    s.reminder.volumePercent = 1; s.reminder.screenScope = 'selected';
    expect(validateSettings(s)).toMatchObject({ ok: false, error: { code: 'INVALID_SCREEN_SELECTION' } });
  });
  it('does not enable mouse-only when source capability is unknown', () => {
    const s = defaultSettings(); s.timer.activitySource = 'mouse';
    const caps = { mouse: { state: 'unknown', reason: 'source cannot be confirmed' } } as Capabilities;
    expect(validateSettings(s, caps)).toMatchObject({ ok: false, error: { code: 'CAPABILITY_UNAVAILABLE' } });
  });
  it('rejects duplicate screen identifiers and executable colour strings', () => {
    const s = defaultSettings(); s.reminder.screenIds = ['a', 'a'];
    expect(validateSettings(s).ok).toBe(false);
    s.reminder.screenIds = []; s.reminder.flashColor = 'url(javascript:alert(1))';
    expect(validateSettings(s).ok).toBe(false);
  });
  it('retains saved mouse intent for unrelated updates without allowing a newly unavailable source', () => {
    const previous = defaultSettings(); previous.timer.activitySource = 'mouse';
    const caps = { mouse: { state: 'error', reason: 'disconnected' } } as Capabilities;
    const next = structuredClone(previous); next.appearance.theme = 'dark'; next.appearance.showTrayCountdown = false;
    expect(validateSettings(next, caps, undefined, previous).ok).toBe(true);
    expect(validateSettings(next, caps, undefined, defaultSettings()).ok).toBe(false);
    const fixed = structuredClone(previous); fixed.timer.mode = 'fixed';
    expect(validateSettings(next, caps, undefined, fixed).ok).toBe(false);
    expect(validateSettings(fixed, caps, undefined, previous).ok).toBe(true);
  });
  it('retains saved unplugged screen intent but rejects empty or new unavailable selections', () => {
    const previous = defaultSettings(); previous.reminder.screenScope = 'selected'; previous.reminder.screenIds = ['unplugged'];
    const next = structuredClone(previous); next.appearance.theme = 'dark';
    expect(validateSettings(next, undefined, [], previous).ok).toBe(true);
    expect(validateSettings(next, undefined, [], defaultSettings()).ok).toBe(false);
    next.reminder.screenIds = []; expect(validateSettings(next, undefined, [], previous).ok).toBe(false);
    next.reminder.screenIds = ['other']; expect(validateSettings(next, undefined, [], previous).ok).toBe(false);
    next.reminder.screenIds = ['primary', 'new-missing'];
    expect(validateSettings(next, undefined, [{ id: 'primary' }] as DisplayInfo[], previous).ok).toBe(false);
  });
});
