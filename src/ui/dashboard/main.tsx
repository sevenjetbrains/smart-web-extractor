import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../components/base.css';
import { Dashboard } from './Dashboard';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Dashboard />
  </StrictMode>,
);
