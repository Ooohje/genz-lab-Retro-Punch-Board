// README 용 화면 캡처를 만듭니다: `npx electron scripts/capture.js`
// 실제 설정·뽑기 기록을 건드리지 않도록 임시 폴더를 데이터 폴더로 씁니다.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'ppopgi-capture-')));
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const OUT = path.join(__dirname, '..', 'docs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 예시 상품으로 판을 채우고 몇 칸을 미리 뽑아 둡니다.
const SETUP = `
  (function () {
    var s = App.settings;
    s.volume = 0; Sound.setVolume(0);
    s.eventName = '2026 Gen Z Lab. Next UP';
    s.fillMode = 'blank';
    s.totalCells = 120;
    s.ranks = [
      { id: 'a', name: '1', prize: '무선 이어폰', count: 1, color: '#B45F06', image: '', sound: 'tada' },
      { id: 'b', name: '2', prize: '카페 기프티콘', count: 5, color: '#C2257A', image: '', sound: 'tada' },
      { id: 'c', name: '3', prize: '글리밍 키링', count: 15, color: '#0E7490', image: '', sound: 'tada' },
      { id: 'd', name: '4', prize: '스티커 세트', count: 40, color: '#5B3FD6', image: '', sound: 'tada' }
    ];
    App.newBoard();
    var closed = Logic.closedIndices(App.board);
    Logic.shuffle(closed);
    closed.slice(0, 34).forEach(function (i) { if (App.board.cells[i] !== 'a') Logic.draw(App.board, i, s); });
    App.interrupt();
    App.renderAll();
    document.getElementById('cornerBtns').style.display = 'none';
    return Logic.closedIndices(App.board).length;
  })()
`;

async function shot(win, name) {
  // 숨긴 창은 캡처를 요청해야 화면을 새로 그리므로, 한 번 버리고 다시 찍습니다.
  await sleep(250);
  await win.webContents.capturePage();
  await sleep(350);
  let img = await win.webContents.capturePage();
  const size = img.getSize();
  if (size.width > 1600) img = img.resize({ width: 1600, quality: 'best' });
  if (size.height > size.width && size.height > 1600) img = img.resize({ height: 1600, quality: 'best' });
  fs.writeFileSync(path.join(OUT, name), img.toJPEG(88));
  console.log('saved', name, img.getSize());
}

async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({
    width: 1280, height: 720, useContentSize: true, show: false, backgroundColor: '#DCE3F2',
    // 저장 기능 없이 화면만 띄웁니다(브라우저 임시 저장소를 씀).
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  const js = (code) => win.webContents.executeJavaScript(code);
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  await sleep(1500);

  // 1. 뽑기판
  await js(SETUP);
  await sleep(600);
  await shot(win, '01-board.jpg');

  // 2. 종이가 펼쳐지는 장면: 결과 화면으로 넘어가는 타이머만 막고, 애니메이션을 원하는 순간에 멈춥니다.
  await js(`
    window.__st = window.setTimeout;
    window.setTimeout = function (f, ms) { if (ms === 1500 + App.settings.paperSeconds * 1000) return 0; return window.__st.apply(window, arguments); };
    App.press(); true
  `);
  for (let i = 0; i < 100; i++) { if ((await js('App.phase')) === 'open') break; await sleep(100); }
  await sleep(300);
  const seek = (t) => js(`document.getAnimations().forEach(function (a) { a.pause(); a.currentTime = ${t}; }); true`);
  await seek(540);
  await shot(win, '02-paper-out.jpg');
  await seek(960);
  await shot(win, '03-paper-opening.jpg');
  await seek(2400);
  await shot(win, '04-paper-open.jpg');

  // 3. 결과 화면
  await js(`window.setTimeout = window.__st; App.interrupt(); App.settings.resultSeconds = 4; true`);
  await sleep(1700);
  await js(`App.press(); true`);
  for (let i = 0; i < 150; i++) { if ((await js('App.phase')) === 'result') break; await sleep(100); }
  await sleep(1300);
  await shot(win, '05-result.jpg');

  // 4. 관리자 설정
  await js(`App.interrupt(); Admin.open(); true`);
  await sleep(700);
  await shot(win, '06-admin.jpg');
  await js(`Admin.close(); true`);

  // 5. 세로 화면
  win.setContentSize(720, 1280);
  await sleep(500);
  await js(`App.settings.orientation = 'portrait'; App.interrupt(); App.renderAll(); true`);
  await sleep(700);
  await shot(win, '07-portrait.jpg');

  app.quit();
}

app.whenReady().then(() => run().catch((e) => { console.error('CAPTURE-ERROR', e); app.quit(); }));
