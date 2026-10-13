import { link, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultSettings, type Result, type SettingsV1, type SettingsV2 } from '../../shared/contracts';
import { validateSettings } from './validation';
import { validateLegacySettings } from './legacy-validation';

export interface LoadedSettings { settings: SettingsV2; revision: number; warnings: string[] }
interface Stored { settings: SettingsV2; revision: number }
interface ReadSettings { stored: Stored; legacyBytes: Buffer | null }
function migrate(settings: SettingsV1): SettingsV2 {
  return { schemaVersion: 2,
    timer: { mode: settings.timer.mode, intervalMinutes: settings.timer.intervalMinutes, longIdleMinutes: settings.timer.longIdleMinutes },
    reminder: { visual: settings.reminder.visual, soundEnabled: settings.reminder.soundEnabled },
    appearance: { theme: settings.appearance.theme, showTrayCountdown: settings.appearance.showTrayCountdown },
    general: { launchAtLogin: settings.general.launchAtLogin } };
}
/** Single serialized writer; failed migration preserves its source and remains retryable. */
export class SettingsStore {
  private current: Stored = { settings: defaultSettings(), revision: 0 };
  private queue: Promise<unknown> = Promise.resolve();
  private readonly path: string;
  private readonly backup: string;
  private readonly legacyBackup: string;
  private pendingLegacy: Buffer | null = null;
  constructor(private readonly directory: string) {
    this.path = join(directory, 'settings.json'); this.backup = join(directory, 'settings.last-good.json');
    this.legacyBackup = join(directory, 'settings.v1-backup.json');
  }
  private async read(path: string): Promise<ReadSettings> {
    const bytes = await readFile(path);
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['revision', 'settings'].includes(key)) || !('revision' in value) || !('settings' in value)) throw new Error('Invalid settings envelope');
    const envelope = value as { revision: unknown; settings: unknown };
    if (!Number.isSafeInteger(envelope.revision) || (envelope.revision as number) < 0) throw new Error('Invalid revision');
    const legacy = !!envelope.settings && typeof envelope.settings === 'object' && 'schemaVersion' in envelope.settings && envelope.settings.schemaVersion === 1;
    if (legacy) {
      const parsed = validateLegacySettings(envelope.settings);
      if (!parsed.ok) throw new Error('Invalid legacy settings');
      return { stored: { settings: migrate(parsed.value), revision: envelope.revision as number }, legacyBytes: bytes };
    }
    const parsed = validateSettings(envelope.settings);
    if (!parsed.ok) throw new Error('Invalid settings');
    return { stored: { settings: parsed.value, revision: envelope.revision as number }, legacyBytes: null };
  }
  private async preserveLegacy(): Promise<void> {
    if (this.pendingLegacy === null) return;
    // Publish a complete synced backup without ever replacing the first copy.
    const temporary = `${this.legacyBackup}.tmp`;
    try {
      const handle = await open(temporary, 'w', 0o600);
      try { await handle.writeFile(this.pendingLegacy); await handle.sync(); }
      finally { await handle.close(); }
      try { await link(temporary, this.legacyBackup); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const existing = await this.read(this.legacyBackup);
        if (existing.legacyBytes === null) throw new Error('Original legacy backup is invalid');
      }
    } finally { await unlink(temporary).catch(() => undefined); }
  }

  async load(): Promise<LoadedSettings> {
    const warnings: string[] = [];
    let loaded: ReadSettings | null = null;
    try { loaded = await this.read(this.path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') warnings.push('设置文件损坏，已尝试恢复最后有效备份');
      try { loaded = await this.read(this.backup); warnings.push('已恢复最后有效设置备份'); }
      catch { if (warnings.length) warnings.push('备份不可用，已恢复默认设置'); }
    }
    this.current = loaded?.stored ?? { settings: defaultSettings(), revision: 0 };
    this.pendingLegacy = loaded?.legacyBytes ?? null;
    if (this.pendingLegacy !== null) {
      try {
        await this.preserveLegacy(); await this.atomic(this.path, this.current); this.pendingLegacy = null;
      } catch { warnings.push('设置升级未能写入，原文件已保留；当前使用简化设置，下次保存或启动将重试'); }
    }
    return { ...structuredClone(this.current), warnings };
  }
  private async atomic(path: string, value: Stored): Promise<void> {
    const temporary = `${path}.tmp`;
    try {
      const handle = await open(temporary, 'w', 0o600);
      try { await handle.writeFile(JSON.stringify(value, null, 2), 'utf8'); await handle.sync(); }
      finally { await handle.close(); }
      await rename(temporary, path);
    } catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
  }
  save(expectedRevision: number, value: unknown): Promise<Result<Stored>> {
    const run = async (): Promise<Result<Stored>> => {
      if (expectedRevision !== this.current.revision) return { ok: false, error: { code: 'SETTINGS_CONFLICT', message: '设置已在其他窗口更新，请重新检查后保存', currentRevision: this.current.revision } };
      const parsed = validateSettings(value); if (!parsed.ok) return parsed;
      const next = { settings: parsed.value, revision: this.current.revision + 1 };
      try {
        await mkdir(this.directory, { recursive: true }); await this.preserveLegacy();
        await this.atomic(this.backup, this.current); await this.atomic(this.path, next);
        this.current = next; this.pendingLegacy = null;
        return { ok: true, value: structuredClone(next) };
      } catch { return { ok: false, error: { code: 'SETTINGS_WRITE_FAILED', message: '无法保存设置，当前有效设置已保留' } }; }
    };
    const result = this.queue.then(run, run); this.queue = result.then(() => undefined, () => undefined); return result;
  }
}
