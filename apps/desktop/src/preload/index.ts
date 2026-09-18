import { contextBridge, ipcRenderer } from "electron";

function on(channel: string, cb: (...args: unknown[]) => void) {
  const handler = (_e: Electron.IpcRendererEvent, ...args: unknown[]) => cb(...args);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const api = {
  minimize: () => ipcRenderer.invoke("window:minimize") as Promise<void>,
  close: () => ipcRenderer.invoke("window:close") as Promise<void>,
  togglePin: () => ipcRenderer.invoke("window:togglePin") as Promise<boolean>,
  isPinned: () => ipcRenderer.invoke("window:isPinned") as Promise<boolean>,
  setCompact: (next: boolean) => ipcRenderer.invoke("window:setCompact", next) as Promise<void>,
  isCompact: () => ipcRenderer.invoke("window:isCompact") as Promise<boolean>,
  /** minimalista: true = cliques atravessam a janela (cursor fora do orb) */
  setIgnoreMouse: (ignore: boolean) => ipcRenderer.invoke("window:setIgnoreMouse", ignore) as Promise<void>,
  captureScreen: () => ipcRenderer.invoke("screen:capture") as Promise<string>,
  readClipboard: () => ipcRenderer.invoke("clipboard:read") as Promise<string>,
  onVoiceToggle: (cb: () => void) => on("voice:toggle", cb),
  onCompact: (cb: (compact: boolean) => void) => on("window:compact", (v) => cb(Boolean(v))),
};

contextBridge.exposeInMainWorld("aro", api);

export type AroWindowApi = typeof api;
