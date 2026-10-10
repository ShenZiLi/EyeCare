import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultSettings, type Capabilities, type DisplayInfo, type Result, type SettingsV1 } from '../../shared/contracts';
import { validateSettings } from './validation';

export interface LoadedSettings { settings: SettingsV1; revision: number; warnings: string[] }
interface Stored { settings: SettingsV1; revision: number }

/** Single serialized writer; effective state changes only after atomic replacement succeeds. */
export class SettingsStore {
  private current: Stored = { settings: defaultSettings(), revision: 0 };
  private queue: Promise<unknown> = Promise.resolve();
  private readonly path: string;
  private readonly backup: string;
  constructor(private readonly directory: string) {
    this.path = join(directory, 'settings.json');
    this.backup = join(directory, 'settings.last-good.json');
  }
  private async read(path: string): Promise<Stored> {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (!value || typeof value !== 'object' || !('revision' in value) || !('settings' in value)) throw new Error('Invalid settings envelope');
    const envelope = value as { revision: unknown; settings: unknown };
    const parsed = validateSettings(envelope.settings);
    if (!parsed.ok || !Number.isSafeInteger(envelope.revision) || (envelope.revision as number) < 0) throw new Error('Invalid settings');
    return { settings: parsed.value, revision: envelope.revision as number };
  }
  async load(): Promise<LoadedSettings> {
    const warnings: string[] = [];
    try { this.current = await this.read(this.path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') warnings.push('设置文件损坏，已尝试恢复最后有效备份');
      try { this.current = await this.read(this.backup); warnings.push('已恢复最后有效设置备份'); }
      catch { this.current = { settings: defaultSettings(), revision: 0 }; if (warnings.length) warnings.push('备份不可用，已恢复默认设置'); }
    }
    return { ...structuredClone(this.current), warnings };
  }
  private async atomic(path: string, value: Stored): Promise<void> {
    const temporary = `${path}.tmp`;
    const handle = await open(temporary, 'w', 0o600);
    try { await handle.writeFile(JSON.stringify(value, null, 2), 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    try { await rename(temporary, path); }
    catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
  }
  save(expectedRevision: number, value: unknown, capabilities?: Capabilities, displays?: DisplayInfo[]): Promise<Result<Stored>> {
    const run = async (): Promise<Result<Stored>> => {
      if (expectedRevision !== this.current.revision) return { ok: false, error: { code: 'SETTINGS_CONFLICT', message: '设置已在其他窗口更新，请重新检查后保存', currentRevision: this.current.revision } };
      const parsed = validateSettings(value, capabilities, displays);
      if (!parsed.ok) return parsed;
      const next = { settings: parsed.value, revision: this.current.revision + 1 };
      try {
        await mkdir(this.directory, { recursive: true });
        await this.atomic(this.backup, this.current);
        await this.atomic(this.path, next);
        this.current = next;
        return { ok: true, value: structuredClone(next) };
      } catch { return { ok: false, error: { code: 'SETTINGS_WRITE_FAILED', message: '无法保存设置，当前有效设置已保留' } }; }
    };
    const result = this.queue.then(run, run);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
}
