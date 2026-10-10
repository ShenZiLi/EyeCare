import { app } from 'electron';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const loginName = 'org.eyecare.desktop';
const currentContext = (): AutostartContext => ({ platform: process.platform, executable: process.execPath, env: process.env });
const execute = promisify(execFile);

interface AutostartContext {
  platform: NodeJS.Platform;
  executable: string;
  env: NodeJS.ProcessEnv;
}

export function autostartExecutable(context: AutostartContext, exists: (file: string) => boolean = existsSync): string {
  const { platform, executable, env } = context;
  if (platform === 'win32') {
    const folder = path.win32.dirname(executable);
    const root = path.win32.dirname(folder);
    if (/^app-\d/.test(path.win32.basename(folder)) && exists(path.win32.join(root, 'Update.exe'))) {
      const launcher = path.win32.join(root, path.win32.basename(executable));
      if (!exists(launcher)) throw new Error('登录启动入口缺失，请重新安装 EyeCare');
      return launcher;
    }
  }
  if (platform === 'linux' && env.APPIMAGE) {
    if (!path.posix.isAbsolute(env.APPIMAGE) || /[\x00-\x1f\x7f]/.test(env.APPIMAGE) || !exists(env.APPIMAGE)) throw new Error('AppImage 登录启动路径无效');
    return env.APPIMAGE;
  }
  if (platform === 'linux' && env.APPDIR) throw new Error('无法确认 AppImage 的持久路径，未创建自动启动项');
  return executable;
}

export function autostartDesktopEntry(executable: string): string {
  if (/[\x00-\x1f\x7f]/.test(executable)) throw new Error('自动启动路径无效');
  // Desktop entries unescape the value before parsing Exec quoting.
  const quoted = executable.replace(/\\/g, '\\\\\\\\').replace(/["`$]/g, character => `\\\\${character}`).replace(/%/g, '%%');
  return `[Desktop Entry]\nType=Application\nVersion=1.0\nName=EyeCare\nComment=Eye care reminders\nExec="${quoted}"\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`;
}

async function readWindowsLoginCommand(): Promise<string | null> {
  // Read one owned value. UTF-8 JSON preserves non-ASCII installation paths.
  const script = "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $entry = Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -ErrorAction Stop; $value = $entry.PSObject.Properties['org.eyecare.desktop']; if ($null -ne $value) { ConvertTo-Json -InputObject $value.Value -Compress }";
  const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 3000, maxBuffer: 8192, encoding: 'utf8' });
  if (!stdout.trim()) return null;
  const command: unknown = JSON.parse(stdout);
  if (typeof command !== 'string') throw new Error('登录启动项格式无效');
  return command;
}

export async function migrateWindowsLaunchAtLogin(context: AutostartContext = currentContext(), readCommand = readWindowsLoginCommand, exists: (file: string) => boolean = existsSync): Promise<void> {
  if (context.platform !== 'win32') return;
  const launcher = autostartExecutable(context, exists);
  if (launcher === context.executable) return;
  const command = await readCommand();
  const legacy = command?.match(/^"([^"\r\n]+)"\s*$/)?.[1] ?? (command && /^[^\s"]+\.exe$/i.test(command) ? command : null);
  if (!legacy) return;
  const samePath = (left: string, right: string) => path.win32.resolve(left).toLowerCase() === path.win32.resolve(right).toLowerCase();
  if (!path.win32.isAbsolute(legacy) || !/^app-\d/.test(path.win32.basename(path.win32.dirname(legacy))) ||
    !samePath(path.win32.dirname(path.win32.dirname(legacy)), path.win32.dirname(launcher)) ||
    path.win32.basename(legacy).toLowerCase() !== path.win32.basename(launcher).toLowerCase()) return;
  const item = app.getLoginItemSettings({ path: legacy, args: [] }).launchItems.find(item => item.name === loginName && item.scope === 'user' && samePath(item.path, legacy) && item.args.length === 0);
  if (!item || typeof item.enabled !== 'boolean') return;
  app.setLoginItemSettings({ openAtLogin: true, path: launcher, args: [], name: loginName, enabled: item.enabled });
  const migrated = app.getLoginItemSettings({ path: launcher, args: [] }).launchItems.find(entry => entry.name === loginName && entry.scope === 'user' && samePath(entry.path, launcher) && entry.args.length === 0);
  if (!migrated || migrated.enabled !== item.enabled) throw new Error('登录启动项升级未完成，请在设置中重新切换登录启动');
}

export async function setLaunchAtLogin(enabled: boolean, context: AutostartContext = currentContext()): Promise<void> {
  if (context.platform !== 'linux') {
    const options = context.platform === 'win32' ? { path: enabled ? autostartExecutable(context) : context.executable, args: [] } : {};
    app.setLoginItemSettings({ openAtLogin: enabled, ...options, ...(context.platform === 'win32' ? { name: loginName } : {}) });
    if (app.getLoginItemSettings(options).openAtLogin !== enabled) throw new Error('系统未保存登录启动设置');
    return;
  }
  const configRoot = context.env.XDG_CONFIG_HOME;
  const folder = path.join(configRoot && path.isAbsolute(configRoot) ? configRoot : path.join(homedir(), '.config'), 'autostart');
  const file = path.join(folder, 'eyecare.desktop');
  if (!enabled) { await rm(file, { force: true }); return; }
  const executable = autostartExecutable(context);
  const entry = autostartDesktopEntry(executable);
  await mkdir(folder, { recursive: true });
  await writeFile(file, entry, { encoding: 'utf8', mode: 0o600 });
}
