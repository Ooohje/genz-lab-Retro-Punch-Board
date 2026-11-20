// 뽑기판 규칙: 화면과 무관한 순수 계산만 모아 둔 파일입니다.
// 브라우저에서는 window.Logic, Node(테스트)에서는 module.exports 로 씁니다.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Logic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BLANK_ID = '__blank__';

  function uid() {
    return 'r' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  }

  function defaultSettings() {
    return {
      title: '추억의 뽑기판',
      eventName: '',
      totalCells: 200,
      fillMode: 'last', // 'last' = 전원 당첨(마지막 등수가 남는 칸을 채움), 'blank' = 꽝 있음
      ranks: [
        // 화면에는 등수 없이 상품명(prize)만 보입니다. name 은 내부 구분용입니다.
        { id: 'r1', name: '1', prize: '상품 A', count: 1, color: '#B45F06', image: '', sound: 'tada' },
        { id: 'r2', name: '2', prize: '상품 B', count: 3, color: '#C2257A', image: '', sound: 'tada' },
        { id: 'r3', name: '3', prize: '상품 C', count: 10, color: '#0E7490', image: '', sound: 'tada' },
        { id: 'r4', name: '4', prize: '상품 D', count: 40, color: '#5B3FD6', image: '', sound: 'tada' }
      ],
      blank: { id: BLANK_ID, name: '꽝', prize: '다음 기회에', color: '#5E5C7A', image: '', sound: 'pop' },
      orientation: 'auto', // 'auto' | 'landscape' | 'portrait'
      fullscreen: false, // 기본은 창 모드. 전체 화면 버튼이나 F11 로 켭니다.
      cursorSpeed: 7, // 1(느림) ~ 10(빠름)
      cursorMode: 'random', // 'random' | 'sequence'
      autoStop: true,  // true = 한 번 누르면 알아서 돌다가 멈춤, false = 한 번 더 눌러서 멈춤
      alwaysSpin: false, // true = 불빛이 항상 돌고 있고, 누르면 그 자리에 멈춤(autoStop 보다 우선)
      spinSeconds: 1,  // 알아서 멈출 때 불빛이 도는 시간
      paperSeconds: 1, // 펼쳐진 종이를 보여 주는 시간(그 뒤 결과 화면으로 넘어감)
      stopSeconds: 0, // 0 = 바로 멈춤, 1 이상 = 그 시간 동안 점점 느려지다 멈춤
      resultSeconds: 8, // 0 이면 버튼을 누를 때까지 유지
      volume: 80,
      showRemaining: true,
      autoNewBoard: false,
      adminPin: '',
      // 문구(관리자 화면에서 모두 고칠 수 있습니다)
      tagline: '칸을 골라 행운을 열어 보세요',
      bubbleText: '큰 버튼을 누르면\n불빛이 달려요!',
      hintIdle: '엔터 버튼을 눌러 주세요',
      winHead: '축하합니다!',
      winNote: '운영 부스에서 상품을 받아 가세요',
      blankHead: '아쉬워요',
      blankNote: '다음에 또 도전해 주세요',
      // 꾸미기
      bgImage: '',      // 비우면 기본 배경
      logoImage: '',    // 비우면 기본 로고
      showLogo: true,
      showMascot: true,
      showKey: true,
      showNumbers: true,
      tileColor: '#2F3A8F',
      accentColor: '#FFC83D'
    };
  }

  // 저장된 설정에 빠진 항목이 있으면 기본값으로 채웁니다.
  function normalizeSettings(saved) {
    var d = defaultSettings();
    if (!saved || typeof saved !== 'object') return d;
    var out = {};
    Object.keys(d).forEach(function (k) { out[k] = saved[k] === undefined ? d[k] : saved[k]; });
    if (!Array.isArray(out.ranks)) out.ranks = d.ranks;
    out.ranks = out.ranks.map(function (r) {
      return {
        id: r.id || uid(),
        name: String(r.name == null ? '' : r.name),
        prize: String(r.prize == null ? '' : r.prize),
        count: clampInt(r.count, 0, 9999, 0),
        color: r.color || '#1B1A3A',
        image: r.image || '',
        sound: r.sound || 'tada'
      };
    });
    out.blank = Object.assign({}, d.blank, saved.blank || {}, { id: BLANK_ID });
    out.totalCells = clampInt(out.totalCells, 1, 600, d.totalCells);
    out.cursorSpeed = clampInt(out.cursorSpeed, 1, 10, d.cursorSpeed);
    out.stopSeconds = clampInt(out.stopSeconds, 0, 8, d.stopSeconds);
    out.spinSeconds = clampInt(out.spinSeconds, 1, 15, d.spinSeconds);
    out.paperSeconds = clampInt(out.paperSeconds, 0, 8, d.paperSeconds);
    out.autoStop = out.autoStop !== false;
    out.alwaysSpin = out.alwaysSpin === true;
    out.resultSeconds = clampInt(out.resultSeconds, 0, 60, d.resultSeconds);
    out.volume = clampInt(out.volume, 0, 100, d.volume);
    if (out.fillMode !== 'blank') out.fillMode = 'last';
    if (['auto', 'landscape', 'portrait'].indexOf(out.orientation) < 0) out.orientation = 'auto';
    if (out.cursorMode !== 'sequence') out.cursorMode = 'random';
    return out;
  }

  function clampInt(v, min, max, fallback) {
    var n = Math.round(Number(v));
    if (!isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  // 실제로 판에 들어갈 등수 목록과 수량을 계산합니다.
  // 꽝 있음: 등수 수량은 입력값 그대로, 남는 칸은 꽝.
  // 전원 당첨: 마지막 등수가 남는 칸을 모두 가져갑니다(그 등수의 입력 수량은 무시).
  function effectiveRanks(settings) {
    var total = settings.totalCells;
    var ranks = settings.ranks;
    var list = [];
    var error = '';
    if (settings.fillMode === 'blank') {
      var sum = 0;
      ranks.forEach(function (r) { sum += r.count; list.push(Object.assign({}, r, { auto: false })); });
      var rest = total - sum;
      if (rest < 0) error = '상품 수량 합계(' + sum + ')가 총 칸 수(' + total + ')보다 ' + (-rest) + '개 많습니다.';
      list.push(Object.assign({}, settings.blank, { id: BLANK_ID, count: Math.max(0, rest), auto: true, isBlank: true }));
    } else {
      if (!ranks.length) {
        error = '상품이 하나 이상 있어야 합니다.';
      } else {
        var fixed = 0;
        ranks.forEach(function (r, i) {
          if (i < ranks.length - 1) { fixed += r.count; list.push(Object.assign({}, r, { auto: false })); }
        });
        var rest2 = total - fixed;
        if (rest2 < 0) error = '상품 수량 합계(' + fixed + ')가 총 칸 수(' + total + ')보다 ' + (-rest2) + '개 많습니다.';
        var last = ranks[ranks.length - 1];
        list.push(Object.assign({}, last, { count: Math.max(0, rest2), auto: true }));
      }
    }
    return { list: list, error: error };
  }

  function findRank(settings, id) {
    if (id === BLANK_ID) return Object.assign({}, settings.blank, { id: BLANK_ID, isBlank: true });
    for (var i = 0; i < settings.ranks.length; i++) if (settings.ranks[i].id === id) return settings.ranks[i];
    return null;
  }

  // 화면에 보여 줄 이름: 상품은 상품명, 꽝은 "꽝"(꽝의 이름)
  function label(rank) {
    if (!rank) return '';
    if (rank.isBlank || rank.id === BLANK_ID) return rank.name || '꽝';
    return rank.prize || rank.name || '';
  }

  function shuffle(arr, rng) {
    rng = rng || Math.random;
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // 새 판: 등수를 칸에 미리 섞어 배치합니다.
  function createBoard(settings, rng) {
    var eff = effectiveRanks(settings);
    if (eff.error) return null;
    var cells = [];
    eff.list.forEach(function (r) { for (var k = 0; k < r.count; k++) cells.push(r.id); });
    while (cells.length < settings.totalCells) cells.push(eff.list[eff.list.length - 1].id);
    cells.length = settings.totalCells;
    shuffle(cells, rng);
    return {
      id: uid(),
      createdAt: new Date().toISOString(),
      cells: cells,
      opened: cells.map(function () { return false; }),
      history: []
    };
  }

  // 진행 중인 판에 바뀐 설정을 반영합니다. 이미 뜯긴 칸은 그대로 두고,
  // 안 뜯긴 칸에만 남은 수량을 다시 섞어 넣습니다.
  // 판 크기가 줄어 이미 뜯긴 칸이 잘려 나가야 하면 null 을 돌려줍니다(새 판 필요).
  function redistribute(board, settings, rng) {
    var eff = effectiveRanks(settings);
    if (eff.error) return null;
    var total = settings.totalCells;
    for (var i = total; i < board.cells.length; i++) if (board.opened[i]) return null;

    var cells = board.cells.slice(0, total);
    var opened = board.opened.slice(0, total);
    while (cells.length < total) { cells.push(null); opened.push(false); }

    var usedByRank = {};
    var closedIdx = [];
    for (var c = 0; c < total; c++) {
      if (opened[c]) usedByRank[cells[c]] = (usedByRank[cells[c]] || 0) + 1;
      else closedIdx.push(c);
    }
    var pool = [];
    eff.list.forEach(function (r) {
      var need = Math.max(0, r.count - (usedByRank[r.id] || 0));
      for (var k = 0; k < need; k++) pool.push(r.id);
    });
    var fillId = eff.list[eff.list.length - 1].id;
    while (pool.length < closedIdx.length) pool.push(fillId);
    // 남은 칸보다 상품이 많으면 뒤쪽(낮은 등수)부터 줄입니다.
    pool.length = closedIdx.length;
    shuffle(pool, rng);
    closedIdx.forEach(function (idx, k) { cells[idx] = pool[k]; });

    return {
      id: board.id,
      createdAt: board.createdAt,
      cells: cells,
      opened: opened,
      history: board.history.filter(function (h) { return h.cell < total; })
    };
  }

  function closedIndices(board) {
    var out = [];
    for (var i = 0; i < board.cells.length; i++) if (!board.opened[i]) out.push(i);
    return out;
  }

  // 등수별 남은 수량
  function remainingByRank(board, settings) {
    var left = {};
    for (var i = 0; i < board.cells.length; i++) {
      if (!board.opened[i]) left[board.cells[i]] = (left[board.cells[i]] || 0) + 1;
    }
    return left;
  }

  function draw(board, index, settings, now) {
    if (index < 0 || index >= board.cells.length || board.opened[index]) return null;
    var rank = findRank(settings, board.cells[index]);
    board.opened[index] = true;
    var entry = {
      t: (now || new Date()).toISOString(),
      cell: index,
      rankId: board.cells[index],
      name: label(rank),
      prize: rank ? rank.prize : ''
    };
    board.history.push(entry);
    return entry;
  }

  function undo(board) {
    var last = board.history.pop();
    if (!last) return null;
    board.opened[last.cell] = false;
    return last;
  }

  // 뜯긴 칸에 표시할 등수(등수가 삭제됐으면 기록에 남은 이름을 씁니다).
  function cellInfo(board, index, settings) {
    var rank = findRank(settings, board.cells[index]);
    if (rank) return { name: label(rank), color: rank.color, isBlank: !!rank.isBlank };
    for (var i = board.history.length - 1; i >= 0; i--) {
      if (board.history[i].cell === index) return { name: board.history[i].name, color: '#5E5C7A', isBlank: false };
    }
    return { name: '', color: '#5E5C7A', isBlank: false };
  }

  function csvCell(v) {
    var s = String(v == null ? '' : v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsv(board) {
    var rows = [['순번', '시간', '칸 번호', '상품']];
    board.history.forEach(function (h, i) {
      var d = new Date(h.t);
      var p = function (n) { return (n < 10 ? '0' : '') + n; };
      var ts = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
      rows.push([i + 1, ts, h.cell + 1, h.name]);
    });
    // 엑셀에서 한글이 깨지지 않도록 BOM 을 붙입니다.
    return '﻿' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n';
  }

  // 불빛 속도 단계(1~10)를 칸 이동 간격(ms)으로 바꿉니다. 1 = 400ms, 10 = 45ms
  function speedToMs(level) {
    var l = clampInt(level, 1, 10, 7);
    return Math.round(400 * Math.pow(45 / 400, (l - 1) / 9));
  }

  // 판의 가로 칸 수. 10 단위 칸 수는 가로형 10줄 / 세로형 10칸으로 깔끔하게 맞춥니다.
  function gridCols(total, portrait) {
    if (total % 10 === 0 && total >= 50) return portrait ? 10 : total / 10;
    var areaAspect = portrait ? 0.78 : 1.5;
    var cellAspect = portrait ? 1.4 : 0.75;
    return Math.max(1, Math.min(total, Math.ceil(Math.sqrt(total * areaAspect / cellAspect))));
  }

  return {
    BLANK_ID: BLANK_ID,
    uid: uid,
    defaultSettings: defaultSettings,
    normalizeSettings: normalizeSettings,
    effectiveRanks: effectiveRanks,
    findRank: findRank,
    label: label,
    shuffle: shuffle,
    createBoard: createBoard,
    redistribute: redistribute,
    closedIndices: closedIndices,
    remainingByRank: remainingByRank,
    draw: draw,
    undo: undo,
    cellInfo: cellInfo,
    toCsv: toCsv,
    speedToMs: speedToMs,
    gridCols: gridCols
  };
});
