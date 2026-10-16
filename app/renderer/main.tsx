import { createRoot } from 'react-dom/client';
import './bridge';
import { App } from './App';
import { Overlay } from './Overlay';
import './styles.css';

const surface = new URLSearchParams(window.location.search).get('surface');
document.body.dataset.surface = surface ?? 'main';
createRoot(document.getElementById('root')!).render(surface === 'overlay' ? <Overlay/> : <App tray={surface === 'tray'}/>);
