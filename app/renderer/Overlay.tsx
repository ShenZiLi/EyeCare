import { useEffect, useRef, useState } from 'react';
import { Eye, X } from 'lucide-react';
import type { ChannelResult, OverlayState, ReminderAction } from '../shared/contracts';
import { applyAppearance, Icon } from './components';
import gentle from './assets/gentle.wav?url';

export function Overlay() {
  const [state, setState] = useState<OverlayState | null>(null);
  useEffect(() => {
    let alive = true;
    const receive = (value: OverlayState | null) => { if (alive) { setState(value); if (value) applyAppearance(value); } };
    const unsubscribe = window.eyeCare.subscribeOverlay(receive);
    void window.eyeCare.getOverlay().then(receive).catch(() => setState(null));
    return () => { alive = false; unsubscribe(); };
  }, []);
  if (!state) return null;
  return <OverlayEvent key={`${state.event.id}:${state.event.generation}`} state={state}/>;
}

function OverlayEvent({ state }: { state: OverlayState }) {
  const flash = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const event = state.event;
  const settings = event.settings.reminder;
  const mask = settings.visual === 'mask';
  const resolve = async (action: ReminderAction) => {
    if (busy) return;
    setBusy(true);
    try { const result = await window.eyeCare.resolveReminder(event.id, event.generation, action); if (!result.ok) { setError(result.error.message); setBusy(false); } }
    catch { setError('操作未完成，请重试或按 Escape 跳过。'); setBusy(false); }
  };
  useEffect(() => {
    if (!mask) return;
    panel.current?.querySelector<HTMLButtonElement>('.primary')?.focus();
    const key = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === 'Escape') { keyEvent.preventDefault(); void resolve('skip'); }
      if (keyEvent.key !== 'Tab') return;
      const elements = [...(panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
      const first = elements[0]; const last = elements.at(-1);
      if (!elements.includes(document.activeElement as HTMLButtonElement)) { keyEvent.preventDefault(); first?.focus(); return; }
      if (keyEvent.shiftKey && document.activeElement === first) { keyEvent.preventDefault(); last?.focus(); }
      if (!keyEvent.shiftKey && document.activeElement === last) { keyEvent.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  });
  useEffect(() => {
    let alive = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let animation: Animation | undefined;
    let audio: HTMLAudioElement | undefined;
    let audioReported = false;
    const report = (result: ChannelResult) => { if (alive) void window.eyeCare.overlayFinished(event.id, event.generation, [result]).catch(() => { /* Main-process cancellation or teardown can race completion. */ }); };
    if (settings.soundEnabled) {
      audio = new Audio(gentle);
      audio.volume = settings.volumePercent / 100;
      audio.loop = false;
      const finishSound = (success: boolean, message: string) => { if (audioReported) return; audioReported = true; report({ channel: 'sound', success, message }); };
      audio.onended = () => finishSound(true, '内置音效播放完成');
      audio.onerror = () => finishSound(false, '无法读取或播放内置音效，请检查声音输出设备。');
    }
    void window.eyeCare.overlayReady(event.id, event.generation).then(result => {
      if (!alive || !result.ok) return;
      if (audio) void audio.play().then(() => { if (alive) return window.eyeCare.overlaySoundStarted(event.id, event.generation); }).catch(() => { if (!audioReported) { audioReported = true; report({ channel: 'sound', success: false, message: '声音播放被系统阻止或输出设备不可用。' }); } });
      if (settings.visual === 'flash') {
        const total = settings.fadeInMs + settings.holdMs + settings.fadeOutMs;
        const opacity = settings.flashOpacityPercent / 100;
        if (state.reduceMotion) { if (flash.current) flash.current.style.opacity = String(opacity); }
        else animation = flash.current?.animate([{ opacity: 0, offset: 0 }, { opacity, offset: settings.fadeInMs / total }, { opacity, offset: (settings.fadeInMs + settings.holdMs) / total }, { opacity: 0, offset: 1 }], { duration: total, easing: 'linear', fill: 'forwards' });
        timeout = setTimeout(() => report({ channel: 'visual', success: true, message: state.reduceMotion ? '静态提示已结束' : '柔和闪屏已结束' }), total);
      }
    }).catch(() => { report({ channel: 'visual', success: false, message: '提醒窗口无法连接桌面服务。' }); });
    return () => { alive = false; if (timeout) clearTimeout(timeout); animation?.cancel(); if (audio) { audio.pause(); audio.onended = null; audio.onerror = null; audio.removeAttribute('src'); audio.load(); } };
    // A reminder consumes its creation-time parameters. Later appearance updates do not restart sound or the visual cycle.
  }, [event.id, event.generation]);
  if (settings.visual === 'flash') return <div ref={flash} className="flash-overlay" style={{ backgroundColor: settings.flashColor }} aria-hidden="true"/>;
  if (!mask) return null;
  return <div className="rest-backdrop"><div className="rest-panel" ref={panel} role="dialog" aria-modal="true" aria-labelledby="rest-title"><button className="rest-skip icon-button" aria-label="跳过本次提醒" disabled={busy} onClick={() => void resolve('skip')}><Icon icon={X}/></button><span className="rest-icon"><Icon icon={Eye} size={36}/></span><span className="eyebrow">{event.kind === 'preview' ? '提醒效果预览' : '给视线一点休息'}</span><h1 id="rest-title">{settings.message}</h1>{error && <p className="field-error" role="alert">{error}</p>}<div className="rest-actions"><button className="primary" disabled={busy} onClick={() => void resolve('acknowledge')}>知道了</button></div></div></div>;
}
