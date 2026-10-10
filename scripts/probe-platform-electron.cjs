const { app, powerMonitor, screen, nativeTheme, systemPreferences } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../app/main/platform/native.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.paths = Module._nodeModulePaths(path.dirname(filename));
loaded._compile(compiled, filename);
app.whenReady().then(() => {
  let provider;
  try {
    const factories = { win32: loaded.exports.createWindowsProvider, darwin: loaded.exports.createMacProvider, linux: loaded.exports.createLinuxProvider };
    provider = factories[process.platform]();
    const sample = () => ({ monotonicMs: provider.nowMs(), combinedIdleMs: provider.combinedIdleMs(), mouseIdleMs: provider.mouseIdleMs(), nativeLock: provider.lockState(), electronIdleState: powerMonitor.getSystemIdleState(60) });
    const before = sample();
    // Electron owns the real native message loop. No manual PeekMessage pumping.
    setTimeout(() => {
      try {
        console.log(JSON.stringify({ recordedAt: new Date().toISOString(), electron: process.versions.electron, platform: process.platform, before, after: sample(), displays: screen.getAllDisplays().map(({ id, scaleFactor, bounds }) => ({ id, scaleFactor, bounds })), darkTheme: nativeTheme.shouldUseDarkColors, reducedMotion: systemPreferences.getAnimationSettings().prefersReducedMotion, unverified: ['physical input separation', 'lock/unlock', 'sleep/resume', 'installed package'] }, null, 2));
      } finally { provider.dispose(); app.quit(); }
    }, 3000);
  } catch (error) {
    provider?.dispose();
    console.error(error instanceof Error ? error.message : String(error));
    app.exit(1);
  }
});
