import { serverPaths } from './webPaths';
import { createPortBridge } from './webPortBridge';
import { encodeMessage } from '@/common/wireCodec';

export async function fetchApi(route: string) {
  const response = await fetch(`/api/${route}`, { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new Error(`Server request failed (${response.status}). Open the tokenized server URL to sign in.`);
  return response.json();
}

export function openBrowserLink(link: string) {
  try {
    const url = new URL(link);
    if (['http:', 'https:', 'mailto:'].includes(url.protocol)) window.open(url.href, '_blank', 'noopener,noreferrer');
  } catch { /* Invalid links are ignored. */ }
}

export function installBrowserMain() {
  const noop = () => {};
  const died = new Set<(...args: any[]) => void>();
  const bridge = createPortBridge((port, sId, utilDied) => {
    window.postMessage({ type: 'port', sId, utilDied }, '*', [port]);
    if (utilDied) setTimeout(() => died.forEach(callback => callback()), 0);
  });
  const paths = () => serverPaths(window.platformInfo.isWindows, window.platformInfo.homeDirectory);
  function pick(options: any = {}, multiple = false) {
    const value = window.prompt(`Server-side ${options.properties?.includes('openDirectory') ? 'directory' : 'file'} path${multiple ? ' (one per line)' : ''}:`, options.defaultPath || '');
    return value?.trim() ? value.split(/\r?\n/).map(path => path.trim()).filter(Boolean) : undefined;
  }
  const api = {
    async requestPlatformInfo() { window.platformInfo = await fetchApi('platform-info'); },
    async requestBksConfigSource() { window.bksConfigSource = await fetchApi('bks-config-source'); },
    attachPortListener: noop,
    requestPorts: () => bridge.start(),
    onUtilDied: (callback: (...args: any[]) => void) => died.add(callback),
    isReady: noop, enableConnectionMenuItems: noop, disableConnectionMenuItems: noop,
    sendUserActive: noop, send: noop, on: noop, onUpdateEvent: noop,
    updaterReady: noop, triggerDownload: noop, triggerInstall: noop,
    openExternally: openBrowserLink, openLink: openBrowserLink,
    resolve: (...parts: string[]) => paths().resolve(...parts),
    join: (...parts: string[]) => paths().join(...parts),
    basename: (path: string, ext?: string) => paths().basename(path, ext),
    readVimrc: () => [],
    defaultExportPath: async (filename = '') => paths().join(window.platformInfo.homeDirectory, filename),
    showOpenDialogSync: (options: any) => pick(options, options?.properties?.includes('multiSelections')),
    showSaveDialogSync: (options: any) => pick(options)?.[0],
    onMaximize: noop, onUnmaximize: noop, onEnterFullscreen: noop, onLeaveFullscreen: noop,
    isMaximized: async () => false, isFullscreen: async () => false,
    setFullScreen: noop, minimizeWindow: noop, unmaximizeWindow: noop, maximizeWindow: noop, closeWindow: noop,
    async writeTextToClipboard(text: string) { await navigator.clipboard.writeText(text); },
    async writeImageToClipboard(dataUrl: string) {
      const blob = await (await fetch(dataUrl)).blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    },
    readTextFromClipboard: () => navigator.clipboard.readText(),
    showItemInFolder: noop, setTlsMinVersion: noop,
    fetchUsername: () => fetchApi('username'),
    setWindowTitle: (title: string) => { document.title = title; },
    hasSshKeysPlug: () => false,
    fileHelpers: {
      async save(options: any) {
        const targetPath = pick({ defaultPath: paths().resolve(options.fileName) })?.[0];
        if (!targetPath) return false;
        const response = await fetch('/api/save-file', {
          method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
          body: encodeMessage({ ...options, path: targetPath }),
        });
        if (!response.ok) throw new Error(await response.text());
        return true;
      },
    },
    addNativeMenuItem: noop, removeNativeMenuItem: noop,
  };
  window.main = api as unknown as typeof window.main;
  window.addEventListener('pagehide', () => bridge.stop(), { once: true });
}
