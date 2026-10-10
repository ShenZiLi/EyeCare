/* Read-only native evidence. This does not lock, sleep, inject input, install
 * startup items, or claim acceptance of those unexercised transitions. */
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
const factories = { win32: loaded.exports.createWindowsProvider, darwin: loaded.exports.createMacProvider, linux: loaded.exports.createLinuxProvider };
let provider;
try {
  provider = factories[process.platform]?.();
  if (!provider) throw new Error('No native provider for this host');
  const sample = () => ({ monotonicMs: provider.nowMs(), combinedIdleMs: provider.combinedIdleMs(), mouseIdleMs: provider.mouseIdleMs(), lockState: provider.lockState() });
  const before = sample();
  let pump = () => {};
  if (process.platform === 'win32') {
    const koffi = require('koffi');
    const user = koffi.load('user32.dll');
    const peek = user.func('bool __stdcall PeekMessageW(_Out_ void *, void *, uint32_t, uint32_t, uint32_t)');
    const dispatch = user.func('intptr_t __stdcall DispatchMessageW(void *)');
    const message = Buffer.alloc(64);
    pump = () => { for (let i = 0; i < 64 && peek(message, null, 0, 0, 1); i++) dispatch(message); };
  }
  const timer = setInterval(pump, 25);
  setTimeout(() => {
    clearInterval(timer);
    pump();
    try {
      console.log(JSON.stringify({ recordedAt: new Date().toISOString(), platform: process.platform, arch: process.arch, nativeSource: filename, before, after: sample(), mouseReason: provider.mouseReason, unverified: ['lock/unlock transitions', 'sleep/resume duration', 'mouse/keyboard separation on physical devices', 'multi-display overlays', 'packaged notifications', 'tray DPI', 'launch-at-login'] }, null, 2));
    } finally { provider.dispose(); }
  }, 3000);
} catch (error) {
  provider?.dispose();
  console.error(JSON.stringify({ platform: process.platform, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
}
