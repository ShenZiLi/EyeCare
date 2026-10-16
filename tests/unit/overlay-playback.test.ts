import { afterEach, describe, expect, it, vi } from 'vitest';
import { startOverlayPlayback } from '../../app/renderer/overlay-playback';
import { defaultSettings, resolveSettings, type EyeCareBridge, type OverlayState, type Result } from '../../app/shared/contracts';

function fixture(reduceMotion = false, sound = false) {
  const order: string[] = [];
  let accept!: (result: Result<null>) => void;
  let reject!: (reason: Error) => void;
  const readiness = new Promise<Result<null>>((resolve, fail) => { accept = resolve; reject = fail; });
  let finishAnimation!: () => void;
  let failAnimation!: () => void;
  const finished = new Promise<void>((resolve, reject) => { finishAnimation = resolve; failAnimation = () => reject(new Error('cancelled')); });
  const animation = { finished, pause: vi.fn(() => order.push('pause')), currentTime: null as number | null, play: vi.fn(() => order.push('play')), cancel: vi.fn(() => failAnimation()) };
  const flash = { style: { opacity: '' }, animate: vi.fn(() => { order.push('prepare'); return animation; }) };
  const audio = { volume: 0, loop: false, onended: null, onerror: null, play: vi.fn(() => Promise.resolve()), pause: vi.fn(), removeAttribute: vi.fn(), load: vi.fn() };
  vi.stubGlobal('Audio', class { constructor() { return audio; } });
  const bridge = { overlayReady: vi.fn(() => { order.push('ready'); return readiness; }), overlayFinished: vi.fn(async () => ({ ok: true, value: null })), overlaySoundStarted: vi.fn(async () => ({ ok: true, value: null })) };
  const settings = defaultSettings(); settings.reminder.soundEnabled = sound;
  const state: OverlayState = { event: { id: 'preview-1', generation: 7, kind: 'preview', settings: resolveSettings(settings), screenIds: [], createdAtMs: 0 }, theme: 'dark', reduceMotion, reduceTransparency: false };
  const stop = () => startOverlayPlayback(state, flash as unknown as HTMLDivElement, bridge as unknown as EyeCareBridge, 'gentle.wav');
  return { order, accept, reject, finishAnimation, failAnimation, animation, flash, audio, bridge, state, stop };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('overlay first-frame lifecycle', () => {
  it('prepares a paused zero-opacity cycle before readiness, retaining its full duration after delay', async () => {
    vi.useFakeTimers(); const f = fixture(false, true); const stop = f.stop();
    expect(f.order).toEqual(['prepare', 'pause', 'ready']);
    expect(f.animation.currentTime).toBe(0); expect(f.flash.style.opacity).toBe('0');
    expect(f.flash.animate).toHaveBeenCalledWith([{ opacity: 0, offset: 0 }, { opacity: .9, offset: .3 }, { opacity: .9, offset: .7 }, { opacity: 0, offset: 1 }], { duration: 2000, easing: 'linear', fill: 'forwards' });
    await vi.advanceTimersByTimeAsync(10000);
    expect(f.animation.play).not.toHaveBeenCalled(); expect(f.audio.play).not.toHaveBeenCalled(); expect(f.bridge.overlayFinished).not.toHaveBeenCalled();
    f.accept({ ok: true, value: null }); await flush();
    expect(f.animation.play).toHaveBeenCalledTimes(1); expect(f.audio.play).toHaveBeenCalledTimes(1);
    expect(f.bridge.overlaySoundStarted).toHaveBeenCalledWith('preview-1', 7);
    await vi.advanceTimersByTimeAsync(1999); expect(f.bridge.overlayFinished).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(501); expect(f.bridge.overlayFinished).not.toHaveBeenCalled();
    f.finishAnimation(); await flush(); expect(f.bridge.overlayFinished).toHaveBeenCalledTimes(1);
    expect(f.bridge.overlayFinished).toHaveBeenCalledWith('preview-1', 7, [expect.objectContaining({ channel: 'visual', success: true })]);
    stop(); stop(); expect(f.animation.cancel).toHaveBeenCalledTimes(1); expect(f.audio.load).toHaveBeenCalledTimes(1);
  });
  it('prepares the static reduction before show and starts its lifetime after acceptance', async () => {
    vi.useFakeTimers(); const f = fixture(true); const stop = f.stop();
    expect(f.flash.style.opacity).toBe('0.9'); expect(f.flash.animate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000); expect(f.bridge.overlayFinished).not.toHaveBeenCalled();
    f.accept({ ok: true, value: null }); await flush();
    await vi.advanceTimersByTimeAsync(2000); expect(f.bridge.overlayFinished).toHaveBeenCalledWith('preview-1', 7, [{ channel: 'visual', success: true, message: '静态提示已结束' }]); stop();
  });
  it('never plays or reports after teardown while readiness is pending', async () => {
    vi.useFakeTimers(); const f = fixture(false, true); const stop = f.stop(); stop();
    f.accept({ ok: true, value: null }); await flush(); await vi.runAllTimersAsync();
    expect(f.animation.play).not.toHaveBeenCalled(); expect(f.audio.play).not.toHaveBeenCalled(); expect(f.bridge.overlayFinished).not.toHaveBeenCalled(); expect(f.animation.cancel).toHaveBeenCalledTimes(1);
  });
  it('disposes prepared media for stale readiness without playback or completion', async () => {
    const f = fixture(false, true); const stop = f.stop(); f.accept({ ok: false, error: { code: 'STALE', message: 'cancelled' } }); await flush(); stop();
    expect(f.animation.cancel).toHaveBeenCalledTimes(1); expect(f.audio.load).toHaveBeenCalledTimes(1); expect(f.animation.play).not.toHaveBeenCalled(); expect(f.bridge.overlayFinished).not.toHaveBeenCalled();
  });
  it('reports readiness failure once and cleans up; late rejection after teardown is silent', async () => {
    const f = fixture(false, true); const stop = f.stop(); f.reject(new Error('offline')); await flush(); stop();
    expect(f.bridge.overlayFinished).toHaveBeenCalledTimes(1); expect(f.animation.cancel).toHaveBeenCalledTimes(1); expect(f.audio.play).not.toHaveBeenCalled();
    const late = fixture(); const cancel = late.stop(); cancel(); late.reject(new Error('offline')); await flush(); expect(late.bridge.overlayFinished).not.toHaveBeenCalled();
  });
  it('cancels a started cycle without a late visual completion', async () => {
    vi.useFakeTimers(); const f = fixture(); const stop = f.stop(); f.accept({ ok: true, value: null }); await flush(); stop();
    await vi.runAllTimersAsync(); expect(f.bridge.overlayFinished).not.toHaveBeenCalled();
  });
  it('reports an unexpected animation rejection once and disposes media', async () => {
    const f = fixture(false, true); f.stop(); f.accept({ ok: true, value: null }); await flush();
    f.failAnimation(); await flush();
    expect(f.bridge.overlayFinished).toHaveBeenCalledTimes(1);
    expect(f.bridge.overlayFinished).toHaveBeenCalledWith('preview-1', 7, [expect.objectContaining({ channel: 'visual', success: false })]);
    expect(f.flash.style.opacity).toBe('0'); expect(f.audio.pause).toHaveBeenCalledTimes(1);
  });
  it('ignores queued animation completion after disposal', async () => {
    const f = fixture(); const stop = f.stop(); f.accept({ ok: true, value: null }); await flush();
    f.finishAnimation(); stop(); await flush();
    expect(f.bridge.overlayFinished).not.toHaveBeenCalled();
  });
  it.each(['mask', 'none'] as const)('keeps %s visual ownership intact and reports sound exactly once', async visual => {
    vi.useFakeTimers(); const f = fixture(false, true); f.state.event.settings.reminder.visual = visual;
    const stop = f.stop(); f.accept({ ok: true, value: null }); await flush();
    expect(f.flash.animate).not.toHaveBeenCalled(); expect(f.audio.play).toHaveBeenCalledTimes(1);
    const ended = f.audio.onended as unknown as () => void; const failed = f.audio.onerror as unknown as () => void;
    ended(); failed(); await vi.runAllTimersAsync();
    expect(f.bridge.overlayFinished).toHaveBeenCalledTimes(1);
    expect(f.bridge.overlayFinished).toHaveBeenCalledWith('preview-1', 7, [expect.objectContaining({ channel: 'sound', success: true })]);
    stop();
  });
});
