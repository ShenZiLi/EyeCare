const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { _electron } = require('playwright');
const koffi = require('koffi');

async function within(operation, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms`)), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

async function stopOwnedApplication(application) {
  const child = application.process();
  try { await within(application.close(), 10000, 'Application close'); }
  catch (error) {
    // Only this verifier's launched child is eligible for forced cleanup.
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise((resolve, reject) => {
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

// This verifier uses real native observations. It neither injects activity nor
// changes login items, notification authorization, lock state or OS appearance.
async function main() {
  assert.equal(process.platform, 'darwin', 'This runtime verifier targets macOS only');
  await fs.access(path.resolve('.vite/build/main.js'));
  const system = koffi.load('/usr/lib/libSystem.B.dylib');
  const timebase = koffi.struct({ numer: 'uint32_t', denom: 'uint32_t' });
  const base = { numer: 0, denom: 0 };
  assert.equal(system.func('mach_timebase_info', 'int', [koffi.out(koffi.pointer(timebase))])(base), 0);
  assert.ok(base.numer > 0 && base.denom > 0, 'Native clock conversion must be valid');
  const continuous = system.func('uint64_t mach_continuous_time()');
  const nativeNow = () => Number(continuous()) * base.numer / base.denom / 1e6;
  const cg = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics');
  const since = cg.func('double CGEventSourceSecondsSinceLastEventType(int, uint32_t)');
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'eyecare-macos-runtime-'));
  const env = { ...process.env, EYECARE_TEST_USER_DATA: userData };
  delete env.ELECTRON_RUN_AS_NODE;
  const evidence = {
    recordedAt: new Date().toISOString(), platform: process.platform, arch: process.arch,
    osRelease: os.release(), nativeClock: 'mach_continuous_time', inputClock: 'CoreGraphics session event idle',
    observations: [], reminders: [], results: [], complete: false,
    acceptanceLimits: ['Physical lock/sleep transitions', 'Mouse/keyboard/scroll separation', 'Multiple physical displays and Spaces', 'Signed/notarized notification delivery', 'Login startup', 'Long-duration stability'],
  };
  let desktop;
  let failure;
  try {
    await within((async () => {
      // Rely on the development-only app override, so Chromium's command-line
      // switch cannot hide a single-instance lock being acquired too early.
      desktop = await _electron.launch({ args: [process.cwd()], env, timeout: 30000 });
      desktop.context().setDefaultTimeout(15000);
      const page = await desktop.firstWindow();
      await page.getByRole('heading', { name: '概览', exact: true }).waitFor();
      const snapshot = () => page.evaluate(() => window.eyeCare.getSnapshot());
      const save = async settings => {
        const current = await snapshot();
        const result = await page.evaluate(({ revision, settings }) => window.eyeCare.saveSettings(revision, settings), { revision: current.settingsRevision, settings });
        assert.equal(result.ok, true, JSON.stringify(result));
        return result.value;
      };
      const initial = await snapshot();
      for (const capability of ['input', 'mouse', 'lock', 'overlay', 'tray']) {
        assert.equal(initial.capabilities[capability].state, 'available', `${capability}: ${initial.capabilities[capability].reason}`);
      }
      assert.ok(['counting', 'short_idle', 'long_idle'].includes(initial.status), initial.statusReason);
      assert.equal(initial.settings.general.launchAtLogin, false);
      evidence.capabilities = initial.capabilities;
      evidence.displays = initial.displays;
      evidence.runtime = await desktop.evaluate(({ app, Notification }) => ({
        packaged: app.isPackaged, version: app.getVersion(), electron: process.versions.electron,
        userData: app.getPath('userData'), notificationsSupported: Notification.isSupported(),
        loginSettings: app.getLoginItemSettings(),
      }));
      assert.equal(evidence.runtime.packaged, false, 'Temporary userData override is supported only in development');
      assert.equal(evidence.runtime.userData, userData, 'Never verify against real user preferences');
      evidence.runtime.isolatedUserData = true;
      // Observe the real tray instance through forwarding wrappers. No Electron
      // method is stubbed; its native getter verifies what was actually applied.
      await desktop.evaluate(({ Tray }) => {
        const originalTitle = Tray.prototype.setTitle;
        const originalImage = Tray.prototype.setImage;
        const state = { tray: null, titles: [], template: false, originalTitle, originalImage };
        globalThis.macRuntimeVerifier = state;
        Tray.prototype.setTitle = function (...args) {
          const result = originalTitle.apply(this, args);
          state.tray = this; state.titles.push(this.getTitle());
          return result;
        };
        Tray.prototype.setImage = function (image) {
          const result = originalImage.call(this, image);
          state.template = image.isTemplateImage();
          return result;
        };
      });
      const settings = structuredClone(initial.settings);
      settings.timer.mode = 'fixed';
      settings.timer.intervalMinutes = 1;
      settings.timer.longIdleMinutes = 120;
      settings.reminder.visual = 'flash';
      settings.reminder.soundEnabled = false;
      settings.appearance.showTrayCountdown = true;
      const startBeforeMs = nativeNow();
      await save(settings);
      const startAfterMs = nativeNow();
      Object.assign(evidence, { configuration: structuredClone(settings), startBeforeMs, startAfterMs });
      const trayState = () => desktop.evaluate(() => {
        const state = globalThis.macRuntimeVerifier;
        return { title: state.tray?.getTitle(), template: state.template, titles: [...state.titles] };
      });
      const enabled = await trayState();
      assert.match(enabled.title, /^\d{2}:\d{2}$/, 'Menu bar must show the real countdown');
      assert.equal(enabled.template, true, 'macOS tray image must adapt to menu bar appearance');
      const withoutCountdown = structuredClone(settings);
      withoutCountdown.appearance.showTrayCountdown = false;
      const beforeToggle = await snapshot();
      const afterToggle = await save(withoutCountdown);
      assert.equal((await trayState()).title, '', 'Disabling countdown clears the native title');
      assert.ok(afterToggle.remainingMs <= beforeToggle.remainingMs, 'Appearance must not restart the timer');
      await save(settings);
      await desktop.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('surface=main')).hide();
      });
      const events = new Map();
      const results = new Map();
      let previousSequence = -1;
      let finishedAtMs = null;
      while (nativeNow() - startAfterMs < 75000) {
        const current = await snapshot();
        assert.ok(current.sequence >= previousSequence, 'Snapshot sequences cannot regress');
        previousSequence = current.sequence;
        assert.equal(current.restConfirmedCount, 0, 'Flash completion cannot confirm rest');
        assert.ok(!['starting', 'locked', 'sleeping', 'capability_error', 'long_idle'].includes(current.status), current.statusReason);
        const idleMs = since(0, 0xffffffff) * 1000;
        assert.ok(Number.isFinite(idleMs) && idleMs >= 0, 'Real native session input observation must be valid');
        if (current.currentReminderId && !events.has(current.currentReminderId)) {
          const overlay = desktop.windows().find(window => window !== page && window.url().includes('surface=overlay'));
          const state = overlay && await overlay.evaluate(() => window.eyeCare.getOverlay()).catch(() => null);
          if (state) {
            assert.equal(state.event.kind, 'real');
            const windows = await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => ({ surface: new URL(window.webContents.getURL()).searchParams.get('surface'), visible: window.isVisible(), focusable: window.isFocusable(), focused: window.isFocused() })));
            assert.equal(windows.find(window => window.surface === 'main').visible, false);
            assert.ok(windows.filter(window => window.surface === 'overlay').every(window => !window.focusable && !window.focused), 'Flash must not steal focus');
            events.set(state.event.id, { id: state.event.id, createdAtMs: state.event.createdAtMs, mainHidden: true });
          }
        }
        if (current.latestReminderResult) { results.set(current.latestReminderResult.id, current.latestReminderResult); finishedAtMs ??= nativeNow(); }
        if (evidence.observations.length === 0 || nativeNow() - evidence.observations.at(-1).nowMs >= 10000) {
          const native = await desktop.evaluate(({ BrowserWindow }) => ({ overlayCount: BrowserWindow.getAllWindows().filter(window => window.webContents.getURL().includes('surface=overlay')).length }));
          evidence.observations.push({ nowMs: nativeNow(), combinedIdleMs: idleMs, sequence: current.sequence, status: current.status, remainingMs: current.remainingMs, ...native });
          console.log(JSON.stringify(evidence.observations.at(-1)));
        }
        if (finishedAtMs !== null && nativeNow() - finishedAtMs >= 3000) break;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      evidence.reminders = [...events.values()];
      evidence.results = [...results.values()];
      assert.equal(events.size, 1, 'One native minute must create exactly one real reminder');
      assert.equal(results.size, 1, 'The flash must complete exactly once');
      const event = evidence.reminders[0];
      assert.ok(event.createdAtMs >= startBeforeMs + 60000 && event.createdAtMs <= startAfterMs + 63000, 'The real fixed deadline must dispatch within 3 seconds');
      assert.equal(evidence.results[0].outcome, 'automatic');
      assert.ok(evidence.results[0].channels.some(channel => channel.channel === 'visual' && channel.success));
      const overlays = () => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(window => window.webContents.getURL().includes('surface=overlay')).length);
      assert.equal(await overlays(), 0, 'Completed flashes must leave no overlay');
      const titles = (await trayState()).titles;
      assert.ok(new Set(titles.filter(title => /^\d{2}:\d{2}$/.test(title))).size > 1, 'Native menu bar countdown must advance');
      evidence.tray = { template: true, countdownAdvanced: true, disableClearsTitle: true };
      await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('surface=main')).show());
      settings.reminder.visual = 'mask';
      await save(settings);
      const [mask] = await Promise.all([
        desktop.waitForEvent('window', { timeout: 15000 }),
        page.evaluate(() => window.eyeCare.remindNow()).then(result => assert.equal(result.ok, true)),
      ]);
      await mask.getByRole('button', { name: '知道了', exact: true }).waitFor();
      const maskState = await mask.evaluate(() => window.eyeCare.getOverlay());
      await mask.getByRole('button', { name: '知道了', exact: true }).click();
      await page.waitForFunction(() => window.eyeCare.getSnapshot().then(value => value.currentReminderId === null && value.restConfirmedCount === 1));
      const afterMask = await snapshot();
      assert.equal(afterMask.latestReminderResult.id, maskState.event.id);
      assert.equal(afterMask.latestReminderResult.outcome, 'acknowledge');
      assert.ok(afterMask.remainingMs > 57000, 'Acknowledging a real mask restarts its cycle');
      assert.equal(await overlays(), 0, 'Acknowledged masks must leave no overlay');
      evidence.mask = { restConfirmedCount: afterMask.restConfirmedCount, result: afterMask.latestReminderResult, remainingMs: afterMask.remainingMs };
      const finalLogin = await desktop.evaluate(({ app }) => app.getLoginItemSettings());
      assert.deepEqual(finalLogin, evidence.runtime.loginSettings, 'Verification must not change OS login preferences');
      evidence.durationMs = nativeNow() - startAfterMs;
      evidence.complete = true;
    })(), 150000, 'Native macOS verification');
  } catch (error) { failure = error; evidence.error = String(error); }
  finally {
    if (desktop) {
      try {
        await within(desktop.evaluate(({ Tray }) => {
          const state = globalThis.macRuntimeVerifier;
          if (state) { Tray.prototype.setTitle = state.originalTitle; Tray.prototype.setImage = state.originalImage; delete globalThis.macRuntimeVerifier; }
        }), 3000, 'Restore verifier observers').catch(() => {});
        await stopOwnedApplication(desktop);
      } catch (error) { failure ??= error; evidence.cleanupError = String(error); evidence.complete = false; }
    }
    try {
      await fs.rm(userData, { recursive: true, force: true });
      evidence.fixturesRemoved = true;
    } catch (error) { failure ??= error; evidence.cleanupError = String(error); evidence.complete = false; }
    await fs.mkdir(path.resolve('docs'), { recursive: true });
    // The temp directory is gone; retain no personal userData path in evidence.
    if (evidence.runtime) delete evidence.runtime.userData;
    await fs.writeFile(path.resolve('docs/macos-runtime-evidence.json'), JSON.stringify(evidence, null, 2));
  }
  if (failure) throw failure;
  console.log('Native macOS cycle, hidden main window, tray title and mask acknowledgement passed. Physical lock/sleep, release signing and notification authorization remain separate acceptance checks.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
