import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('screenShare', {
  listSources: () => ipcRenderer.invoke('desktop:list-sources'),
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
  publicUrl: () => ipcRenderer.invoke('config:public-url')
});
