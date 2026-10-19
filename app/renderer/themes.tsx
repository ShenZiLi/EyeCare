import { Check, Laptop, Moon, Palette, Sun } from 'lucide-react';
import type { ThemePreference } from '../shared/contracts';
import { Icon } from './components';
import restArtwork from './assets/handdrawn-rest.png';
import sidebarArtwork from './assets/handdrawn-sidebar.png';

/** Bundled theme metadata. A new theme supplies a preview without changing settings UI. */
export const themes = [
  { id: 'light', label: '亮色', icon: Sun },
  { id: 'dark', label: '暗色', icon: Moon },
  { id: 'system', label: '跟随系统', icon: Laptop },
  { id: 'handdrawn', label: '手绘', icon: Palette },
] as const satisfies readonly { id: ThemePreference; label: string; icon: typeof Sun }[];

export function ThemeChoices({ value, onChange }: { value: ThemePreference; onChange: (theme: ThemePreference) => void }) {
  return <div className="theme-choices" role="group" aria-label="应用主题">{themes.map(theme => <button key={theme.id} className={`theme-card ${value === theme.id ? 'selected' : ''}`} aria-pressed={value === theme.id} data-static onClick={() => onChange(theme.id)}>
    <span className={`theme-preview theme-preview-${theme.id}`} aria-hidden="true"><span className="preview-sky"/><span className="preview-window"><span className="preview-dots"/><span className="preview-sidebar"/><span className="preview-lines"><i/><i/><i/></span></span>{theme.id === 'handdrawn' && <img src={restArtwork} width="72" height="48" alt=""/>}</span>
    <span className="theme-caption"><Icon icon={theme.icon} size={15}/>{theme.label}{value === theme.id && <span className="theme-check"><Icon icon={Check} size={14}/></span>}</span>
  </button>)}</div>;
}

export function BotanicalDoodle() {
  return <div className="sidebar-artwork" aria-hidden="true"><svg className="botanical-doodle" viewBox="0 0 120 160" fill="none" aria-hidden="true">
    <g stroke="#647a4e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M55 146C62 111 53 72 69 30M64 92C84 85 91 72 93 59M58 119C36 104 27 87 29 68"/>
      <path d="M66 51C48 49 40 34 43 22C60 24 68 36 66 51Z" fill="#b0c38b"/>
      <path d="M68 38C65 20 76 9 88 7C90 22 82 34 68 38Z" fill="#9eb87f"/>
      <path d="M62 82C45 80 38 67 41 57C55 58 63 67 62 82Z" fill="#bdd29c"/>
      <path d="M77 79C77 64 87 53 100 53C99 67 91 77 77 79Z" fill="#a5bd83"/>
      <path d="M43 101C25 100 15 89 16 77C31 76 41 85 43 101Z" fill="#afc58c"/>
    </g>
    <g stroke="#ad795c" strokeWidth="1.4"><path d="M86 140L90 114M90 122L104 108"/><path d="M27 142L23 120"/>
      <path d="M89 114C74 109 80 101 87 106C86 93 98 94 96 105C108 101 111 111 99 113C107 123 95 128 92 117C84 126 76 120 89 114Z" fill="#ebaf9a"/>
      <path d="M23 120C13 121 14 111 21 113C15 103 25 99 27 110C36 104 41 113 30 117C40 125 31 130 26 121C23 132 15 128 23 120Z" fill="#d1bbdb"/>
    </g>
    <path d="M32 36L35 29L38 36L45 39L38 42L35 49L32 42L25 39Z" stroke="#d6a645" strokeWidth="1.8"/>
    <path d="M8 150Q54 143 112 150" stroke="#b7c68d" strokeWidth="3" strokeLinecap="round"/>
  </svg><img src={sidebarArtwork} width="1536" height="1024" alt=""/></div>;
}
