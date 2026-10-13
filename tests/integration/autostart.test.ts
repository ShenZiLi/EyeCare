import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const login = vi.hoisted(() => ({ setLoginItemSettings: vi.fn(), getLoginItemSettings: vi.fn() }));
const filesystem = vi.hoisted(() => ({ exists: vi.fn() }));
vi.mock('electron', () => ({ app: login }));
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, existsSync: (file: import('node:fs').PathLike) => filesystem.exists(file) ?? actual.existsSync(file) };
});
import { autostartDesktopEntry, autostartExecutable, migrateWindowsLaunchAtLogin, prepareLoginChange, setLaunchAtLogin } from '../../app/main/platform/autostart';

const folders: string[] = [];
afterEach(async () => { vi.resetAllMocks(); await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true }))); });

describe('persistent login startup paths', () => {
  it('keeps the same Squirrel launcher after changing version directories', () => {
    const root = 'C:\\Users\\Test\\AppData\\Local\\EyeCare';
    const exists = (file: string) => [path.win32.join(root, 'Update.exe'), path.win32.join(root, 'eyecare.exe')].includes(file);
    const launch = (version: string) => autostartExecutable({ platform: 'win32', executable: path.win32.join(root, `app-${version}`, 'eyecare.exe'), env: {} }, exists);
    expect(launch('1.0.1')).toBe(path.win32.join(root, 'eyecare.exe'));
    expect(launch('1.0.2')).toBe(launch('1.0.1'));
  });
  it('uses the executable directly for an unpacked Windows distribution', () => {
    const executable = 'C:\\Portable Apps\\EyeCare\\eyecare.exe';
    expect(autostartExecutable({ platform: 'win32', executable, env: {} }, () => false)).toBe(executable);
  });
  it('rejects a broken Squirrel installation instead of saving a version-specific path', () => {
    expect(() => autostartExecutable({ platform: 'win32', executable: 'C:\\EyeCare\\app-1.0.2\\eyecare.exe', env: {} }, file => file.endsWith('Update.exe'))).toThrow('入口缺失');
  });
  it('registers and verifies the same Windows executable and arguments', async () => {
    login.getLoginItemSettings.mockReturnValue({ openAtLogin: true });
    await setLaunchAtLogin(true, { platform: 'win32', executable: 'C:\\Portable\\eyecare.exe', env: {} });
    expect(login.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true, path: 'C:\\Portable\\eyecare.exe', args: [], name: 'org.eyecare.desktop' });
    expect(login.getLoginItemSettings).toHaveBeenCalledWith({ path: 'C:\\Portable\\eyecare.exe', args: [] });
  });
  it('reports native registration failures and keeps macOS options platform-specific', async () => {
    login.getLoginItemSettings.mockReturnValue({ openAtLogin: false });
    await expect(setLaunchAtLogin(true, { platform: 'darwin', executable: '/Applications/EyeCare.app/Contents/MacOS/EyeCare', env: {} })).rejects.toThrow('未保存');
    expect(login.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true });
    expect(login.getLoginItemSettings).toHaveBeenCalledWith({});
  });
  it('writes the original AppImage path, escapes Exec, and removes only its own entry', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'eyecare-startup-')); folders.push(folder);
    const image = '/home/test/My $Eye`Care"100%\\.AppImage';
    const context = { platform: 'linux' as const, executable: '/tmp/.mount_EyeCare/usr/lib/eyecare', env: { XDG_CONFIG_HOME: folder, APPIMAGE: image } };
    expect(autostartExecutable(context, file => file === image)).toBe(image);
    const entry = autostartDesktopEntry(autostartExecutable(context, () => true));
    expect(entry.split('\n').find(line => line.startsWith('Exec='))).toBe('Exec="/home/test/My \\\\$Eye\\\\`Care\\\\"100%%\\\\\\\\.AppImage"');
    filesystem.exists.mockImplementation(file => file === image);
    await setLaunchAtLogin(true, context);
    const file = path.join(folder, 'autostart', 'eyecare.desktop');
    const content = await readFile(file, 'utf8');
    expect(content).toBe(entry);
    expect(content).not.toContain('.mount_');
    const other = path.join(folder, 'autostart', 'other.desktop'); await writeFile(other, 'unrelated');
    await setLaunchAtLogin(false, context);
    await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(other, 'utf8')).toBe('unrelated');
  });
  it.each(['relative.AppImage', '/tmp/Eye\nCare.AppImage', '/missing.AppImage'])('refuses invalid AppImage path %j', image => {
    expect(() => autostartExecutable({ platform: 'linux', executable: '/tmp/.mount/app', env: { APPIMAGE: image } }, file => file !== '/missing.AppImage')).toThrow('路径无效');
  });
  it('does not register an AppImage mount without the original file path', () => {
    expect(() => autostartExecutable({ platform: 'linux', executable: '/tmp/.mount/app', env: { APPDIR: '/tmp/.mount' } })).toThrow('持久路径');
  });
  it('can remove its Windows startup entry when the Squirrel launcher is missing', async () => {
    filesystem.exists.mockImplementation(file => file.endsWith('Update.exe'));
    login.getLoginItemSettings.mockReturnValue({ openAtLogin: false });
    const executable = 'C:\\EyeCare\\app-1.0.2\\eyecare.exe';
    await setLaunchAtLogin(false, { platform: 'win32', executable, env: {} });
    expect(login.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: false, path: executable, args: [], name: 'org.eyecare.desktop' });
  });
});

describe('actual OS login state snapshots', () => {
  const macContext = { platform: 'darwin' as const, executable: '/Applications/EyeCare.app/Contents/MacOS/eyecare', env: {} };
  it('captures a system-disabled Mac choice and restores it after requested change', async () => {
    let actual = false;
    login.getLoginItemSettings.mockImplementation(() => ({ openAtLogin: actual }));
    login.setLoginItemSettings.mockImplementation(options => { actual = options.openAtLogin; });
    const change = await prepareLoginChange(true, macContext);
    expect(login.setLoginItemSettings).not.toHaveBeenCalled();
    await change.apply(); expect(actual).toBe(true);
    await change.rollback(); expect(actual).toBe(false);
    expect(login.getLoginItemSettings).toHaveBeenCalledWith({});
  });
  it('fails safely without a typed Mac snapshot', async () => {
    login.getLoginItemSettings.mockReturnValue({});
    await expect(prepareLoginChange(true, macContext)).rejects.toThrow('状态无效');
    expect(login.setLoginItemSettings).not.toHaveBeenCalled();
  });
  async function linuxFixture() {
    const folder = await mkdtemp(path.join(tmpdir(), 'eyecare-login-rollback-')); folders.push(folder);
    await mkdir(path.join(folder, 'autostart'));
    return { context: { platform: 'linux' as const, executable: '/opt/eyecare', env: { XDG_CONFIG_HOME: folder } }, file: path.join(folder, 'autostart', 'eyecare.desktop'), other: path.join(folder, 'autostart', 'other.desktop') };
  }
  it('restores Linux original bytes/mode including custom disabled values, leaves others intact', async () => {
    const { context, file, other } = await linuxFixture();
    const original = Buffer.from('[Desktop Entry]\r\nHidden=true\r\n# custom\u00a0comment\r\n');
    await writeFile(file, original); await chmod(file, 0o764); await writeFile(other, 'unrelated');
    const change = await prepareLoginChange(true, context); await change.apply();
    expect(await readFile(file)).not.toEqual(original);
    await change.rollback();
    expect(await readFile(file)).toEqual(original); expect((await stat(file)).mode & 0o777).toBe(0o764);
    expect(await readFile(other, 'utf8')).toBe('unrelated');
  });
  it('restores absence of the Linux owned file', async () => {
    const { context, file } = await linuxFixture();
    const change = await prepareLoginChange(true, context); await change.apply(); await change.rollback();
    await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('rejects existing and newly inserted Linux symlinks before writing their targets', async () => {
    const { context, file, other } = await linuxFixture(); await writeFile(other, 'untouched');
    const change = await prepareLoginChange(true, context);
    await symlink(other, file);
    await expect(change.apply()).rejects.toThrow('普通文件');
    await expect(change.rollback()).rejects.toThrow('普通文件');
    await expect(prepareLoginChange(true, context)).rejects.toThrow('普通文件');
    expect(await readFile(other, 'utf8')).toBe('untouched');
  });
  const windowsContext = { platform: 'win32' as const, executable: 'C:\\Portable\\eyecare.exe', env: {} };
  it('captures and restores exact named Windows Run/approval data with safe encoding', async () => {
    const original = { run: { present: true, kind: 'ExpandString', value: '"%LOCALAPPDATA%\\EyeCare\\eyecare.exe" --arg "$x"; malicious' }, approved: { present: true, kind: 'Binary', value: Buffer.from([3, 0, 0, 0, 1, 2, 3, 4]).toString('base64') } };
    const scripts: string[] = [];
    const registry = vi.fn(async (script: string) => {
      scripts.push(script);
      if (script.includes('function RestoreOwned')) return '';
      return JSON.stringify(original);
    });
    const change = await prepareLoginChange(true, windowsContext, registry);
    expect(login.setLoginItemSettings).not.toHaveBeenCalled();
    login.getLoginItemSettings.mockReturnValue({ openAtLogin: true });
    await change.apply();
    expect(login.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true, path: windowsContext.executable, args: [], name: 'org.eyecare.desktop' });
    await change.rollback();
    const restore = scripts.find(script => script.includes('function RestoreOwned'))!;
    expect(restore).toContain("$entryName = 'org.eyecare.desktop'");
    expect(restore).toContain('StartupApproved\\Run');
    expect(restore).not.toContain('malicious');
    const encoded = restore.match(/FromBase64String\('([A-Za-z0-9+/=]+)'\)/)![1];
    expect(JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))).toEqual(original);
    expect(registry).toHaveBeenCalledTimes(3);
  });
  it('preserves absent Windows entries and reports an unsuccessful restore readback', async () => {
    const absent = { run: { present: false }, approved: { present: false } };
    const registry = vi.fn().mockResolvedValueOnce(JSON.stringify(absent)).mockResolvedValueOnce('').mockResolvedValueOnce(JSON.stringify({ ...absent, run: { present: true, kind: 'String', value: 'unexpected' } }));
    const change = await prepareLoginChange(false, windowsContext, registry);
    await expect(change.rollback()).rejects.toThrow('未能恢复');
    expect(registry.mock.calls[1][0]).toContain('Remove-ItemProperty -LiteralPath $path -Name $entryName');
    expect(registry.mock.calls[1][0]).not.toContain('Remove-Item -');
  });
  it.each([
    { run: { present: true, kind: 'DWord', value: 1 }, approved: { present: false } },
    { run: { present: false }, approved: { present: true, kind: 'Binary', value: 'not base64!' } },
  ])('rejects unsupported Windows data before a native write', async value => {
    await expect(prepareLoginChange(true, windowsContext, async () => JSON.stringify(value))).rejects.toThrow();
    expect(login.setLoginItemSettings).not.toHaveBeenCalled();
  });
});

describe('upgrade migration preserves the operating system startup choice', () => {
  const root = 'C:\\Users\\Test\\AppData\\Local\\EyeCare';
  const launcher = path.win32.join(root, 'eyecare.exe');
  const legacy = path.win32.join(root, 'app-1.0.1', 'eyecare.exe');
  const context = { platform: 'win32' as const, executable: path.win32.join(root, 'app-1.0.2', 'eyecare.exe'), env: {} };
  const exists = (file: string) => [path.win32.join(root, 'Update.exe'), launcher].includes(file);
  const item = (executable: string, enabled: boolean) => ({ name: 'org.eyecare.desktop', path: executable, args: [], scope: 'user', enabled });

  it.each([true, false])('repairs a removed legacy version directory while retaining enabled=%s', async enabled => {
    login.getLoginItemSettings.mockReturnValueOnce({ launchItems: [item(legacy, enabled)] }).mockReturnValueOnce({ launchItems: [item(launcher, enabled)] });
    await migrateWindowsLaunchAtLogin(context, async () => `"${legacy}"`, exists);
    expect(login.getLoginItemSettings).toHaveBeenNthCalledWith(1, { path: legacy, args: [] });
    expect(login.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true, path: launcher, args: [], name: 'org.eyecare.desktop', enabled });
    expect(login.getLoginItemSettings).toHaveBeenNthCalledWith(2, { path: launcher, args: [] });
  });

  it('migrates a legacy command whose executable did not require quoting', async () => {
    login.getLoginItemSettings.mockReturnValueOnce({ launchItems: [item(legacy, true)] }).mockReturnValueOnce({ launchItems: [item(launcher, true)] });
    await migrateWindowsLaunchAtLogin(context, async () => legacy, exists);
    expect(login.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true, path: launcher, args: [], name: 'org.eyecare.desktop', enabled: true });
  });

  it.each([null, `"${launcher}"`, `"${legacy}" --unrelated`, `${legacy} --unrelated`, '"C:\\Other\\app-1.0.1\\eyecare.exe"', `"${root}Extra\\app-1.0.1\\eyecare.exe"`])('does not rewrite a missing, stable or unrelated command %j', async command => {
    await migrateWindowsLaunchAtLogin(context, async () => command, exists);
    expect(login.setLoginItemSettings).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'another.app' },
    { scope: 'machine' },
    { path: 'C:\\Other\\eyecare.exe' },
    { args: ['--unrelated'] },
    { enabled: undefined },
  ])('does not rewrite a registry command without the exact owned user launch item %j', async mismatch => {
    login.getLoginItemSettings.mockReturnValue({ launchItems: [{ ...item(legacy, true), ...mismatch }] });
    await migrateWindowsLaunchAtLogin(context, async () => `"${legacy}"`, exists);
    expect(login.setLoginItemSettings).not.toHaveBeenCalled();
  });

  it('does not inspect or change startup entries for a portable installation', async () => {
    const readCommand = vi.fn(async () => `"${legacy}"`);
    await migrateWindowsLaunchAtLogin({ ...context, executable: 'C:\\Portable\\eyecare.exe' }, readCommand, () => false);
    expect(readCommand).not.toHaveBeenCalled();
    expect(login.setLoginItemSettings).not.toHaveBeenCalled();
  });

  it('reports a migration that fails to preserve the disabled choice', async () => {
    login.getLoginItemSettings.mockReturnValueOnce({ launchItems: [item(legacy, false)] }).mockReturnValueOnce({ launchItems: [item(launcher, true)] });
    await expect(migrateWindowsLaunchAtLogin(context, async () => `"${legacy}"`, exists)).rejects.toThrow();
  });
});
