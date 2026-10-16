import { createRoot } from 'react-dom/client';
import './bridge';
import { Overlay } from './Overlay';
import './styles.css';

createRoot(document.getElementById('root')!).render(<Overlay/>);
