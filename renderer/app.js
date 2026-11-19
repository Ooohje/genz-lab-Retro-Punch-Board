// 참여자 화면: 엔터 버튼 하나로 [대기 → 불빛 → 멈춤 → 펼침 → 결과 → 대기]가 계속 돕니다.
(function () {
  'use strict';
  var L = window.Logic;
  var S = window.Sound;
  var $ = function (id) { return document.getElementById(id); };

  // ---------- 저장/파일: 프로그램(Electron)에서는 window.api, 브라우저 미리보기에서는 대체 수단 ----------
  var hasApi = !!window.api;
  var STORE_KEY = 'ppopgi-state';

  function pickFile(accept, readAs) {
    return new Promise(function (resolve) {
      var inp = document.createElement('input');
      inp.type = 'file'; inp.accept = accept;
      inp.onchange = function () {
        var f = inp.files && inp.files[0];
        if (!f) return resolve(null);
        var fr = new FileReader();
        fr.onload = function () { resolve(fr.result); };
        fr.onerror = function () { resolve(null); };
        if (readAs === 'dataURL') fr.readAsDataURL(f); else fr.readAsText(f);
      };
      inp.click();
    });
  }

  var Platform = {
    load: function () {
      if (hasApi) return window.api.loadState();
      try { return Promise.resolve(JSON.parse(localStorage.getItem(STORE_KEY) || 'null')); } catch (e) { return Promise.resolve(null); }
    },
    save: function (data) {
      if (hasApi) return window.api.saveState(data);
      try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (e) { return Promise.reject(e); }
      return Promise.resolve(true);
    },
    setFullscreen: function (on) {
      if (hasApi) return window.api.setFullscreen(on);
      try {
        if (on && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(function () {});
        if (!on && document.fullscreenElement) document.exitFullscreen();
      } catch (e) { /* 브라우저가 막으면 무시 */ }
      return Promise.resolve(true);
    },
    exportText: function (opts) {
      if (hasApi) return window.api.exportText(opts);
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([opts.text], { type: 'text/plain;charset=utf-8' }));
      a.download = opts.defaultName;
      a.click();
      return Promise.resolve(opts.defaultName);
    },
    importText: function (opts) {
      if (hasApi) return window.api.importText(opts);
      return pickFile('.' + opts.ext, 'text');
    },
    pickImage: function () {
      if (hasApi) return window.api.pickImage();
      return pickFile('image/*', 'dataURL');
    },
    quit: function () { if (hasApi) window.api.quit(); }
  };

  // ---------- 상태 ----------
  var App = window.App = {
    Platform: Platform,
    settings: null,
    board: null,
    phase: 'idle', // idle | run | slow | open | result | done
    cursor: -1,
    adminOpen: false,
    modalOpen: false
  };
  var timers = { iv: null, to: [], lockUntil: 0, pendingResult: null };
  var needFull = true; // 판 전체를 다시 그려야 하는지(설정 변경·새 판·처음 시작)

  function later(fn, ms) { var id = setTimeout(fn, ms); timers.to.push(id); return id; }
  function clearTimers() {
    if (timers.iv) { clearInterval(timers.iv); timers.iv = null; }
    timers.to.forEach(clearTimeout); timers.to = [];
  }

  function persist() {
    return Platform.save({ version: 3, settings: App.settings, board: App.board }).catch(function () {
      toast('저장에 실패했습니다. 디스크 공간과 권한을 확인해 주세요.');
    });
  }

  // ---------- 배치 ----------
  function isPortrait() {
    var o = App.settings.orientation;
    if (o === 'portrait') return true;
    if (o === 'landscape') return false;
    return window.innerHeight > window.innerWidth;
  }

  function layout() {
    var stage = $('stage');
    var p = isPortrait();
    var changed = stage.classList.contains('portrait') !== p;
    stage.classList.toggle('portrait', p);
    stage.classList.toggle('landscape', !p);
    var w = p ? 1080 : 1920, h = p ? 1920 : 1080;
    stage.style.setProperty('--s', Math.min(window.innerWidth / w, window.innerHeight / h));
    var cv = $('confetti'); cv.width = w; cv.height = h;
    return changed;
  }

  // ---------- 그리기 ----------
  function renderHeader() {
    var t = App.settings.title || '';
    var el = $('title');
    el.textContent = t;
    var len = t.replace(/\s/g, '').length;
    var p = isPortrait();
    var size = len <= 7 ? (p ? 112 : 92) : len <= 10 ? (p ? 88 : 72) : (p ? 66 : 54);
    el.style.fontSize = size + 'px';
    $('eventName').textContent = App.settings.eventName || '';
    applyLook();
    document.title = 'Gen Z Lab. 뽑기판';
  }

  // 문구·꾸미기 설정을 화면에 반영합니다.
  function applyLook() {
    var s = App.settings;
    var root = document.documentElement;
    $('tagline').textContent = s.tagline || '';
    $('bubble').textContent = s.bubbleText || '';
    $('bubble').style.visibility = s.bubbleText && s.showMascot ? 'visible' : 'hidden';
    $('logoImg').src = s.logoImage || 'assets/logo.png';
    $('logoImg').style.visibility = s.showLogo ? 'visible' : 'hidden';
    document.querySelector('.mascot').style.visibility = s.showMascot ? 'visible' : 'hidden';
    document.querySelector('.key').style.display = s.showKey ? '' : 'none';
    document.querySelector('.result-key').style.visibility = s.showKey ? 'visible' : 'hidden';
    root.style.setProperty('--tile', s.tileColor || '#2F3A8F');
    root.style.setProperty('--gold', s.accentColor || '#FFC83D');
    if (s.bgImage) root.style.setProperty('--bg-img', 'url("' + String(s.bgImage).replace(/"/g, '%22') + '")');
    else root.style.removeProperty('--bg-img');
    $('board').classList.toggle('nonum', !s.showNumbers);
  }

  // 처음 보여 줄 때 끊기지 않도록 이미지와 글꼴을 미리 읽어 둡니다.
  var warm = [];
  function warmUp() {
    var s = App.settings;
    var srcs = ['assets/gleaming_cheer.png', 'assets/gleaming_wave.png', 'assets/key.png'];
    var text = '0123456789번칸' + s.winHead + s.winNote + s.blankHead + s.blankNote + (s.blank.name || '') + (s.blank.prize || '');
    s.ranks.forEach(function (r) { text += L.label(r); if (r.image) srcs.push(r.image); });
    if (s.blank.image) srcs.push(s.blank.image);
    warm = srcs.map(function (src) {
      var im = new Image();
      im.src = src;
      if (im.decode) im.decode().catch(function () {});
      return im;
    });
    if (document.fonts && document.fonts.load) {
      document.fonts.load('250px Jua', text).catch(function () {});
      document.fonts.load('700 40px "Noto Sans KR"', text).catch(function () {});
      document.fonts.load('900 72px "Noto Sans KR"', text).catch(function () {});
    }
  }

  function renderRanks() {
    var box = $('ranks');
    // 수량이 0인 등수(아직 준비 중인 등수)는 참여자 화면에 보이지 않습니다.
    var eff = L.effectiveRanks(App.settings).list.filter(function (r) { return r.count > 0; });
    var left = L.remainingByRank(App.board, App.settings);
    box.innerHTML = '';
    var p = isPortrait();
    box.classList.toggle('dense', eff.length > (p ? 6 : 5));
    box.classList.toggle('denser', eff.length > (p ? 10 : 8));
    eff.forEach(function (r) {
      var n = left[r.id] || 0;
      var row = document.createElement('div');
      row.className = 'rank' + (n === 0 ? ' out' : '');
      // 등수 대신 상품명만 보여 줍니다.
      var name = document.createElement('div'); name.className = 'rank-name'; name.textContent = L.label(r); name.style.color = r.color;
      row.appendChild(name);
      if (App.settings.showRemaining) {
        var l = document.createElement('div'); l.className = 'rank-left'; l.textContent = n === 0 ? '마감' : '남은 ' + n + '개';
        row.appendChild(l);
      }
      box.appendChild(row);
    });
    var closed = L.closedIndices(App.board).length;
    $('remain').textContent = '남은 칸 ' + closed + ' / ' + App.board.cells.length;
  }

  function paintCell(el, i) {
    el.className = 'cell';
    el.textContent = '';
    el.style.color = '';
    if (App.board.opened[i] && !(App.phase === 'open' && i === App.cursor)) {
      var info = L.cellInfo(App.board, i, App.settings);
      el.classList.add('open');
      el.textContent = info.name;
      el.style.color = info.color;
    } else {
      var star = document.createElement('span'); star.className = 'star'; star.textContent = '★'; star.setAttribute('aria-hidden', 'true');
      var num = document.createElement('span'); num.className = 'num'; num.textContent = String(i + 1);
      el.appendChild(star); el.appendChild(num);
      if (el.dataset.wide === '1') el.classList.add('wide');
      if (i === App.cursor) el.classList.add('cursor');
    }
  }

  function renderBoard() {
    var board = $('board');
    var total = App.board.cells.length;
    var cols = L.gridCols(total, isPortrait());
    board.style.gridTemplateColumns = 'repeat(' + cols + ', minmax(0, 1fr))';
    board.innerHTML = '';
    var frag = document.createDocumentFragment();
    for (var i = 0; i < total; i++) {
      var el = document.createElement('div');
      el.dataset.i = String(i);
      frag.appendChild(el);
    }
    board.appendChild(frag);
    // 칸 크기에 맞춰 글자 크기를 정합니다(화면 확대 비율과 무관한 offset 값 사용).
    var first = board.firstChild;
    var cw = first ? first.offsetWidth : 60, ch = first ? first.offsetHeight : 60;
    var wide = cw > ch * 1.25;
    var base = Math.min(cw, ch);
    var maxName = 1, maxWord = 1;
    L.effectiveRanks(App.settings).list.forEach(function (r) {
      var label = L.label(r);
      maxName = Math.max(maxName, label.replace(/\s/g, '').length);
      label.split(/\s+/).forEach(function (w) { maxWord = Math.max(maxWord, w.length); });
    });
    board.style.setProperty('--star', Math.round(base * (wide ? 0.42 : 0.36)) + 'px');
    board.style.setProperty('--num', Math.round(Math.min(base * (wide ? 0.4 : 0.3), cw * 0.3)) + 'px');
    // 뜯긴 칸의 상품명: 짧으면 한 줄, 길면 여러 줄로 나눠서 칸 안에 들어가게 합니다.
    var lines = maxName <= 3 ? 1 : maxName <= 8 ? 2 : 3;
    // 줄은 낱말 사이에서 바뀌므로, 가장 긴 낱말이 한 줄에 들어가는 크기로 맞춥니다(아주 긴 낱말은 중간에서 끊깁니다).
    var perLine = Math.max(Math.min(maxWord, 5), Math.ceil(maxName / lines));
    var openSize = Math.min((ch * 0.86) / (lines * 1.1), (cw * 0.9) / Math.max(1.6, perLine));
    board.style.setProperty('--open', Math.max(9, Math.round(openSize)) + 'px');
    for (var k = 0; k < board.children.length; k++) {
      board.children[k].dataset.wide = wide ? '1' : '0';
      paintCell(board.children[k], k);
    }
  }

  function cellEl(i) { return $('board').children[i]; }

  function setCursor(i) {
    // 불빛 이동은 칸을 다시 만들지 않고 표시(class)만 옮깁니다. 훨씬 가볍습니다.
    var prev = App.cursor;
    App.cursor = i;
    var p = prev >= 0 ? cellEl(prev) : null;
    if (p) p.classList.remove('cursor');
    var n = i >= 0 ? cellEl(i) : null;
    if (n && !App.board.opened[i]) n.classList.add('cursor');
  }

  var HINTS = {
    idle: '엔터 버튼을 눌러 주세요',
    run: '한 번 더 누르면 멈춰요!',
    slow: '두근두근… 어디에 멈출까요?',
    open: '두근두근… 열어 볼게요!',
    result: '버튼을 누르면 다음 분 차례',
    done: '모든 칸을 뽑았어요'
  };
  function renderHint() {
    var phaseKey = App.phase === 'run' && App.settings.autoStop ? 'slow' : App.phase;
    $('hintText').textContent = (App.phase === 'idle' && App.settings.hintIdle) || HINTS[phaseKey] || '';
    $('hint').classList.toggle('pulse', App.phase === 'idle');
  }

  function renderAll() {
    layout();
    renderHeader();
    renderBoard();
    renderRanks();
    renderHint();
  }

  // ---------- 진행 ----------
  function resetZoom(instant) {
    var board = $('board');
    if (instant) board.style.transition = 'none';
    board.style.transform = '';
    $('stage').querySelector('.board-box').classList.remove('zooming');
    if (instant) { void board.offsetWidth; board.style.transition = ''; }
  }

  function toIdle() {
    clearTimers();
    stopConfetti();
    timers.pendingResult = null;
    $('unfold').hidden = true;
    $('result').hidden = true;
    $('done').hidden = true;
    resetZoom(true);
    App.phase = 'idle';
    App.cursor = -1;
    if (needFull) {
      renderBoard();
      needFull = false;
    } else {
      // 판 전체(수백 칸)를 다시 만들지 않고, 바뀐 칸만 다시 그립니다.
      Array.prototype.forEach.call($('board').querySelectorAll('.cursor, .fresh'), function (el) {
        paintCell(el, Number(el.dataset.i));
      });
    }
    renderRanks();
    if (!L.closedIndices(App.board).length) {
      App.phase = 'done';
      $('doneText').textContent = App.settings.autoNewBoard
        ? '버튼을 누르면 새 판이 시작돼요.'
        : '운영자가 새 판을 준비하고 있어요. 잠시만 기다려 주세요.';
      $('done').hidden = false;
    }
    renderHint();
  }

  function moveCursor() {
    var closed = L.closedIndices(App.board);
    if (!closed.length) return;
    var next;
    if (App.settings.cursorMode === 'sequence') {
      next = closed[0];
      for (var i = 0; i < closed.length; i++) if (closed[i] > App.cursor) { next = closed[i]; break; }
    } else {
      if (closed.length === 1) next = closed[0];
      else do { next = closed[Math.floor(Math.random() * closed.length)]; } while (next === App.cursor);
    }
    setCursor(next);
    S.play('tick');
  }

  function startRun() {
    clearTimers();
    App.phase = 'run';
    renderHint();
    moveCursor();
    timers.iv = setInterval(moveCursor, L.speedToMs(App.settings.cursorSpeed));
    if (App.settings.autoStop) {
      // 한 번만 눌러도 정해 둔 시간 동안 돌다가 알아서 멈춥니다.
      later(function () { if (App.phase === 'run') startSlow(); }, App.settings.spinSeconds * 1000);
    } else {
      // 불빛만 돌려놓고 자리를 뜬 경우 1분 뒤 대기 화면으로 돌아갑니다.
      later(function () { if (App.phase === 'run') toIdle(); }, 60000);
    }
  }

  function startSlow() {
    clearTimers();
    App.phase = 'slow';
    renderHint();
    var target = App.settings.stopSeconds * 1000;
    var d = Math.max(60, L.speedToMs(App.settings.cursorSpeed));
    var delays = [], sum = 0;
    while (sum < target && delays.length < 80) { delays.push(d); sum += d; d = Math.min(d * 1.2, 700); }
    var at = 0;
    delays.forEach(function (ms) { at += ms; later(moveCursor, at); });
    later(function () { S.play('stop'); }, at + 60);
    later(startOpen, at + 250);
  }

  function rankFontSize(name, sizes) {
    // 글자 수가 많을수록 작게(긴 상품명은 두 줄로 넘어갑니다).
    var n = name.replace(/\s/g, '').length;
    if (n <= 2) return sizes[0];
    if (n === 3) return sizes[1];
    if (n === 4) return sizes[2];
    if (n <= 6) return sizes[3];
    if (n <= 12 || sizes.length < 6) return sizes[4];
    return sizes[5];
  }

  // 반으로 접힌 종이를 만듭니다. 위·아래 절반에 같은 내용을 넣고 자기 절반만 보이게 해서,
  // 펴지면 한 장의 종이에 등수가 이어져 보입니다.
  function buildPaper(cellNo, rankName, color) {
    var cellText = cellNo + '번 칸';
    var paper = $('paper');
    paper.innerHTML = '';
    function half(cls, i) {
      var el = document.createElement('div'); el.className = 'half ' + (cls === 'bottom' ? 'right' : 'left');
      var face = document.createElement('div'); face.className = 'seg-face';
      var content = document.createElement('div'); content.className = 'paper-content';
      content.style.setProperty('--i', String(i));
      var c = document.createElement('div'); c.className = 'paper-cell'; c.textContent = cellText;
      var r = document.createElement('div'); r.className = 'paper-rank'; r.textContent = rankName;
      r.style.color = color;
      r.style.fontSize = rankFontSize(rankName, [250, 200, 150, 104, 84, 66]) + 'px';
      content.appendChild(c); content.appendChild(r);
      face.appendChild(content); el.appendChild(face);
      return el;
    }
    // 오른쪽 절반은 제자리, 왼쪽 절반은 접혀서 오른쪽을 덮고 있다가 왼쪽으로 펼쳐집니다.
    var bottom = half('bottom', 1);
    var top = half('top', 0);
    // 접힌 종이의 겉면: 뽑기판의 칸과 같은 모양(별 + 번호)
    var cover = document.createElement('div'); cover.className = 'cover';
    var cs = document.createElement('span'); cs.className = 'star'; cs.textContent = '★'; cs.setAttribute('aria-hidden', 'true');
    var cn = document.createElement('span'); cn.textContent = String(cellNo);
    cover.appendChild(cs); cover.appendChild(cn);
    top.appendChild(cover);
    paper.appendChild(bottom);
    paper.appendChild(top);
    // 다 펼쳐지면 이음매 없는 한 장짜리 종이로 바꿔서 가운데 선이 전혀 보이지 않게 합니다.
    var flat = document.createElement('div'); flat.className = 'paper-flat';
    var fc = document.createElement('div'); fc.className = 'paper-cell'; fc.textContent = cellText;
    var fr = document.createElement('div'); fr.className = 'paper-rank'; fr.textContent = rankName;
    fr.style.color = color;
    fr.style.fontSize = rankFontSize(rankName, [250, 200, 150, 104, 84, 66]) + 'px';
    flat.appendChild(fc); flat.appendChild(fr);
    paper.appendChild(flat);
  }

  function startOpen() {
    clearTimers();
    var idx = App.cursor;
    App.phase = 'open';
    // 연출 전에 먼저 기록합니다. 연출 도중 꺼져도 뽑은 결과는 남습니다.
    var entry = L.draw(App.board, idx, App.settings);
    if (!entry) { toIdle(); return; }
    persist();
    var rank = L.findRank(App.settings, entry.rankId) || { name: entry.name, prize: entry.prize, color: '#1B1A3A', sound: 'ding' };
    timers.pendingResult = { entry: entry, rank: rank };
    renderHint();

    // 뽑기판은 그대로 두고, 뽑힌 칸의 접힌 종이만 그 자리에서 쏘옥 빠져나옵니다.
    // 종이가 칸과 똑같은 위치·크기에서 출발하도록 출발점을 계산합니다.
    var el = cellEl(idx);
    var box = $('stage').querySelector('.board-box');
    var stage = $('stage');
    var paper = $('paper');
    var cx = box.offsetLeft + el.offsetLeft + el.offsetWidth / 2;
    var cy = box.offsetTop + el.offsetTop + el.offsetHeight / 2;
    buildPaper(idx + 1, L.label(rank), rank.color);
    paper.style.setProperty('--fx', (cx - (stage.offsetWidth / 2 + 180)) + 'px');
    paper.style.setProperty('--fy', (cy - stage.offsetHeight / 2) + 'px');
    paper.style.setProperty('--fsx', String(el.offsetWidth / 360));
    paper.style.setProperty('--fsy', String(el.offsetHeight / 520));
    $('unfold').hidden = false;
    // 종이가 빠져나간 칸은 빈 자리로 보이게 합니다.
    later(function () { el.className = 'cell open'; el.textContent = ''; }, 200);

    // 빠르게: 종이가 나오고(0.15초) 펼쳐진 뒤(1.4초), 설정한 시간만큼 보여 주고 결과 화면으로 넘어갑니다.
    later(function () { S.play('whoosh'); }, 150);
    later(function () { S.play('flap'); }, 800);
    later(function () { S.play('stop'); }, 1400);
    later(showResult, 1500 + App.settings.paperSeconds * 1000);
  }

  function showResult() {
    var pr = timers.pendingResult;
    clearTimers();
    if (!pr) { toIdle(); return; }
    var rank = pr.rank, entry = pr.entry;
    App.phase = 'result';
    // 결과 화면이 뜨는 순간 그 상품의 효과음(기본: 짜잔)을 냅니다.
    S.play(rank.sound);
    $('unfold').hidden = true;
    resetZoom(true);
    var opened = cellEl(entry.cell);
    if (opened) paintCell(opened, entry.cell);
    if (opened) opened.classList.add('fresh');
    renderRanks();
    renderHint();

    var blank = !!rank.isBlank;
    var p = isPortrait();
    $('result').classList.toggle('blank', blank);
    $('resultCell').textContent = (entry.cell + 1) + '번 칸';
    $('resultHead').textContent = blank ? App.settings.blankHead : App.settings.winHead;
    var rr = $('resultRank');
    var label = L.label(rank);
    rr.textContent = label;
    rr.style.color = rank.color;
    rr.style.fontSize = Math.round(rankFontSize(label, [380, 300, 235, 165, 120, 92]) * (p ? 0.84 : 1)) + 'px';
    // 상품명이 큰 글자로 나오므로, 아래 줄은 꽝의 안내 문구에만 씁니다.
    $('resultPrize').textContent = blank ? (rank.prize || '') : '';
    $('resultPrize').hidden = !blank || !rank.prize;
    $('resultNote').textContent = blank ? App.settings.blankNote : App.settings.winNote;
    var img = $('resultImg');
    img.src = rank.image || (blank ? 'assets/gleaming_wave.png' : 'assets/gleaming_cheer.png');

    var secs = App.settings.resultSeconds;
    var bar = $('countdownBar');
    bar.classList.remove('run');
    if (secs > 0) {
      $('countdown').style.visibility = 'visible';
      $('countdownText').textContent = secs + '초 뒤 자동으로 돌아갑니다';
      void bar.offsetWidth;
      bar.style.animationDuration = secs + 's';
      bar.classList.add('run');
      later(toIdle, secs * 1000);
    } else {
      $('countdown').style.visibility = 'hidden';
    }
    $('result').hidden = false;
    // 결과가 뜬 직후의 연타는 무시해서 결과를 건너뛰지 않게 합니다.
    timers.lockUntil = Date.now() + 1500;
    if (!blank) startConfetti();
  }

  function newBoard() {
    var b = L.createBoard(App.settings);
    if (!b) { toast('상품 수량이 총 칸 수보다 많아 새 판을 만들 수 없습니다.'); return false; }
    App.board = b;
    persist();
    needFull = true;
    toIdle();
    return true;
  }

  // 엔터 버튼 한 번 = 다음 단계
  function press() {
    if (App.adminOpen || App.modalOpen) return;
    if (Date.now() < timers.lockUntil) return;
    if (App.phase === 'idle') {
      if (!L.closedIndices(App.board).length) { toIdle(); return; }
      startRun();
    } else if (App.phase === 'run') {
      // 알아서 멈추는 방식에서는 도는 동안 눌러도 아무 일도 일어나지 않습니다.
      if (!App.settings.autoStop) startSlow();
    } else if (App.phase === 'result') {
      toIdle();
    } else if (App.phase === 'done') {
      if (App.settings.autoNewBoard) newBoard();
    }
    // slow, open 단계에서는 눌러도 아무 일도 일어나지 않습니다(연타 방지).
  }

  // ---------- 색종이 ----------
  var confetti = { raf: 0, parts: [] };
  function startConfetti() {
    stopConfetti();
    var cv = $('confetti'), c = cv.getContext('2d');
    var colors = ['#FFC83D', '#C2257A', '#0E7490', '#5B3FD6', '#FF7A3D', '#2F3A8F'];
    confetti.parts = [];
    for (var i = 0; i < 110; i++) {
      confetti.parts.push({
        x: Math.random() * cv.width, y: -20 - Math.random() * cv.height * 0.6,
        vx: (Math.random() - 0.5) * 5, vy: 4 + Math.random() * 7,
        w: 10 + Math.random() * 14, h: 6 + Math.random() * 10,
        r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
        c: colors[i % colors.length]
      });
    }
    var start = performance.now();
    (function frame(now) {
      c.clearRect(0, 0, cv.width, cv.height);
      var alive = false;
      confetti.parts.forEach(function (p) {
        p.x += p.vx; p.y += p.vy; p.r += p.vr;
        if (p.y < cv.height + 40) alive = true;
        c.save(); c.translate(p.x, p.y); c.rotate(p.r); c.fillStyle = p.c;
        c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); c.restore();
      });
      if (alive && now - start < 6000) confetti.raf = requestAnimationFrame(frame);
      else c.clearRect(0, 0, cv.width, cv.height);
    })(start);
  }
  function stopConfetti() {
    if (confetti.raf) cancelAnimationFrame(confetti.raf);
    confetti.raf = 0;
    var cv = $('confetti');
    cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
  }

  // ---------- 확인 창 / 알림 ----------
  var modalResolve = null;
  function openModal(opts) {
    return new Promise(function (resolve) {
      modalResolve = resolve;
      App.modalOpen = true;
      $('modalTitle').textContent = opts.title || '';
      $('modalText').textContent = opts.text || '';
      var inp = $('modalInput');
      inp.hidden = !opts.input;
      inp.value = '';
      var ok = $('modalOk');
      ok.textContent = opts.okLabel || '확인';
      ok.className = 'btn ' + (opts.danger ? 'danger' : 'primary');
      $('modalCancel').hidden = !!opts.noCancel;
      $('modal').hidden = false;
      if (opts.input) inp.focus(); else if (document.activeElement) document.activeElement.blur();
    });
  }
  function closeModal(value) {
    $('modal').hidden = true;
    App.modalOpen = false;
    var r = modalResolve; modalResolve = null;
    if (r) r(value);
  }
  $('modalOk').addEventListener('click', function () { closeModal($('modalInput').hidden ? true : $('modalInput').value); });
  $('modalCancel').addEventListener('click', function () { closeModal($('modalInput').hidden ? false : null); });
  $('modalInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); closeModal($('modalInput').value); }
  });

  var toastTimer = 0;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3500);
  }

  // ---------- 입력 ----------
  document.addEventListener('keydown', function (e) {
    if (e.key === 'F11') {
      e.preventDefault();
      toggleFullscreen();
      return;
    }
    if (App.modalOpen) {
      if (e.key === 'Escape') closeModal($('modalInput').hidden ? false : null);
      // 확인 창에서는 엔터 버튼이 "확인"을 누르지 못하게 합니다.
      if (e.key === 'Enter' && e.target !== $('modalInput')) e.preventDefault();
      return;
    }
    if (e.key === 'F2') {
      e.preventDefault();
      if (window.Admin) window.Admin.toggle();
      return;
    }
    if (App.adminOpen) {
      if (e.key === 'Escape' && window.Admin) window.Admin.close();
      return;
    }
    if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') {
      e.preventDefault();
      if (e.repeat) return; // 꾹 누르고 있어도 한 번만
      press();
    }
  });
  document.addEventListener('keyup', function (e) {
    if (!App.adminOpen && !App.modalOpen && e.code === 'Space') e.preventDefault();
  });
  // 전체 화면 버튼(화면 오른쪽 위): 누를 때마다 전체 화면 <-> 창 모드
  function renderFsBtn() {
    var on = !!App.settings.fullscreen;
    $('fsBtnText').textContent = on ? '창 모드로' : '전체 화면';
    $('cornerBtns').classList.toggle('on', on);
  }
  function toggleFullscreen() {
    App.settings.fullscreen = !App.settings.fullscreen;
    Platform.setFullscreen(App.settings.fullscreen);
    persist();
    renderFsBtn();
    if (App.adminOpen && window.Admin) window.Admin.render();
  }
  App.renderFsBtn = renderFsBtn;
  // 설정·전체 화면 버튼은 마우스를 움직일 때만 3초간 보입니다.
  var cornerTimer = 0;
  function showCorner(ms) {
    $('cornerBtns').classList.add('show');
    clearTimeout(cornerTimer);
    cornerTimer = setTimeout(function () { $('cornerBtns').classList.remove('show'); }, ms || 3000);
  }
  document.addEventListener('mousemove', function () { showCorner(3000); });
  showCorner(8000); // 처음 켰을 때는 버튼이 있다는 걸 알 수 있게 조금 길게
  $('fsBtn').addEventListener('click', function () { $('fsBtn').blur(); toggleFullscreen(); });
  $('adminBtn').addEventListener('click', function () { $('adminBtn').blur(); if (window.Admin) window.Admin.toggle(); });
  $('hint').addEventListener('click', function () { $('hint').blur(); press(); });
  $('result').addEventListener('click', press);
  $('done').addEventListener('click', press);
  window.addEventListener('resize', function () {
    if (!App.settings) return;
    var flipped = layout();
    if (flipped && (App.phase === 'idle' || App.phase === 'done')) renderAll();
    else if (flipped) { renderHeader(); }
  });

  // ---------- 관리자 화면에서 쓰는 기능 ----------
  App.persist = persist;
  App.renderAll = renderAll;
  App.toIdle = toIdle;
  App.newBoard = newBoard;
  App.confirm = function (opts) { return openModal(opts); };
  App.toast = toast;
  App.press = press;
  // 연출 도중 관리자 화면을 열면 연출만 끊고 뽑은 결과는 유지합니다.
  App.interrupt = function () { needFull = true; toIdle(); };
  App.applySettings = function (next) {
    App.settings = next;
    renderFsBtn();
    warmUp();
    S.setVolume(next.volume);
    persist();
    renderAll();
  };

  // ---------- 시작 ----------
  Platform.load().then(function (saved) {
    App.settings = L.normalizeSettings(saved && saved.settings);
    // 예전 저장본(전체 화면이 기본이던 버전)은 창 모드로 한 번 되돌립니다.
    var oldSave = !saved || !(saved.version >= 2);
    if (oldSave) App.settings.fullscreen = false;
    // 빨라진 기본값과 짜잔 효과음을 예전 저장본에도 한 번 적용합니다.
    var preV3 = !saved || !(saved.version >= 3);
    if (preV3 && saved) {
      App.settings.spinSeconds = 1;
      App.settings.ranks.forEach(function (r) { if (r.sound === 'fanfare' || r.sound === 'ding') r.sound = 'tada'; });
    }
    if (L.effectiveRanks(App.settings).error) App.settings.ranks = L.defaultSettings().ranks;
    var b = saved && saved.board;
    var ok = b && Array.isArray(b.cells) && Array.isArray(b.opened) && Array.isArray(b.history) &&
      b.cells.length === App.settings.totalCells && b.opened.length === b.cells.length;
    App.board = ok ? b : L.createBoard(App.settings);
    if (!App.board) { App.settings = L.defaultSettings(); App.board = L.createBoard(App.settings); }
    S.setVolume(App.settings.volume);
    if (!ok || oldSave || preV3) persist();
    renderFsBtn();
    var start = function () { layout(); renderHeader(); if (App.phase === 'idle' || App.phase === 'done') { needFull = true; toIdle(); } };
    start();
    warmUp();
    // 글꼴이 늦게 읽히면 칸 글자 크기를 한 번 더 맞춥니다.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(start);
  });
})();
