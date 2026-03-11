import './utils/dayjs';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { useThemeStore, applyTheme } from './store/theme';

// Apply theme on initial load
applyTheme(useThemeStore.getState().mode);

// Listen for system theme changes
const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
mediaQuery.addEventListener('change', () => {
  const { mode } = useThemeStore.getState();
  if (mode === 'system') applyTheme('system');
});

// Sync theme when store changes
useThemeStore.subscribe((state) => applyTheme(state.mode));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
