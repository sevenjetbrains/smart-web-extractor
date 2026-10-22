import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../components/base.css';
import { SidePanel } from './SidePanel';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SidePanel />
  </StrictMode>,
);
