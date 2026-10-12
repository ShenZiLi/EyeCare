import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMacProvider, type NativeProvider } from '../../app/main/platform/native';

const native = vi.hoisted(() => {
  type CFValue = { type: number; value: unknown };
  const state = {
    session: null as CFValue | null,
    registry: null as CFValue | null,
    libraryFailure: '', functionFailure: '', keyFailure: '', propertyFailure: false,
    root: 7, numer: 125, denom: 3, invalidMouse: null as number | null,
    keys: [] as CFValue[], released: [] as unknown[], events: [] as number[], releasedEntries: [] as number[],
  };
  const boolean = (value: boolean): CFValue => ({ type: 21, value });
  const number = (value: number): CFValue => ({ type: 22, value });
  const dictionary = (value: Record<string, CFValue>): CFValue => ({ type: 17, value });
  const functions: Record<string, (...args: never[]) => unknown> = {
    mach_timebase_info: (base: { numer: number; denom: number }) => { Object.assign(base, { numer: state.numer, denom: state.denom }); return 0; },
    mach_continuous_time: () => 6000000n,
    CGEventSourceSecondsSinceLastEventType: (_source: number, event: number) => { state.events.push(event); return event === 22 && state.invalidMouse !== null ? state.invalidMouse : event === 0xffffffff ? 2 : event === 5 ? 3 : 4; },
    CGSessionCopyCurrentDictionary: () => state.session,
    CFStringCreateWithCString: (_allocator: unknown, name: string) => {
      if (name === state.keyFailure) return null;
      const key: CFValue = { type: 7, value: name }; state.keys.push(key); return key;
    },
    CFDictionaryGetValue: (dict: CFValue, key: CFValue) => (dict.value as Record<string, CFValue>)[key.value as string] ?? null,
    CFGetTypeID: (value: CFValue) => value.type,
    CFBooleanGetTypeID: () => 21,
    CFDictionaryGetTypeID: () => 17,
    CFNumberGetTypeID: () => 22,
    CFBooleanGetValue: (value: CFValue) => value.value,
    CFNumberGetValue: (value: CFValue, _type: number, output: number[]) => { output[0] = value.value as number; return true; },
    CFRelease: (value: unknown) => { state.released.push(value); },
    IORegistryGetRootEntry: () => state.root,
    IORegistryEntryCreateCFProperty: () => { if (state.propertyFailure) throw new Error('registry fault'); return state.registry; },
    IOObjectRelease: (entry: number) => { state.releasedEntries.push(entry); return 0; },
  };
  const symbol = vi.fn(() => { throw new Error('CFSTR is not an exported symbol'); });
  const ffi = {
    load: (path: string) => {
      if (state.libraryFailure && path.includes(state.libraryFailure)) throw new Error('library unavailable');
      return { symbol, func: (signature: string) => {
        const name = signature.includes('(') ? signature.slice(0, signature.indexOf('(')).trim().split(' ').at(-1)! : signature;
        if (name === state.functionFailure || !functions[name]) throw new Error(`unavailable ${name}`);
        return functions[name];
      } };
    },
    struct: (value: unknown) => value,
    pointer: (value: unknown) => value,
    out: (value: unknown) => value,
  };
  return { state, boolean, number, dictionary, ffi, symbol };
});
vi.mock('koffi', () => ({ default: native.ffi }));

const providers: NativeProvider[] = [];
const uidDescriptor = Object.getOwnPropertyDescriptor(process, 'getuid');
beforeEach(() => {
  Object.defineProperty(process, 'getuid', { configurable: true, value: () => 501 });
  Object.assign(native.state, {
    session: native.dictionary({ kCGSSessionOnConsoleKey: native.boolean(true), kCGSSessionUserIDKey: native.number(501) }),
    registry: native.boolean(false), libraryFailure: '', functionFailure: '', keyFailure: '', propertyFailure: false,
    root: 7, numer: 125, denom: 3, invalidMouse: null, keys: [], released: [], events: [], releasedEntries: [],
  });
  native.symbol.mockClear();
});
afterEach(() => {
  providers.splice(0).forEach(provider => provider.dispose());
  if (uidDescriptor) Object.defineProperty(process, 'getuid', uidDescriptor);
  else Reflect.deleteProperty(process, 'getuid');
});
const create = () => { const provider = createMacProvider(); providers.push(provider); return provider; };
const session = (values: Record<string, ReturnType<typeof native.boolean>>) => {
  native.state.session = native.dictionary({ kCGSSessionOnConsoleKey: native.boolean(true), kCGSSessionUserIDKey: native.number(501), ...values });
};

describe('macOS native capability boundary', () => {
  it('uses the literal session key and explicit root boolean to prove startup unlocked', () => {
    expect(create().lockState()).toBe('unlocked');
    expect(native.state.keys.map(key => key.value)).toContain('kCGSSessionOnConsoleKey');
    expect(native.symbol).not.toHaveBeenCalled();
    expect(native.state.released).toEqual([native.state.registry, native.state.session]);
    expect(native.state.releasedEntries).toEqual([7]);
  });
  it('requires current-session user identity before considering the global console flag', () => {
    session({ kCGSSessionUserIDKey: native.number(502) });
    expect(create().lockState()).toBe('unknown');
    expect(native.state.releasedEntries).toEqual([]);
  });
  it('treats an off-console session or an explicit session lock as locked', () => {
    session({ kCGSSessionOnConsoleKey: native.boolean(false) });
    const provider = create(); expect(provider.lockState()).toBe('locked');
    session({ CGSSessionScreenIsLocked: native.boolean(true) });
    expect(provider.lockState()).toBe('locked');
    expect(native.state.releasedEntries).toEqual([]);
  });
  it('returns locked for the explicit root console lock flag', () => {
    native.state.registry = native.boolean(true);
    expect(create().lockState()).toBe('locked');
  });
  it.each([
    { sessionLocked: false, consoleLocked: true },
    { sessionLocked: true, consoleLocked: false },
  ])('locked evidence dominates disagreement: session=$sessionLocked console=$consoleLocked', ({ sessionLocked, consoleLocked }) => {
    session({ CGSSessionScreenIsLocked: native.boolean(sessionLocked) });
    native.state.registry = native.boolean(consoleLocked);
    expect(create().lockState()).toBe('locked');
  });
  it('accepts an explicit current-session false without interpreting a missing root flag as false', () => {
    session({ CGSSessionScreenIsLocked: native.boolean(false) });
    native.state.registry = null;
    expect(create().lockState()).toBe('unlocked');
    session({});
    expect(create().lockState()).toBe('unknown');
  });
  it.each(['missing', 'wrong type', 'no root', 'no session', 'wrong session type'])('never converts %s lock evidence into unlocked', failure => {
    if (failure === 'missing') native.state.registry = null;
    if (failure === 'wrong type') native.state.registry = native.number(0);
    if (failure === 'no root') native.state.root = 0;
    if (failure === 'no session') native.state.session = null;
    if (failure === 'wrong session type') native.state.session = native.boolean(false);
    expect(create().lockState()).toBe('unknown');
  });
  it('rejects malformed session fields instead of falling back to an unlocked root flag', () => {
    session({ CGSSessionScreenIsLocked: native.number(0) });
    expect(create().lockState()).toBe('unknown');
    session({ kCGSSessionOnConsoleKey: native.number(1) });
    expect(create().lockState()).toBe('unknown');
  });
  it.each(['CoreFoundation', 'IOKit'])('preserves valid clock and input when %s lock APIs are unavailable', library => {
    native.state.libraryFailure = library;
    const provider = create();
    expect(provider.nowMs()).toBe(250);
    expect(provider.combinedIdleMs()).toBe(2000);
    expect(provider.mouseIdleMs()).toBe(3000);
    expect(provider.lockState()).toBe('unknown');
  });
  it('cleans up partially allocated session keys without disabling clock/input', () => {
    native.state.keyFailure = 'kCGSSessionUserIDKey';
    const provider = create();
    expect(provider.lockState()).toBe('unknown'); expect(provider.nowMs()).toBe(250);
    expect(native.state.released).toEqual(native.state.keys);
    provider.dispose(); expect(native.state.released).toEqual(native.state.keys);
  });
  it('preserves clock and input when an optional session function cannot be bound', () => {
    native.state.functionFailure = 'CGSessionCopyCurrentDictionary';
    const provider = create();
    expect(provider.lockState()).toBe('unknown'); expect(provider.nowMs()).toBe(250);
    expect(provider.combinedIdleMs()).toBe(2000); expect(native.state.keys).toEqual([]);
  });
  it('releases root handles and session dictionaries after a registry read failure', () => {
    native.state.propertyFailure = true;
    const provider = create();
    expect(() => provider.lockState()).toThrow('registry fault');
    expect(native.state.released).toEqual([native.state.session]);
    expect(native.state.releasedEntries).toEqual([7]);
  });
  it('disposes owned keys once and never reads a released key', () => {
    const provider = create(); provider.dispose(); provider.dispose();
    expect(native.state.released).toEqual(native.state.keys);
    expect(provider.lockState()).toBe('unknown');
    expect(native.state.releasedEntries).toEqual([]);
  });
  it('includes move, buttons, drag and scroll while excluding keyboard event types', () => {
    expect(create().mouseIdleMs()).toBe(3000);
    expect(native.state.events).toEqual([1, 2, 3, 4, 5, 6, 7, 22, 25, 26, 27]);
  });
  it.each([Infinity, NaN, -1])('refuses invalid mouse event ages (%s) even when another mouse type has a valid age', invalid => {
    native.state.invalidMouse = invalid;
    expect(() => create().mouseIdleMs()).toThrow('系统返回了无效的空闲时间');
  });
  it.each([{ numer: 0, denom: 3 }, { numer: 125, denom: 0 }])('rejects unusable timebase $numer / $denom', base => {
    Object.assign(native.state, base);
    expect(create).toThrow('连续时钟不可用');
    expect(native.state.keys).toEqual([]);
  });
});
