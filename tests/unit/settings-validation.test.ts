import { describe, expect, it } from 'vitest';
import { defaultSettings, type Capabilities } from '../../app/shared/contracts';
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
});
