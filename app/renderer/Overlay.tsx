import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { OverlayState, ReminderAction } from '../shared/contracts';
import { applyAppearance, Icon } from './components';
import restArtwork from './assets/handdrawn-rest.png';
import gentle from './assets/gentle.wav?url';
import { startOverlayPlayback } from './overlay-playback';

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
    return startOverlayPlayback(state, flash.current, window.eyeCare, gentle);
    // A reminder consumes its creation-time parameters. Appearance updates must not restart playback.
  }, [event.id, event.generation]);
  if (settings.visual === 'flash') return <div ref={flash} className="flash-overlay" style={{ backgroundColor: settings.flashColor }} aria-hidden="true"/>;
  if (!mask) return null;
  return <div className="rest-backdrop"><div className="rest-panel" ref={panel} role="dialog" aria-modal="true" aria-labelledby="rest-title"><button className="rest-skip icon-button" aria-label="跳过本次提醒" disabled={busy} onClick={() => void resolve('skip')}><Icon icon={X}/></button>{state.theme === 'handdrawn' ? <img className="rest-artwork" src={restArtwork} width="360" height="240" alt="" aria-hidden="true"/> : <span className="rest-icon"><span className="rest-mark" aria-hidden="true"/></span>}<span className="eyebrow">{event.kind === 'preview' ? '提醒效果预览' : '给视线一点休息'}</span><h1 id="rest-title">{settings.message}</h1>{error && <p className="field-error" role="alert">{error}</p>}<div className="rest-actions"><button className="primary" disabled={busy} onClick={() => void resolve('acknowledge')}>知道了</button></div></div></div>;
}
