import { describe, expect, it } from 'vitest';
import { defaultSettings, PRODUCT_DEFAULTS, resolveSettings } from '../../app/shared/contracts';
import { validateSettings } from '../../app/shared/settings-validation';

describe('SettingsV2 strict trust boundary', () => {
  it('accepts and independently clones the eight documented core defaults', () => {
    const settings = defaultSettings(); const result = validateSettings(settings);
    expect(result).toEqual({ ok: true, value: settings });
    expect(settings.schemaVersion).toBe(2);
    expect(Object.keys(settings.timer)).toEqual(['mode', 'intervalMinutes', 'longIdleMinutes']);
    expect(Object.keys(settings.reminder)).toEqual(['visual', 'soundEnabled']);
    expect(Object.keys(settings.appearance)).toEqual(['theme', 'showTrayCountdown']);
    expect(Object.keys(settings.general)).toEqual(['launchAtLogin']);
    if (result.ok) { result.value.timer.intervalMinutes = 1; expect(settings.timer.intervalMinutes).toBe(30); }
  });
  it.each([null, [], {}, { ...defaultSettings(), extra: true }, { ...defaultSettings(), timer: { ...defaultSettings().timer, extra: 1 } }, { ...defaultSettings(), schemaVersion: 1 }, { ...defaultSettings(), schemaVersion: 3 }])('rejects malformed or legacy/future fields at the live boundary: %j', value => { expect(validateSettings(value).ok).toBe(false); });
  it('rejects inherited fields that would disappear during structured cloning', () => {
    const settings = defaultSettings();
    expect(validateSettings(Object.create(settings)).ok).toBe(false);
    expect(validateSettings({ ...settings, timer: Object.create(settings.timer) }).ok).toBe(false);
  });
  it.each(['system', 'light', 'dark', 'handdrawn'] as const)('accepts bundled theme %s and preserves fixed reminder defaults', theme => {
    const settings = defaultSettings(); settings.appearance.theme = theme;
    expect(validateSettings(settings)).toEqual({ ok: true, value: settings });
    const resolved = resolveSettings(settings);
    expect(resolved.appearance.theme).toBe(theme);
    expect(resolved.reminder.flashColor).toBe('#000000');
    expect(resolved.reminder.flashOpacityPercent).toBe(90);
  });
  it.each(['unknown', 'Handdrawn', '', null, 1])('rejects unsupported theme %j', theme => {
    expect(validateSettings({ ...defaultSettings(), appearance: { theme, showTrayCountdown: true } })).toMatchObject({ ok: false, error: { fields: { 'appearance.theme': expect.any(String) } } });
  });
  it('rejects fractional, NaN and overflow values rather than silently coercing', () => {
    for (const intervalMinutes of [0, 241, 1.5, NaN, Infinity, '30']) expect(validateSettings({ ...defaultSettings(), timer: { ...defaultSettings().timer, intervalMinutes } }).ok).toBe(false);
    for (const longIdleMinutes of [0, 121, 1.5, NaN, '10']) expect(validateSettings({ ...defaultSettings(), timer: { ...defaultSettings().timer, longIdleMinutes } }).ok).toBe(false);
  });
  it('requires sound when visual is none while one-minute idle remains valid', () => {
    const settings = defaultSettings(); settings.timer.longIdleMinutes = 1; expect(validateSettings(settings).ok).toBe(true);
    settings.reminder.visual = 'none'; expect(validateSettings(settings)).toMatchObject({ ok: false, error: { code: 'NO_REMINDER_CHANNEL' } });
    settings.reminder.soundEnabled = true; expect(validateSettings(settings).ok).toBe(true);
  });
  it.each([['timer', 'activitySource', 'mouse'], ['timer', 'activeWindowSeconds', 5], ['reminder', 'snoozeMinutes', 5], ['reminder', 'message', 'custom'], ['reminder', 'soundId', 'bell'], ['appearance', 'reduceMotion', 'on']] as const)('rejects removed customization %s.%s', (section, key, value) => {
    const settings = defaultSettings(); expect(validateSettings({ ...settings, [section]: { ...settings[section], [key]: value } }).ok).toBe(false);
  });
  it('resolves fixed defaults into independent creation-time options without persisting them', () => {
    const settings = defaultSettings(); const resolved = resolveSettings(settings);
    expect(resolved.timer).toMatchObject({ activitySource: 'combined', activeWindowSeconds: 60 });
    expect(resolved.reminder).toMatchObject({ soundId: 'gentle', volumePercent: 50, fadeInMs: 600, holdMs: 800, fadeOutMs: 600, flashOpacityPercent: 90, flashColor: '#000000', screenScope: 'all', screenIds: [], message: PRODUCT_DEFAULTS.message });
    expect(resolved.reminder).not.toHaveProperty('snoozeMinutes');
    resolved.reminder.screenIds.push('display'); resolved.timer.intervalMinutes = 1;
    expect(resolveSettings(settings).reminder.screenIds).toEqual([]); expect(settings.timer.intervalMinutes).toBe(30);
    expect(validateSettings(resolved).ok).toBe(false);
  });
});
