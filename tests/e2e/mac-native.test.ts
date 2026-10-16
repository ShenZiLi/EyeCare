import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

async function within<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Owned application cleanup timed out')), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

async function closeOwnedApplication(application: ElectronApplication): Promise<void> {
  const child = application.process();
  try { await within(application.close(), 5000); }
  catch (error) {
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise<void>((resolve, reject) => {
        const done = () => { clearTimeout(timer); child.removeListener('exit', done); resolve(); };
        const timer = setTimeout(() => {
          child.removeListener('exit', done);
          reject(new Error('Owned application did not exit after forced cleanup'));
        }, 5000);
        child.once('exit', done);
        child.kill('SIGKILL');
      });
    }
    throw error;
  }
}

test('isolated macOS development instances coexist without sharing preferences or locks', async () => {
  test.setTimeout(60000);
  test.skip(process.platform !== 'darwin', 'macOS runtime regression');
  const directories: string[] = [];
  const applications: ElectronApplication[] = [];
  const environment = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[0] !== 'ELECTRON_RUN_AS_NODE'));
  try {
    for (let index = 0; index < 2; index++) {
      const directory = await mkdtemp(path.join(os.tmpdir(), 'eyecare-mac-isolated-'));
      directories.push(directory);
      // Deliberately rely on the app's existing development-only override,
      // without Chromium's --user-data-dir switch hiding a startup ordering bug.
      const application = await electron.launch({ args: [path.resolve('.')], env: { ...environment, EYECARE_TEST_USER_DATA: directory }, timeout: 15000 });
      applications.push(application);
      application.context().setDefaultTimeout(10000);
      const page = await application.firstWindow();
      await expect(page.getByRole('heading', { name: '概览', exact: true })).toBeVisible();
      expect(await application.evaluate(({ app }) => ({ userData: app.getPath('userData'), packaged: app.isPackaged }))).toEqual({ userData: directory, packaged: false });
    }
    expect(applications[0].process().pid).not.toBe(applications[1].process().pid);
    const firstPage = await applications[0].firstWindow();
    const current = await firstPage.evaluate(() => window.eyeCare.getSnapshot());
    const settings = structuredClone(current.settings);
    settings.appearance.showTrayCountdown = false;
    const saved = await firstPage.evaluate(({ revision, settings }) => window.eyeCare.saveSettings(revision, settings), { revision: current.settingsRevision, settings });
    expect(saved.ok).toBe(true);
    const secondPage = await applications[1].firstWindow();
    expect((await secondPage.evaluate(() => window.eyeCare.getSnapshot())).settings.appearance.showTrayCountdown).toBe(true);
    expect(await firstPage.getByRole('heading', { name: '概览', exact: true }).isVisible()).toBe(true);
  } finally {
    const closed = await Promise.allSettled(applications.map(closeOwnedApplication));
    const removed = await Promise.allSettled(directories.map(directory => rm(directory, { recursive: true, force: true })));
    const failures = [...closed, ...removed].filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Isolated macOS verification cleanup failed');
  }
});

test('macOS close keeps the tray while hiding the Dock and reopening restores focus', async () => {
  test.skip(process.platform !== 'darwin', 'macOS Dock lifecycle regression');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'eyecare-mac-dock-'));
  const executablePath = process.env.EYECARE_TEST_EXECUTABLE;
  const environment = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[0] !== 'ELECTRON_RUN_AS_NODE'));
  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({ ...(executablePath ? { executablePath, args: [`--user-data-dir=${directory}`] } : { args: [path.resolve('.')] }), env: { ...environment, EYECARE_TEST_USER_DATA: directory }, timeout: 15000 });
    const desktop = application;
    const child = desktop.process();
    const isolated = await desktop.evaluate(({ app }) => ({ userData: app.getPath('userData'), packaged: app.isPackaged }));
    // macOS packaged Electron canonicalizes /var to /private/var. Compare the
    // real directory so isolation remains strict across that system symlink.
    expect(await realpath(isolated.userData)).toBe(await realpath(directory));
    expect(isolated.packaged).toBe(Boolean(executablePath));
    const page = await desktop.firstWindow();
    await expect(page.getByRole('heading', { name: '概览', exact: true })).toBeVisible();
    const windowState = () => desktop.evaluate(({ app, BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find(window => new URL(window.webContents.getURL()).searchParams.get('surface') === 'main')!;
      return { visible: window.isVisible(), focused: window.isFocused(), minimized: window.isMinimized(), dock: app.dock!.isVisible() };
    });
    await expect.poll(windowState).toMatchObject({ visible: true, dock: true });
    expect((await page.evaluate(() => window.eyeCare.getSnapshot())).capabilities.tray.state).toBe('available');

    // Resolve the first-close information dialog without operating the real
    // desktop. The native window, Dock and application lifecycle remain real.
    await desktop.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    });
    const closeMain = () => desktop.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find(window => new URL(window.webContents.getURL()).searchParams.get('surface') === 'main')!.close();
    });
    await closeMain();
    await expect.poll(windowState).toMatchObject({ visible: false, dock: false });
    expect((await page.evaluate(() => window.eyeCare.getSnapshot())).capabilities.tray.state).toBe('available');

    await desktop.evaluate(({ app }) => { app.emit('activate'); });
    await expect.poll(windowState).toMatchObject({ visible: true, focused: true, dock: true });
    // Closing again immediately exercises Electron's Dock.hide cooldown.
    await closeMain();
    await expect.poll(windowState).toMatchObject({ visible: false, dock: false });
    expect((await page.evaluate(() => window.eyeCare.openSettings())).ok).toBe(true);
    await expect(page.getByRole('heading', { name: '通用设置', exact: true })).toBeVisible();
    await expect.poll(windowState).toMatchObject({ visible: true, focused: true, dock: true });

    // A queued hide must not hide a subsequently reopened main window.
    await closeMain();
    await desktop.evaluate(({ app }) => { app.emit('activate'); });
    await expect.poll(windowState).toMatchObject({ visible: true, focused: true, dock: true });
    await page.waitForTimeout(1200);
    expect(await windowState()).toMatchObject({ visible: true, dock: true });
    await desktop.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].minimize(); });
    await expect.poll(windowState).toMatchObject({ minimized: true, dock: true });
    await desktop.evaluate(({ app }) => { app.emit('activate'); });
    await expect.poll(windowState).toMatchObject({ visible: true, focused: true, minimized: false, dock: true });

    await closeMain();
    await expect.poll(windowState).toMatchObject({ visible: false, dock: false });
    const previewResult = await page.evaluate(async () => {
      const { settings } = await window.eyeCare.getSnapshot();
      settings.reminder = { visual: 'mask', soundEnabled: false };
      return window.eyeCare.preview(settings);
    });
    expect(previewResult, `Background preview result: ${JSON.stringify(previewResult)}`).toMatchObject({ ok: true });
    const previewWindow = () => desktop.windows().find(candidate => new URL(candidate.url() || 'about:blank').searchParams.get('surface') === 'overlay');
    await expect.poll(() => !!previewWindow()).toBe(true);
    const overlay = previewWindow()!;
    await expect(overlay.getByRole('button', { name: '知道了', exact: true })).toBeVisible();
    expect(await windowState()).toMatchObject({ visible: false, dock: false });
    expect((await page.evaluate(() => window.eyeCare.cancelPreview())).ok).toBe(true);

    // Hold Dock.show's completion across a new close request. Its late
    // resolution must not reopen either the main window or the Dock icon.
    const pendingShow = await desktop.evaluateHandle(({ app }) => {
      const show = app.dock!.show.bind(app.dock);
      let complete: (() => void) | undefined;
      app.dock!.show = () => new Promise<void>(resolve => { complete = () => { void show().then(resolve); }; });
      return { started: () => !!complete, finish: () => { app.dock!.show = show; complete!(); } };
    });
    await desktop.evaluate(({ app }) => { app.emit('activate'); });
    await expect.poll(() => pendingShow.evaluate(control => control.started())).toBe(true);
    await closeMain();
    await pendingShow.evaluate(control => control.finish());
    await expect.poll(windowState).toMatchObject({ visible: false, dock: false });
    await page.waitForTimeout(1200);
    expect(await windowState()).toMatchObject({ visible: false, dock: false });
    const closed = desktop.waitForEvent('close');
    expect((await page.evaluate(() => window.eyeCare.quit())).ok).toBe(true);
    await closed;
    application = undefined;
    expect(child.exitCode).toBe(0);
  } finally {
    try { if (application) await closeOwnedApplication(application); }
    finally { await rm(directory, { recursive: true, force: true }); }
  }
});
