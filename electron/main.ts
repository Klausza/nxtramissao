import { app, BrowserWindow, desktopCapturer, ipcMain, shell } from 'electron';
import path from 'node:path';
import loopback from 'loopback-capture';

const publicUrl = process.env.PUBLIC_URL || 'https://nxtramissao.onrender.com';
let mainWindow: BrowserWindow | undefined;
let audioCapture: InstanceType<typeof loopback.LoopbackCapture> | undefined;

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 650,
    backgroundColor: '#10151d',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });
  mainWindow = window;
  window.loadFile(path.join(__dirname, 'host.html'));
}

ipcMain.handle('desktop:list-sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } });
  return sources.map((source) => ({ id: source.id, name: source.name, pid: Number(source.id.match(/^window:(\d+):/)?.[1] || 0), thumbnail: source.thumbnail.toDataURL() }));
});
ipcMain.handle('audio:start-process', (_event, pid: number) => {
  audioCapture?.stop();
  audioCapture = new loopback.LoopbackCapture();
  audioCapture.start(pid, true, (chunk) => mainWindow?.webContents.send('audio:chunk', chunk));
});
ipcMain.handle('audio:stop', () => { audioCapture?.stop(); audioCapture = undefined; });
ipcMain.handle('shell:open-external', (_event, url: string) => shell.openExternal(url));
ipcMain.handle('config:public-url', () => publicUrl.replace(/\/$/, ''));

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => { audioCapture?.stop(); });
