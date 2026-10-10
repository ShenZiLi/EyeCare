import { execFile } from 'node:child_process';
import type { LockState } from './native';

export type CommandRunner = (file: string, args: string[]) => Promise<string>;
export const runCommand: CommandRunner = (file, args) => new Promise((resolve, reject) => {
  execFile(file, args, { timeout: 650, maxBuffer: 4096, windowsHide: true, env: { ...process.env, LC_ALL: 'C' } }, (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
});

export class LinuxLockReader {
  private state: LockState = 'unknown';
  private at = -Infinity;
  private pending: Promise<void> | null = null;
  private stopped = false;
  private generation = 0;
  reason = '正在确认当前会话和桌面锁屏服务';
  constructor(private readonly now: () => number, private readonly changed: () => void, private readonly run: CommandRunner = runCommand) {}
  read(): LockState { return this.now() - this.at <= 1500 ? this.state : 'unknown'; }
  invalidate(): void { this.generation++; this.state = 'unknown'; this.at = -Infinity; }
  refresh(): Promise<void> {
    if (this.pending) return this.pending;
    const generation = this.generation;
    this.pending = this.query().then(result => {
      if (this.stopped || generation !== this.generation) return;
      const previous = this.read();
      this.state = result.state;
      this.reason = result.reason;
      this.at = this.now();
      if (previous !== this.state) this.changed();
    }).finally(() => { this.pending = null; });
    return this.pending;
  }
  private async query(): Promise<{ state: LockState; reason: string }> {
    try {
      const session = await this.run('busctl', ['--system', '--timeout=1', 'call', 'org.freedesktop.login1', '/org/freedesktop/login1', 'org.freedesktop.login1.Manager', 'GetSessionByPID', 'u', String(process.pid)]);
      const path = /^o "(\/org\/freedesktop\/login1\/session\/[A-Za-z0-9_]+)"$/.exec(session)?.[1];
      if (!path) throw new Error('无法解析当前进程所属登录会话');
      const property = (name: string) => this.run('busctl', ['--system', '--timeout=1', 'get-property', 'org.freedesktop.login1', path, 'org.freedesktop.login1.Session', name]);
      const [active, hint, desktop] = await Promise.all([property('Active'), property('LockedHint'), this.desktopState()]);
      if (active === 'b false') return { state: 'locked', reason: '当前会话未激活' };
      if (active !== 'b true' || !['b true', 'b false'].includes(hint) || desktop === null) return { state: 'unknown', reason: '当前会话或桌面锁屏状态无法双重确认' };
      // A disagreement never authorizes effects. The login hint alone is not proof.
      if (hint === 'b true' && desktop) return { state: 'locked', reason: 'logind 与桌面服务均确认锁屏' };
      if (hint === 'b false' && !desktop) return { state: 'unlocked', reason: 'logind 与桌面服务均确认解锁' };
      return { state: 'unknown', reason: 'logind 与桌面锁屏服务状态不一致' };
    } catch { return { state: 'unknown', reason: '登录会话或桌面 D-Bus 服务不可用；提醒已暂停' }; }
  }
  private async desktopState(): Promise<boolean | null> {
    for (const [service, path, method] of [
      ['org.gnome.ScreenSaver', '/org/gnome/ScreenSaver', 'org.gnome.ScreenSaver.GetActive'],
      ['org.freedesktop.ScreenSaver', '/ScreenSaver', 'org.freedesktop.ScreenSaver.GetActive'],
    ]) {
      try {
        const result = await this.run('gdbus', ['call', '--session', '--dest', service, '--object-path', path, '--method', method]);
        if (/^\(true,?\)$/.test(result)) return true;
        if (/^\(false,?\)$/.test(result)) return false;
      } catch { /* Try the next known desktop interface, never arbitrary commands. */ }
    }
    return null;
  }
  dispose(): void { this.stopped = true; this.invalidate(); }
}
