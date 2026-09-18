import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('screenShare', {
  listSources: () => ipcRenderer.invoke('desktop:list-sources'),
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
  publicUrl: () => ipcRenderer.invoke('config:public-url'),
  roomSecret: () => ipcRenderer.invoke('config:room-secret'),
  rotateRoomSecret: () => ipcRenderer.invoke('config:rotate-room-secret'),
  startProcessAudio: (handle: number) => ipcRenderer.invoke('audio:start-process', handle),
  stopProcessAudio: () => ipcRenderer.invoke('audio:stop'),
  onAudioChunk: (listener: (chunk: Uint8Array) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, chunk: Uint8Array) => listener(chunk);
    ipcRenderer.on('audio:chunk', handler);
    return () => ipcRenderer.removeListener('audio:chunk', handler);
  }
});
