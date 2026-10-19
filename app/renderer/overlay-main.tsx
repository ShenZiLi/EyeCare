import { createRoot } from 'react-dom/client';
import './bridge';
import { Overlay } from './Overlay';
import './styles.css';
import './themes.css';

createRoot(document.getElementById('root')!).render(<Overlay/>);
