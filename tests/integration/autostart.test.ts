import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const login = vi.hoisted(() => ({ setLoginItemSettings: vi.fn(), getLoginItemSettings: vi.fn() }));
const filesystem = vi.hoisted(() => ({ exists: vi.fn() }));
vi.mock('electron', () => ({ app: login }));
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, existsSync: (file: import('node:fs').PathLike) => filesystem.exists(file) ?? actual.existsSync(file) };
});
import { autostartDesktopEntry, autostartExecutable, migrateWindowsLaunchAtLogin, setLaunchAtLogin } from '../../app/main/platform/autostart';

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
