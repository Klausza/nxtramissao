import { app, BrowserWindow, desktopCapturer, ipcMain, shell } from 'electron';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import loopback from 'loopback-capture';

const publicUrl = process.env.PUBLIC_URL || 'https://nxtramissao.onrender.com';
let mainWindow: BrowserWindow | undefined;
let audioCapture: InstanceType<typeof loopback.LoopbackCapture> | undefined;

// O id de fonte do desktopCapturer e "window:<HWND>:<n>": o numero e o handle da janela,
// nunca um PID. O WASAPI process loopback precisa do PID dono da janela, e em navegador
// precisa do processo raiz, porque o Chromium toca o som num filho (audio service) que so
// entra na captura via includeProcessTree.
function rootProcessIdScript(handle: number) {
  return `
$Handle = ${handle}
Add-Type -Namespace W -Name N -MemberDefinition '[DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);'
$owner = 0
[void][W.N]::GetWindowThreadProcessId([IntPtr]$Handle, [ref]$owner)
if ($owner -eq 0) { Write-Output 0; exit }
$all = @{}
Get-CimInstance Win32_Process | ForEach-Object { $all[[int]$_.ProcessId] = $_ }
$cur = $all[$owner]
if ($null -eq $cur) { Write-Output $owner; exit }
while ($true) {
  $parent = $all[[int]$cur.ParentProcessId]
  if ($null -eq $parent -or $parent.Name -ne $cur.Name) { break }
  $cur = $parent
}
Write-Output $cur.ProcessId
`;
}

function processIdForWindow(handle: number): Promise<number> {
  if (!Number.isSafeInteger(handle) || handle <= 0) return Promise.resolve(0);
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', rootProcessIdScript(handle)], { timeout: 15000, windowsHide: true }, (error, stdout) => {
      if (error) { console.warn(`Nao resolvi o PID da janela ${handle}: ${error.message}`); return resolve(0); }
      resolve(Number(String(stdout).trim().split(/\r?\n/).pop()) || 0);
    });
  });
}

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
  return sources.map((source) => ({ id: source.id, name: source.name, handle: Number(source.id.match(/^window:(\d+):/)?.[1] || 0), thumbnail: source.thumbnail.toDataURL() }));
});
ipcMain.handle('audio:start-process', async (_event, handle: number) => {
  audioCapture?.stop();
  audioCapture = undefined;
  if (!handle) return { ok: false, message: 'Tela inteira nao tem audio por aplicativo. Escolha uma janela ou use o audio do sistema.' };
  const pid = await processIdForWindow(handle);
  if (!pid) return { ok: false, message: 'Nao consegui identificar o processo desta janela.' };
  try {
    const capture = new loopback.LoopbackCapture();
    capture.start(pid, true, (chunk) => mainWindow?.webContents.send('audio:chunk', chunk));
    audioCapture = capture;
    return { ok: true, pid };
  } catch (error) {
    return { ok: false, message: `Windows recusou a captura deste processo: ${(error as Error).message}` };
  }
});
ipcMain.handle('audio:stop', () => { audioCapture?.stop(); audioCapture = undefined; });
// O codigo da sala e derivado deste segredo, entao guarda-lo em disco e o que faz o link
// sobreviver a restart do servidor e a reinstalacao do proprio app.
function secretFile() { return path.join(app.getPath('userData'), 'room-secret'); }
function roomSecret() {
  try {
    const saved = fs.readFileSync(secretFile(), 'utf8').trim();
    if (saved.length >= 24) return saved;
  } catch {}
  const secret = crypto.randomBytes(32).toString('hex');
  try { fs.mkdirSync(path.dirname(secretFile()), { recursive: true }); fs.writeFileSync(secretFile(), secret); } catch {}
  return secret;
}

ipcMain.handle('config:room-secret', () => roomSecret());
ipcMain.handle('config:rotate-room-secret', () => { try { fs.rmSync(secretFile(), { force: true }); } catch {} return roomSecret(); });
ipcMain.handle('shell:open-external', (_event, url: string) => shell.openExternal(url));
ipcMain.handle('config:public-url', () => publicUrl.replace(/\/$/, ''));

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => { audioCapture?.stop(); });
