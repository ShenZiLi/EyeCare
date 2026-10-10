const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { _electron } = require('playwright');
const koffi = require('koffi');

async function main() {
  assert.equal(process.platform, 'win32', 'This native timing verifier targets Windows only');
  const ticks = koffi.load('kernel32.dll').func('uint64_t __stdcall GetTickCount64()');
  const nativeNow = () => Number(ticks());
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'eyecare-sustained-'));
  const env = { ...process.env, EYECARE_TEST_USER_DATA: userData };
  delete env.ELECTRON_RUN_AS_NODE;
  const desktop = await _electron.launch({ args: [process.cwd()], env });
  const records = [];
  const events = new Map();
  const results = new Map();
  let sequence = -1;
  const evidence = { recordedAt: new Date().toISOString(), platform: process.platform, arch: process.arch, nativeClock: 'GetTickCount64', observations: records, reminders: [], results: [], complete: false };
  try {
    const page = await desktop.firstWindow();
    await page.getByRole('heading', { name: '概览', exact: true }).waitFor();
    const initial = await page.evaluate(() => window.eyeCare.getSnapshot());
    assert.equal(initial.capabilities.lock.state, 'available');
    assert.equal(initial.capabilities.input.state, 'available');
    const settings = structuredClone(initial.settings);
    settings.timer.mode = 'fixed';
    settings.timer.intervalMinutes = 1;
    settings.timer.longIdleMinutes = 120;
    settings.reminder.visual = 'flash';
    settings.reminder.soundEnabled = false;
    const startBeforeMs = nativeNow();
    const saved = await page.evaluate(({ revision, settings }) => window.eyeCare.saveSettings(revision, settings), { revision: initial.settingsRevision, settings });
    const startAfterMs = nativeNow();
    assert.equal(saved.ok, true, JSON.stringify(saved));
    Object.assign(evidence, { startBeforeMs, startAfterMs, configuration: settings, nativeLongRunVerified: false });
    let hidden = false;
    for (let second = 0; second <= 135; second++) {
      if (second === 10 || second === 90) {
        hidden = second === 10;
        await desktop.evaluate(({ BrowserWindow }, hide) => { const main = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('surface=main')); if (!main) throw new Error('Main window missing'); if (hide) main.hide(); else main.show(); }, hidden);
      }
      const snapshot = await page.evaluate(() => window.eyeCare.getSnapshot());
      assert.ok(snapshot.sequence >= sequence, 'Snapshots cannot move backward');
      sequence = snapshot.sequence;
      assert.equal(snapshot.restConfirmedCount, 0, 'Automatic flashes cannot confirm rest');
      assert.ok(!['capability_error', 'locked', 'sleeping', 'long_idle'].includes(snapshot.status), snapshot.statusReason);
      if (snapshot.currentReminderId && !events.has(snapshot.currentReminderId)) {
        const overlay = desktop.windows().find(window => window !== page && window.url().includes('surface=overlay'));
        if (overlay) {
          const state = await overlay.evaluate(() => window.eyeCare.getOverlay()).catch(() => null);
          if (state) events.set(state.event.id, { id: state.event.id, createdAtMs: state.event.createdAtMs, mainHidden: hidden, elapsedFromSaveMs: state.event.createdAtMs - startAfterMs });
        }
      }
      if (snapshot.latestReminderResult) results.set(snapshot.latestReminderResult.id, snapshot.latestReminderResult);
      if (second % 10 === 0) {
        const native = await desktop.evaluate(({ app, BrowserWindow }) => ({ version: app.getVersion(), metrics: app.getAppMetrics().map(item => ({ type: item.type, cpuPercent: item.cpu.percentCPUUsage, workingSetKB: item.memory.workingSetSize })), overlayCount: BrowserWindow.getAllWindows().filter(window => window.webContents.getURL().includes('surface=overlay')).length }));
        records.push({ second, nativeNowMs: nativeNow(), mainHidden: hidden, sequence: snapshot.sequence, status: snapshot.status, remainingMs: snapshot.remainingMs, ...native });
        console.log(JSON.stringify({ second, mainHidden: hidden, status: snapshot.status, reminderEvents: events.size, completedEvents: results.size, overlayCount: native.overlayCount }));
      }
      if (second < 135) await new Promise(resolve => setTimeout(resolve, 1000));
    }
    const ordered = [...events.values()].sort((a, b) => a.createdAtMs - b.createdAtMs);
    assert.equal(ordered.length, 2, 'Two real native fixed cycles must each dispatch once');
    assert.ok(ordered[0].mainHidden, 'The first cycle must fire with the main window hidden');
    assert.ok(ordered[0].createdAtMs >= startBeforeMs + 60000 && ordered[0].createdAtMs <= startAfterMs + 62000, 'First dispatch must track the real one-minute deadline within 2 seconds');
    assert.ok(ordered[1].createdAtMs - ordered[0].createdAtMs >= 61000 && ordered[1].createdAtMs - ordered[0].createdAtMs <= 65000, 'The next cycle must follow visual completion without immediate repeat');
    assert.equal(results.size, 2);
    for (const result of results.values()) { assert.equal(result.outcome, 'automatic'); assert.ok(result.channels.some(channel => channel.channel === 'visual' && channel.success)); }
    assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(window => window.webContents.getURL().includes('surface=overlay')).length), 0, 'No overlay may survive completed flashes');
    Object.assign(evidence, { complete: true, reminders: ordered, results: [...results.values()], durationMs: nativeNow() - startAfterMs });
  } catch (error) {
    evidence.error = String(error);
    throw error;
  } finally {
    await fs.mkdir(path.resolve('docs'), { recursive: true });
    await fs.writeFile(path.resolve('docs/windows-runtime-evidence.json'), JSON.stringify(evidence, null, 2));
    await desktop.close();
  }
  console.log('Native Windows two-cycle and hidden-window checks passed. This does not establish physical lock/sleep, multi-display, or long-duration stability.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
