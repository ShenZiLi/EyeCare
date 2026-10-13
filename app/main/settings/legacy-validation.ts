import type { Result, SettingsV1 } from '../../shared/contracts';

const shape = {
  timer: ['mode', 'intervalMinutes', 'activitySource', 'activeWindowSeconds', 'longIdleMinutes'],
  reminder: ['visual', 'soundEnabled', 'soundId', 'volumePercent', 'flashOpacityPercent', 'flashColor', 'fadeInMs', 'holdMs', 'fadeOutMs', 'snoozeMinutes', 'screenScope', 'screenIds', 'message'],
  appearance: ['theme', 'showTrayCountdown', 'reduceMotion', 'reduceTransparency'],
  general: ['launchAtLogin'],
};
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Validate the entire persisted/IPC payload, including unknown nested fields. */
export function validateLegacySettings(value: unknown): Result<SettingsV1> {
  const fields: Record<string, string> = {};
  const fail = (code = 'INVALID_SETTINGS', message = '请检查设置中的标记项'): Result<SettingsV1> => ({ ok: false, error: { code, message, fields } });
  if (!object(value)) return fail();
  const expected = ['schemaVersion', ...Object.keys(shape)];
  for (const key of Object.keys(value)) if (!expected.includes(key)) fields[key] = '不支持的设置字段';
  if (!Object.hasOwn(value, 'schemaVersion') || value.schemaVersion !== 1) fields.schemaVersion = '设置版本必须为 1';
  for (const [section, keys] of Object.entries(shape)) {
    if (!Object.hasOwn(value, section) || !object(value[section])) { fields[section] = '设置分组无效'; continue; }
    for (const key of Object.keys(value[section])) if (!keys.includes(key)) fields[`${section}.${key}`] = '不支持的设置字段';
    for (const key of keys) if (!Object.hasOwn(value[section], key)) fields[`${section}.${key}`] = '此项必填';
  }
  if (Object.keys(fields).length) return fail();
  const t = value.timer as Record<string, unknown>;
  const r = value.reminder as Record<string, unknown>;
  const a = value.appearance as Record<string, unknown>;
  const g = value.general as Record<string, unknown>;
  const member = (section: string, key: string, v: unknown, choices: unknown[]) => { if (!choices.includes(v)) fields[`${section}.${key}`] = '请选择有效选项'; };
  const integer = (section: string, key: string, v: unknown, min: number, max: number) => { if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) fields[`${section}.${key}`] = `请输入 ${min}–${max} 范围内的整数`; };
  const boolean = (section: string, key: string, v: unknown) => { if (typeof v !== 'boolean') fields[`${section}.${key}`] = '必须为开关值'; };
  member('timer', 'mode', t.mode, ['active', 'fixed']);
  member('timer', 'activitySource', t.activitySource, ['combined', 'mouse']);
  integer('timer', 'intervalMinutes', t.intervalMinutes, 1, 240);
  integer('timer', 'activeWindowSeconds', t.activeWindowSeconds, 5, 300);
  integer('timer', 'longIdleMinutes', t.longIdleMinutes, 1, 120);
  member('reminder', 'visual', r.visual, ['flash', 'mask', 'notification', 'none']);
  boolean('reminder', 'soundEnabled', r.soundEnabled);
  member('reminder', 'soundId', r.soundId, ['gentle', 'bell']);
  integer('reminder', 'volumePercent', r.volumePercent, 0, 100);
  integer('reminder', 'flashOpacityPercent', r.flashOpacityPercent, 5, 80);
  if (typeof r.flashColor !== 'string' || !/^(theme-derived|#[0-9a-fA-F]{6})$/.test(r.flashColor)) fields['reminder.flashColor'] = '请输入六位十六进制颜色';
  integer('reminder', 'fadeInMs', r.fadeInMs, 100, 5000);
  integer('reminder', 'holdMs', r.holdMs, 0, 10000);
  integer('reminder', 'fadeOutMs', r.fadeOutMs, 100, 5000);
  integer('reminder', 'snoozeMinutes', r.snoozeMinutes, 1, 60);
  member('reminder', 'screenScope', r.screenScope, ['all', 'primary', 'selected']);
  if (!Array.isArray(r.screenIds) || r.screenIds.some(id => typeof id !== 'string' || !id.trim() || id.length > 256) || new Set(r.screenIds).size !== r.screenIds.length) fields['reminder.screenIds'] = '屏幕标识必须有效且不重复';
  if (typeof r.message !== 'string' || !r.message.trim() || r.message.length > 200 || /[\u0000-\u001f\u007f]/.test(r.message)) fields['reminder.message'] = '请输入最多 200 字的单行提醒';
  member('appearance', 'theme', a.theme, ['system', 'light', 'dark']);
  boolean('appearance', 'showTrayCountdown', a.showTrayCountdown);
  member('appearance', 'reduceMotion', a.reduceMotion, ['system', 'on']);
  member('appearance', 'reduceTransparency', a.reduceTransparency, ['system', 'on']);
  boolean('general', 'launchAtLogin', g.launchAtLogin);
  if (Object.keys(fields).length) return fail();
  if ((t.longIdleMinutes as number) * 60 < (t.activeWindowSeconds as number)) { fields['timer.longIdleMinutes'] = '长空闲阈值不能小于活动窗口'; return fail('INVALID_IDLE_WINDOW'); }
  if (r.visual === 'none' && (!r.soundEnabled || r.volumePercent === 0)) { fields['reminder.soundEnabled'] = '至少启用一种有效提醒'; return fail('NO_REMINDER_CHANNEL'); }
  if (r.screenScope === 'selected' && !(r.screenIds as string[]).length) { fields['reminder.screenIds'] = '旧屏幕选择无效'; return fail('INVALID_SCREEN_SELECTION'); }
  const settings = structuredClone(value) as unknown as SettingsV1;
  settings.reminder.message = settings.reminder.message.trim();
  return { ok: true, value: settings };
}
