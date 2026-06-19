import { createRoot } from 'react-dom/client';
import { AppErrorBoundary } from './AppErrorBoundary';
import './panels.css';

async function boot(): Promise<void> {
  const root = document.getElementById('root');
  if (!root) return;

  try {
    const { App } = await import('./App');
    createRoot(root).render(
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>,
    );
  } catch (err) {
    const boot = document.getElementById('boot-msg');
    if (boot) {
      boot.textContent = `Failed to load: ${err instanceof Error ? err.message : String(err)}`;
    } else {
      root.textContent = err instanceof Error ? err.message : String(err);
    }
  }
}

void boot();
