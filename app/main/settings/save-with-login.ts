import type { Result, SettingsV2 } from '../../shared/contracts';
import type { SettingsStore } from './settings-store';
import type { LoginChange } from '../platform/autostart';

/** The serialized main command calls this only after validation and revision checks. */
export async function saveWithLogin(store: Pick<SettingsStore, 'save'>, expectedRevision: number, settings: SettingsV2, oldLogin: boolean, prepareLogin: (enabled: boolean) => Promise<LoginChange>): Promise<Result<{ settings: SettingsV2; revision: number }>> {
  const newLogin = settings.general.launchAtLogin;
  const changed = oldLogin !== newLogin;
  let change: LoginChange | undefined;
  const rollback = async (result: Result<{ settings: SettingsV2; revision: number }>) => {
    if (!change) return result;
    try { await change.rollback(); return result; }
    catch { return { ok: false, error: { code: 'LOGIN_ROLLBACK_FAILED', message: '设置未生效，且系统登录启动项未能恢复，请检查系统登录项后重试' } } as const; }
  };
  if (changed) {
    try { change = await prepareLogin(newLogin); }
    catch { return { ok: false, error: { code: 'LOGIN_READ_FAILED', message: '无法读取当前系统登录启动项，设置未生效，请检查系统登录项后重试' } }; }
    try { await change.apply(); }
    catch (error) { return rollback({ ok: false, error: { code: 'LOGIN_WRITE_FAILED', message: error instanceof Error ? error.message : '系统未保存登录启动设置' } }); }
  }
  try {
    const result = await store.save(expectedRevision, settings);
    return result.ok ? result : rollback(result);
  } catch {
    return rollback({ ok: false, error: { code: 'SETTINGS_WRITE_FAILED', message: '无法保存设置，当前有效设置已保留' } });
  }
}
