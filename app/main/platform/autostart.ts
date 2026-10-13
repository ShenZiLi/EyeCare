import { app } from 'electron';
import { existsSync } from 'node:fs';
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const loginName = 'org.eyecare.desktop';
const currentContext = (): AutostartContext => ({ platform: process.platform, executable: process.execPath, env: process.env });
const execute = promisify(execFile);

export interface LoginChange { apply(): Promise<void>; rollback(): Promise<void> }
interface RegistryValue { present: boolean; kind?: 'String' | 'ExpandString' | 'Binary'; value?: string }
interface WindowsLoginState { run: RegistryValue; approved: RegistryValue }
type RegistryScript = (script: string) => Promise<string>;
const runRegistryScript: RegistryScript = async script => {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true, timeout: 3000, maxBuffer: 8192, encoding: 'utf8' });
  return stdout;
};
const registryPrelude = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$runPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$approvedPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run'
$entryName = 'org.eyecare.desktop'
function ReadOwned($path) {
  if (!(Test-Path -LiteralPath $path)) { return @{present=$false} }
  $key = Get-Item -LiteralPath $path
  if ($key.GetValueNames() -notcontains $entryName) { return @{present=$false} }
  $kind = $key.GetValueKind($entryName).ToString()
  $value = $key.GetValue($entryName, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
  if ($kind -eq 'Binary') { $value = [Convert]::ToBase64String($value) }
  return @{present=$true;kind=$kind;value=$value}
}
`;
function parseRegistryState(raw: string): WindowsLoginState {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('登录启动项快照无效');
  const result = value as Record<string, unknown>;
  for (const [name, allowed] of [['run', ['String', 'ExpandString']], ['approved', ['Binary']]] as const) {
    const entry = result[name];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('登录启动项快照无效');
    const item = entry as Record<string, unknown>;
    if (typeof item.present !== 'boolean' || (item.present && (typeof item.value !== 'string' || typeof item.kind !== 'string' || !(allowed as readonly string[]).includes(item.kind)))) throw new Error('登录启动项类型无效');
    if (item.present && item.kind === 'Binary' && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.value as string)) throw new Error('登录启动批准项无效');
  }
  return result as unknown as WindowsLoginState;
}
const captureWindowsLogin = async (script: RegistryScript): Promise<WindowsLoginState> =>
  parseRegistryState(await script(registryPrelude + '\n@{run=(ReadOwned $runPath);approved=(ReadOwned $approvedPath)} | ConvertTo-Json -Compress -Depth 4'));
async function restoreWindowsLogin(before: WindowsLoginState, script: RegistryScript): Promise<void> {
  // Embed only base64 data, never executable registry contents.
  const encoded = Buffer.from(JSON.stringify(before), 'utf8').toString('base64');
  await script(registryPrelude + String.raw`
$snapshot = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')) | ConvertFrom-Json
function RestoreOwned($path, $item) {
  if (!$item.present) {
    if (Test-Path -LiteralPath $path) {
      $key = Get-Item -LiteralPath $path
      if ($key.GetValueNames() -contains $entryName) { Remove-ItemProperty -LiteralPath $path -Name $entryName }
    }
    return
  }
  if (!(Test-Path -LiteralPath $path)) { New-Item -Path $path -Force | Out-Null }
  $value = $item.value
  if ($item.kind -eq 'Binary') { $value = [Convert]::FromBase64String($value) }
  New-ItemProperty -LiteralPath $path -Name $entryName -Value $value -PropertyType $item.kind -Force | Out-Null
}
RestoreOwned $runPath $snapshot.run
RestoreOwned $approvedPath $snapshot.approved
`);
  const actual = await captureWindowsLogin(script);
  for (const key of ['run', 'approved'] as const) {
    const a = actual[key], b = before[key];
    if (a.present !== b.present || (b.present && (a.kind !== b.kind || a.value !== b.value))) throw new Error('系统登录启动项未能恢复');
  }
}
function linuxLoginFile(context: AutostartContext): string {
  const root = context.env.XDG_CONFIG_HOME;
  return path.join(root && path.isAbsolute(root) ? root : path.join(homedir(), '.config'), 'autostart', 'eyecare.desktop');
}
async function inspectLinuxLogin(file: string) {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('登录启动项必须是普通文件');
    return { bytes: await readFile(file), mode: info.mode & 0o7777 };
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
/** Capture actual OS state: stored preferences can differ from disabled entries. */
export async function prepareLoginChange(enabled: boolean, context: AutostartContext = currentContext(), registry: RegistryScript = runRegistryScript): Promise<LoginChange> {
  const apply = () => setLaunchAtLogin(enabled, context);
  if (context.platform === 'win32') {
    const before = await captureWindowsLogin(registry);
    return { apply, rollback: () => restoreWindowsLogin(before, registry) };
  }
  if (context.platform === 'darwin') {
    const before = app.getLoginItemSettings({});
    if (typeof before.openAtLogin !== 'boolean') throw new Error('系统登录启动项状态无效');
    return { apply, rollback: () => setLaunchAtLogin(before.openAtLogin, context) };
  }
  const file = linuxLoginFile(context);
  const before = await inspectLinuxLogin(file);
  return { apply, rollback: async () => {
    // Never follow a new symlink inserted while the preference save was pending.
    await inspectLinuxLogin(file);
    if (!before) { await rm(file, { force: true }); return; }
    const temporary = file + '.' + randomUUID() + '.tmp';
    try {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(temporary, before.bytes, { mode: before.mode, flag: 'wx' });
      await chmod(temporary, before.mode);
      await rename(temporary, file);
    } finally { await rm(temporary, { force: true }); }
    const restored = await inspectLinuxLogin(file);
    if (!restored || !restored.bytes.equals(before.bytes) || restored.mode !== before.mode) throw new Error('系统登录启动项未能恢复');
  } };
}

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
  const file = linuxLoginFile(context);
  const folder = path.dirname(file);
  await inspectLinuxLogin(file);
  if (!enabled) { await rm(file, { force: true }); return; }
  const executable = autostartExecutable(context);
  const entry = autostartDesktopEntry(executable);
  await mkdir(folder, { recursive: true });
  await writeFile(file, entry, { encoding: 'utf8', mode: 0o600 });
}
