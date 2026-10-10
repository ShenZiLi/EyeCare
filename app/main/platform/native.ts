import koffi from 'koffi';

export type LockState = 'locked' | 'unlocked' | 'unknown';
export interface NativeProvider {
  nowMs(): number;
  combinedIdleMs(): number;
  mouseIdleMs(): number | null;
  lockState(): LockState;
  mouseReason: string;
  dispose(): void;
}

const finiteIdle = (value: number): number => {
  if (!Number.isFinite(value) || value < 0) throw new Error('系统返回了无效的空闲时间');
  return value;
};

export function createWindowsProvider(): NativeProvider {
  const kernel = koffi.load('kernel32.dll');
  const user = koffi.load('user32.dll');
  const wts = koffi.load('wtsapi32.dll');
  const ticks = kernel.func('uint64_t __stdcall GetTickCount64()');
  const sessionId = kernel.func('bool __stdcall ProcessIdToSessionId(uint32_t, _Out_ uint32_t *)');
  const info = koffi.struct({ cbSize: 'uint32_t', dwTime: 'uint32_t' });
  const getInput = user.func('__stdcall', 'GetLastInputInfo', 'bool', [koffi.inout(koffi.pointer(info))]);
  const query = wts.func('bool __stdcall WTSQuerySessionInformationW(void *, uint32_t, int, _Out_ void **, _Out_ uint32_t *)');
  const free = wts.func('void __stdcall WTSFreeMemory(void *)');
  const openDesktop = user.func('void * __stdcall OpenInputDesktop(uint32_t, bool, uint32_t)');
  const closeDesktop = user.func('bool __stdcall CloseDesktop(void *)');
  const desktopName = user.func('bool __stdcall GetUserObjectInformationW(void *, int, _Out_ void *, uint32_t, _Out_ uint32_t *)');
  const nowMs = () => Number(ticks());
  const id = [0];
  if (!sessionId(process.pid, id)) throw new Error('无法确定当前 Windows 会话');
  let mouseAt: number | null = null;
  let window: unknown = null;
  let registered: bigint | null = null;
  let removeMouse = () => {};
  let reason = '';
  const isWindow = user.func('bool __stdcall IsWindow(void *)');
  try {
    // Raw Input provides movement, buttons and wheel independently of keyboard,
    // including while another application owns focus. No input payload is read.
    const proc = koffi.proto('intptr_t __stdcall EyeCareMouseWndProc(void *, uint32_t, uintptr_t, intptr_t)');
    const def = user.func('intptr_t __stdcall DefWindowProcW(void *, uint32_t, uintptr_t, intptr_t)');
    registered = koffi.register((hwnd: unknown, message: number, wp: number | bigint, lp: number | bigint) => {
      if (message === 0x00ff) mouseAt = nowMs();
      return def(hwnd, message, wp, lp);
    }, koffi.pointer(proc));
    const wc = koffi.struct({ style: 'uint32_t', lpfnWndProc: koffi.pointer(proc), cbClsExtra: 'int', cbWndExtra: 'int', hInstance: 'void *', hIcon: 'void *', hCursor: 'void *', hbrBackground: 'void *', lpszMenuName: 'str16', lpszClassName: 'str16' });
    const registerClass = user.func('__stdcall', 'RegisterClassW', 'uint16_t', [koffi.pointer(wc)]);
    const instance = kernel.func('void * __stdcall GetModuleHandleW(str16)')(null);
    const className = `EyeCareRawMouse${process.pid}`;
    if (!registerClass({ style: 0, lpfnWndProc: registered, cbClsExtra: 0, cbWndExtra: 0, hInstance: instance, hIcon: null, hCursor: null, hbrBackground: null, lpszMenuName: null, lpszClassName: className })) throw new Error('注册原始鼠标接收窗口失败');
    const unregisterClass = user.func('bool __stdcall UnregisterClassW(str16, void *)');
    removeMouse = () => { unregisterClass(className, instance); };
    window = user.func('void * __stdcall CreateWindowExW(uint32_t, str16, str16, uint32_t, int, int, int, int, void *, void *, void *, void *)')(0, className, '', 0, 0, 0, 0, 0, -3n, null, instance, null);
    if (!window) throw new Error('创建原始鼠标接收窗口失败');
    const rawDevice = koffi.struct({ usUsagePage: 'uint16_t', usUsage: 'uint16_t', dwFlags: 'uint32_t', hwndTarget: 'void *' });
    const registerRaw = user.func('__stdcall', 'RegisterRawInputDevices', 'bool', [koffi.pointer(rawDevice), 'uint32_t', 'uint32_t']);
    if (!registerRaw({ usUsagePage: 1, usUsage: 2, dwFlags: 0x100, hwndTarget: window }, 1, koffi.sizeof(rawDevice))) throw new Error('注册原始鼠标设备失败');
    removeMouse = () => {
      registerRaw({ usUsagePage: 1, usUsage: 2, dwFlags: 1, hwndTarget: null }, 1, koffi.sizeof(rawDevice));
      user.func('bool __stdcall DestroyWindow(void *)')(window);
      unregisterClass(className, instance);
    };
    reason = 'Windows Raw Input：鼠标移动、按键及滚轮；首次鼠标事件前不累计';
  } catch (error) {
    if (window) user.func('bool __stdcall DestroyWindow(void *)')(window);
    removeMouse();
    if (registered) koffi.unregister(registered);
    registered = null;
    window = null;
    reason = error instanceof Error ? error.message : '原始鼠标桥接不可用';
  }
  return {
    nowMs,
    mouseReason: reason,
    combinedIdleMs: () => {
      const last = { cbSize: koffi.sizeof(info), dwTime: 0 };
      if (!getInput(last)) throw new Error('读取当前会话输入失败');
      // GetLastInputInfo is a 32-bit tick count, not a wall-clock timestamp.
      return finiteIdle(((nowMs() % 0x100000000) - last.dwTime + 0x100000000) % 0x100000000);
    },
    mouseIdleMs: () => {
      if (!window || !isWindow(window)) throw new Error(reason || '原始鼠标窗口已失效');
      return mouseAt === null ? null : finiteIdle(nowMs() - mouseAt);
    },
    lockState: () => {
      const pointer = [null];
      const size = [0];
      if (!query(null, id[0], 25, pointer, size) || !pointer[0]) return 'unknown';
      try {
        if (size[0] < 20 || koffi.decode(pointer[0], 'uint32_t') !== 1) return 'unknown';
        const state = koffi.decode(pointer[0], 12, 'uint32_t');
        const flags = koffi.decode(pointer[0], 16, 'int32_t');
        if (flags === 0 || state !== 0) return 'locked';
        if (flags !== 1) return 'unknown';
        // WTS unlock alone is insufficient during a secure desktop transition.
        const desktop = openDesktop(0, false, 1);
        if (!desktop) return 'unknown';
        try {
          const buffer = Buffer.alloc(512);
          const needed = [0];
          if (!desktopName(desktop, 2, buffer, buffer.length, needed)) return 'unknown';
          return buffer.toString('utf16le').split('\0')[0].toLowerCase() === 'default' ? 'unlocked' : 'locked';
        } finally { closeDesktop(desktop); }
      } finally { free(pointer[0]); }
    },
    dispose: () => { removeMouse(); if (registered) { koffi.unregister(registered); registered = null; } },
  };
}

export function createMacProvider(): NativeProvider {
  const cg = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics');
  const cf = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation');
  const system = koffi.load('/usr/lib/libSystem.B.dylib');
  const timebase = koffi.struct({ numer: 'uint32_t', denom: 'uint32_t' });
  const base = { numer: 0, denom: 0 };
  if (system.func('mach_timebase_info', 'int', [koffi.out(koffi.pointer(timebase))])(base) !== 0 || !base.denom) throw new Error('连续时钟不可用');
  const continuous = system.func('uint64_t mach_continuous_time()');
  const since = cg.func('double CGEventSourceSecondsSinceLastEventType(int, uint32_t)');
  const session = cg.func('void * CGSessionCopyCurrentDictionary()');
  const createKey = cf.func('void * CFStringCreateWithCString(void *, str, uint32_t)');
  const get = cf.func('void * CFDictionaryGetValue(void *, void *)');
  const type = cf.func('uintptr_t CFGetTypeID(void *)');
  const booleanType = cf.func('uintptr_t CFBooleanGetTypeID()');
  const boolean = cf.func('bool CFBooleanGetValue(void *)');
  const release = cf.func('void CFRelease(void *)');
  const lockKey = createKey(null, 'CGSSessionScreenIsLocked', 0x08000100);
  const consoleKey = koffi.decode(cg.symbol('kCGSessionOnConsoleKey'), 'void *');
  const registryKey = createKey(null, 'IOConsoleLocked', 0x08000100);
  let registryLock = (): LockState => 'unknown';
  try {
    const io = koffi.load('/System/Library/Frameworks/IOKit.framework/IOKit');
    const root = io.func('uint32_t IORegistryGetRootEntry(uint32_t)');
    const property = io.func('void * IORegistryEntryCreateCFProperty(uint32_t, void *, void *, uint32_t)');
    const releaseEntry = io.func('int IOObjectRelease(uint32_t)');
    registryLock = () => {
      const entry = root(0);
      if (!entry) return 'unknown';
      try {
        const value = property(entry, registryKey, null, 0);
        if (!value) return 'unknown';
        try { return type(value) === booleanType() ? (boolean(value) ? 'locked' : 'unlocked') : 'unknown'; }
        finally { release(value); }
      } finally { releaseEntry(entry); }
    };
  } catch { /* OS versions without an explicit registry flag remain unknown. */ }
  return {
    nowMs: () => Number(continuous()) * base.numer / base.denom / 1e6,
    combinedIdleMs: () => finiteIdle(since(0, 0xffffffff) * 1000),
    mouseIdleMs: () => finiteIdle(Math.min(...[1, 2, 3, 4, 5, 6, 7, 22, 25, 26, 27].map(event => since(0, event))) * 1000),
    mouseReason: 'CoreGraphics 合并会话事件时间：移动、按键、拖动和滚轮；需原生设备验收',
    lockState: () => {
      const dict = session();
      if (!dict) return 'unknown';
      try {
        const onConsole = get(dict, consoleKey);
        if (!onConsole || type(onConsole) !== booleanType()) return 'unknown';
        if (!boolean(onConsole)) return 'locked';
        const value = get(dict, lockKey);
        // The lock dictionary key is not guaranteed on every OS version. Absence
        // is unknown, never an implicit false. Electron unlock events supplement it.
        if (!value || type(value) !== booleanType()) return registryLock();
        return boolean(value) ? 'locked' : 'unlocked';
      } finally { release(dict); }
    },
    dispose: () => { release(lockKey); release(registryKey); },
  };
}

export function createLinuxProvider(): NativeProvider {
  const libc = koffi.load('libc.so.6');
  const stamp = koffi.struct({ seconds: 'long', nanoseconds: 'long' });
  const clock = libc.func('clock_gettime', 'int', ['int', koffi.out(koffi.pointer(stamp))]);
  const x11 = koffi.load('libX11.so.6');
  const xss = koffi.load('libXss.so.1');
  const display = x11.func('void * XOpenDisplay(str)')(null);
  if (!display) throw new Error('无法连接当前 X11 会话');
  const root = x11.func('unsigned long XDefaultRootWindow(void *)')(display);
  const idle = koffi.struct({ window: 'unsigned long', state: 'int', kind: 'int', since: 'unsigned long', idle: 'unsigned long', eventMask: 'unsigned long' });
  const query = xss.func('XScreenSaverQueryInfo', 'int', ['void *', 'unsigned long', koffi.out(koffi.pointer(idle))]);
  const nowMs = () => { const value = { seconds: 0, nanoseconds: 0 }; if (clock(7, value)) throw new Error('CLOCK_BOOTTIME 不可用'); return Number(value.seconds) * 1000 + Number(value.nanoseconds) / 1e6; };
  return {
    nowMs,
    combinedIdleMs: () => { const value = { window: 0, state: 0, kind: 0, since: 0, idle: 0, eventMask: 0 }; if (!query(display, root, value)) throw new Error('XScreenSaver 输入检测失败'); return finiteIdle(Number(value.idle)); },
    mouseIdleMs: () => null,
    mouseReason: '当前 X11 桥接未提供经验证的 XInput2 鼠标来源；仅鼠标不可选',
    lockState: () => 'unknown',
    dispose: () => { x11.func('int XCloseDisplay(void *)')(display); },
  };
}
