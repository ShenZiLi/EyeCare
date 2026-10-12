import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
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
