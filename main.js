// 추억의 뽑기판 - 프로그램 본체(창 띄우기, 파일 저장)
const { app, BrowserWindow, ipcMain, dialog, Menu, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// 버튼을 누르기 전에도 효과음이 나오도록 허용합니다.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// 애니메이션을 그래픽 카드로 그리게 해서 끊김을 줄입니다.
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

let win = null;

const dataDir = () => app.getPath('userData');
const stateFile = () => path.join(dataDir(), 'state.json');
const imageDir = () => path.join(dataDir(), 'images');

function readState() {
  for (const f of [stateFile(), stateFile() + '.bak']) {
    try {
      const data = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (data && typeof data === 'object') return data;
    } catch (e) { /* 파일이 없거나 깨졌으면 다음 후보를 봅니다 */ }
  }
  return null;
}

// 쓰는 도중 전원이 꺼져도 파일이 깨지지 않도록 임시 파일에 쓴 뒤 바꿔치기합니다.
function writeState(data) {
  fs.mkdirSync(dataDir(), { recursive: true });
  const tmp = stateFile() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  try { if (fs.existsSync(stateFile())) fs.copyFileSync(stateFile(), stateFile() + '.bak'); } catch (e) { /* 백업 실패는 무시 */ }
  fs.renameSync(tmp, stateFile());
}

// 자체 점검용: `--smoke` 로 실행하면 창을 보이지 않게 띄워 화면이 정상적으로 뜨는지만 확인하고 끝냅니다.
const SMOKE = process.argv.includes('--smoke');

function createWindow() {
  const saved = readState();
  // 기본은 창 모드. 사용자가 전체 화면을 켜 둔 채 끝냈을 때만 전체 화면으로 시작합니다.
  const fullscreen = !SMOKE && !!(saved && saved.version >= 2 && saved.settings && saved.settings.fullscreen === true);
  win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 640,
    minHeight: 480,
    show: !SMOKE,
    fullscreen,
    autoHideMenuBar: true,
    backgroundColor: '#DCE3F2',
    title: 'Gen Z Lab. 뽑기판',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('closed', () => { win = null; });
  if (SMOKE) {
    win.webContents.on('console-message', (e, level, message) => { if (level >= 2) console.log('RENDERER-ERROR: ' + message); });
    win.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 1500));
      const report = await win.webContents.executeJavaScript(`JSON.stringify({
        api: !!window.api,
        phase: window.App && App.phase,
        cells: window.App && App.board && App.board.cells.length,
        drawn: document.querySelectorAll('#board .cell').length,
        title: document.getElementById('title').textContent,
        font: document.fonts.check('40px Jua'),
        admin: typeof window.Admin,
        samples: Object.keys(Sound.sampleInfo()).sort().join('+')
      })`).catch((err) => 'ERROR ' + err.message);
      console.log('SMOKE ' + report);
      app.quit();
    });
    win.webContents.once('did-fail-load', (e, code, desc) => { console.log('SMOKE LOAD-FAILED ' + desc); app.quit(); });
  }
  // 행사 중 화면이 꺼지거나 절전으로 들어가지 않게 합니다.
  powerSaveBlocker.start('prevent-display-sleep');
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}

ipcMain.handle('state:load', () => readState());
ipcMain.handle('state:save', (e, data) => { writeState(data); return true; });

ipcMain.handle('win:setFullscreen', (e, on) => { if (win) win.setFullScreen(!!on); return true; });
ipcMain.handle('win:isFullscreen', () => (win ? win.isFullScreen() : false));
ipcMain.handle('app:quit', () => { app.quit(); });

ipcMain.handle('file:exportText', async (e, { text, defaultName, filterName, ext }) => {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('documents'), defaultName),
    filters: [{ name: filterName, extensions: [ext] }]
  });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, text, 'utf8');
  return r.filePath;
});

ipcMain.handle('file:importText', async (e, { filterName, ext }) => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: filterName, extensions: [ext] }]
  });
  if (r.canceled || !r.filePaths.length) return null;
  return fs.readFileSync(r.filePaths[0], 'utf8');
});

// 고른 이미지를 프로그램 데이터 폴더로 복사해 둡니다(원본을 옮기거나 지워도 안전).
ipcMain.handle('file:pickImage', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: '이미지', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
  });
  if (r.canceled || !r.filePaths.length) return null;
  const src = r.filePaths[0];
  fs.mkdirSync(imageDir(), { recursive: true });
  const name = Date.now().toString(36) + path.extname(src).toLowerCase();
  const dest = path.join(imageDir(), name);
  fs.copyFileSync(src, dest);
  return pathToFileURL(dest).href;
});
