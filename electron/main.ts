import { app, BrowserWindow, desktopCapturer, ipcMain, shell } from 'electron';
import path from 'node:path';

const publicUrl = process.env.PUBLIC_URL || (process.env.NODE_ENV === 'production' ? 'https://stream.example.com' : 'http://localhost:8080');

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
  window.loadFile(path.join(__dirname, 'host.html'));
}

ipcMain.handle('desktop:list-sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } });
  return sources.map((source) => ({ id: source.id, name: source.name, thumbnail: source.thumbnail.toDataURL() }));
});
ipcMain.handle('shell:open-external', (_event, url: string) => shell.openExternal(url));
ipcMain.handle('config:public-url', () => publicUrl.replace(/\/$/, ''));

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
