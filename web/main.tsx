import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import { App } from './App';
import './styles/theme.css';
import './styles/app.css';
document.documentElement.dataset.theme = (() => { try { const s = localStorage.getItem('tavola-theme'); if (s === 'light' || s === 'dark') return s; } catch { /* ignore */ } return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; })();
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
