import type { ChannelResult, EyeCareBridge, OverlayState } from '../shared/contracts';

/** Prepare the hidden surface before readiness can show it; keep timing tied to accepted playback. */
export function startOverlayPlayback(state: OverlayState, flash: HTMLDivElement | null, bridge: EyeCareBridge, soundUrl: string): () => void {
  const { event, reduceMotion } = state;
  const settings = event.settings.reminder;
  let alive = true;
  let disposed = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let animation: Animation | undefined;
  let audio: HTMLAudioElement | undefined;
  let audioReported = false;
  const report = (result: ChannelResult) => {
    if (alive) void bridge.overlayFinished(event.id, event.generation, [result]).catch(() => { /* Cancellation may race completion. */ });
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    alive = false;
    if (timeout !== undefined) clearTimeout(timeout);
    animation?.cancel();
    if (flash) flash.style.opacity = '0';
    if (audio) { audio.onended = null; audio.onerror = null; audio.pause(); audio.removeAttribute('src'); audio.load(); }
  };
  const total = settings.fadeInMs + settings.holdMs + settings.fadeOutMs;
  try {
    if (settings.visual === 'flash' && flash) {
      const opacity = settings.flashOpacityPercent / 100;
      flash.style.opacity = reduceMotion ? String(opacity) : '0';
      if (!reduceMotion) {
        animation = flash.animate([{ opacity: 0, offset: 0 }, { opacity, offset: settings.fadeInMs / total }, { opacity, offset: (settings.fadeInMs + settings.holdMs) / total }, { opacity: 0, offset: 1 }], { duration: total, easing: 'linear', fill: 'forwards' });
        animation.pause();
        animation.currentTime = 0;
        // Hidden WebViews may delay the animation timeline after play(). A wall-clock
        // duration can therefore close a still-dark surface; settle at the real end.
        // Observe cancellation now, including teardown while readiness is pending.
        void animation.finished.then(() => {
          report({ channel: 'visual', success: true, message: '柔和闪屏已结束' });
        }, () => {
          report({ channel: 'visual', success: false, message: '柔和闪屏播放被中断。' });
          dispose();
        });
      }
    }
    if (settings.soundEnabled) {
      audio = new Audio(soundUrl);
      audio.volume = settings.volumePercent / 100;
      audio.loop = false;
      const finishSound = (success: boolean, message: string) => { if (audioReported) return; audioReported = true; report({ channel: 'sound', success, message }); };
      audio.onended = () => finishSound(true, '内置音效播放完成');
      audio.onerror = () => finishSound(false, '无法读取或播放内置音效，请检查声音输出设备。');
    }
    void bridge.overlayReady(event.id, event.generation).then(result => {
      if (!alive) return;
      if (!result.ok) { dispose(); return; }
      if (audio) void audio.play().then(() => {
        // A pending play promise can settle after teardown; stop it again in that case.
        if (!alive) { audio?.pause(); return; }
        return bridge.overlaySoundStarted(event.id, event.generation);
      }).catch(() => {
        if (!audioReported) { audioReported = true; report({ channel: 'sound', success: false, message: '声音播放被系统阻止或输出设备不可用。' }); }
      });
      if (settings.visual === 'flash') {
        animation?.play();
        if (reduceMotion) timeout = setTimeout(() => report({ channel: 'visual', success: true, message: '静态提示已结束' }), total);
        // The native coordinator's playback watchdog handles a stalled timeline.
      }
    }).catch(() => {
      report({ channel: 'visual', success: false, message: '提醒窗口无法连接桌面服务。' });
      dispose();
    });
  } catch {
    report({ channel: 'visual', success: false, message: '提醒窗口无法初始化播放。' });
    dispose();
  }
  return dispose;
}
