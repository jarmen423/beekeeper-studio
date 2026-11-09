import { installBrowserMain } from '@/lib/browserMain';

installBrowserMain();
import('./renderer').catch(error => {
  document.getElementById('app').textContent = error.message;
  console.error(error);
});
if ('serviceWorker' in navigator && (import.meta as unknown as { env: { PROD: boolean } }).env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(error => console.warn('Offline shell unavailable', error));
  });
}
