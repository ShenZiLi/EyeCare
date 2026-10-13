import type { Result, SettingsV2 } from './contracts';

const shape = { timer: ['mode', 'intervalMinutes', 'longIdleMinutes'], reminder: ['visual', 'soundEnabled'], appearance: ['theme', 'showTrayCountdown'], general: ['launchAtLogin'] };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
/** Node-free validator shared by autosave and the trusted persistence boundary. */
export function validateSettings(value: unknown): Result<SettingsV2> {
  const fields: Record<string, string> = {};
  const fail = (code = 'INVALID_SETTINGS'): Result<SettingsV2> => ({ ok: false, error: { code, message: '请检查设置中的标记项', fields } });
  if (!object(value)) return fail();
  for (const key of Object.keys(value)) if (!['schemaVersion', ...Object.keys(shape)].includes(key)) fields[key] = '不支持的设置字段';
  if (!Object.hasOwn(value, 'schemaVersion') || value.schemaVersion !== 2) fields.schemaVersion = '设置版本必须为 2';
  for (const [section, keys] of Object.entries(shape)) {
    const group = value[section];
    if (!Object.hasOwn(value, section) || !object(group)) { fields[section] = '设置分组无效'; continue; }
    for (const key of Object.keys(group)) if (!keys.includes(key)) fields[`${section}.${key}`] = '不支持的设置字段';
    for (const key of keys) if (!Object.hasOwn(group, key)) fields[`${section}.${key}`] = '此项必填';
  }
  if (Object.keys(fields).length) return fail();
  const timer = value.timer as Record<string, unknown>, reminder = value.reminder as Record<string, unknown>, appearance = value.appearance as Record<string, unknown>, general = value.general as Record<string, unknown>;
  const member = (path: string, candidate: unknown, choices: unknown[]) => { if (!choices.includes(candidate)) fields[path] = '请选择有效选项'; };
  const integer = (path: string, candidate: unknown, max: number) => { if (typeof candidate !== 'number' || !Number.isInteger(candidate) || candidate < 1 || candidate > max) fields[path] = `请输入 1–${max} 范围内的整数`; };
  const boolean = (path: string, candidate: unknown) => { if (typeof candidate !== 'boolean') fields[path] = '必须为开关值'; };
  member('timer.mode', timer.mode, ['active', 'fixed']); integer('timer.intervalMinutes', timer.intervalMinutes, 240); integer('timer.longIdleMinutes', timer.longIdleMinutes, 120);
  member('reminder.visual', reminder.visual, ['flash', 'mask', 'notification', 'none']); boolean('reminder.soundEnabled', reminder.soundEnabled);
  member('appearance.theme', appearance.theme, ['system', 'light', 'dark']); boolean('appearance.showTrayCountdown', appearance.showTrayCountdown); boolean('general.launchAtLogin', general.launchAtLogin);
  if (Object.keys(fields).length) return fail();
  if (reminder.visual === 'none' && !reminder.soundEnabled) { fields['reminder.soundEnabled'] = '至少启用一种提醒方式'; return fail('NO_REMINDER_CHANNEL'); }
  return { ok: true, value: structuredClone(value) as unknown as SettingsV2 };
}
