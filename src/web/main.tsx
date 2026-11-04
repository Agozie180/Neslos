import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { lazy, Suspense } from 'react';
import './styles.css';
const OwnerApp = lazy(() => import('./OwnerApp.js').then(module => ({ default: module.OwnerApp })));
createRoot(document.getElementById('root')!).render(location.pathname === '/owner' ? <Suspense fallback={<p>Opening owner workspace…</p>}><OwnerApp /></Suspense> : <App />);
