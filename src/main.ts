import './ui/styles.css';
import { App } from './ui/app';

declare global {
  interface Window {
    /** Exposed only so the browser smoke test can read state; nothing in the app reads it. */
    applianceApp?: App;
  }
}

function boot(): void {
  try {
    window.applianceApp = new App();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const banner = document.getElementById('audio-status');
    if (banner) {
      banner.textContent = `The instrument failed to start: ${message}`;
      banner.dataset['tone'] = 'warn';
    }
    throw error;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
