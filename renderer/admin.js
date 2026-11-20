// 관리자 설정(F2): 바꾼 내용은 바로 저장되고 뽑기판에 반영됩니다.
(function () {
  'use strict';
  var L = window.Logic;
  var S = window.Sound;
  var App = window.App;
  var root = document.getElementById('admin');

  var draft = null;       // 편집 중인 설정
  var dirtyDist = false;  // 수량/칸 수가 바뀌어 남은 칸을 다시 섞어야 하는지
  var customTotal = false;
  var previewTimer = 0;
  var PRESET_TOTALS = [100, 120, 150, 200];

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function h(tag, props, kids) {
    var e = document.createElement(tag);
    props = props || {};
    Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v === undefined || v === null || v === false) return;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else if (k === 'value' || k === 'disabled' || k === 'checked' || k === 'hidden' || k === 'type' || k === 'min' || k === 'max' || k === 'step' || k === 'src' || k === 'id' || k === 'placeholder' || k === 'title') e[k] = v;
      else e.setAttribute(k, v);
    });
    (kids || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }

  // ---------- 설정 반영 ----------
  function commit() {
    var eff = L.effectiveRanks(draft);
    updateNote();
    if (eff.error) return Promise.resolve(false); // 고칠 때까지 뽑기판은 이전 설정 그대로
    var next = clone(draft);
    if (!dirtyDist) { App.applySettings(next); return Promise.resolve(true); }

    var nb = App.board.history.length === 0 ? L.createBoard(next) : L.redistribute(App.board, next);
    if (nb) {
      dirtyDist = false;
      App.board = nb;
      App.applySettings(next);
      return Promise.resolve(true);
    }
    // 판을 줄이면 이미 뽑힌 칸이 잘려 나가는 경우: 새 판이 필요합니다.
    return App.confirm({
      title: '새 판이 필요합니다',
      text: '줄이려는 칸 중에 이미 뽑힌 칸이 있습니다.\n새 판을 만들면 지금까지의 뽑기 상태가 지워집니다.',
      okLabel: '새 판 만들기',
      danger: true
    }).then(function (yes) {
      if (yes) {
        dirtyDist = false;
        App.board = L.createBoard(next);
        App.applySettings(next);
      } else {
        draft.totalCells = App.settings.totalCells;
        customTotal = PRESET_TOTALS.indexOf(draft.totalCells) < 0;
      }
      render();
      return !!yes;
    });
  }

  function lookChange() { commit(); }
  function distChange(rerender) {
    dirtyDist = true;
    commit().then(function () { if (rerender) render(); else updateAuto(); });
  }

  // ---------- 화면 조각 ----------
  function updateNote() {
    var note = root.querySelector('#rankNote');
    if (!note) return;
    var eff = L.effectiveRanks(draft);
    var auto = eff.list.length ? eff.list[eff.list.length - 1] : null;
    note.className = 'note' + (eff.error ? ' bad' : '');
    note.textContent = eff.error
      ? eff.error + ' 수량을 줄이거나 총 칸 수를 늘려 주세요.'
      : '총 ' + draft.totalCells + '칸 가운데 남는 ' + (auto ? auto.count : 0) + '칸은 "' + L.label(auto) + '"(으)로 채워집니다.';
  }

  function updateAuto() {
    var eff = L.effectiveRanks(draft);
    var auto = eff.list.length ? eff.list[eff.list.length - 1] : null;
    var el = root.querySelector('#autoCount');
    if (el && auto) el.value = String(auto.count);
    updateNote();
    updateStatus();
  }

  function updateStatus() {
    var el = root.querySelector('#boardStatus');
    if (!el) return;
    var total = App.board.cells.length;
    var done = App.board.history.length;
    el.textContent = '지금 판: 총 ' + total + '칸 · ' + done + '칸 뽑음 · ' + (total - done) + '칸 남음';
  }

  function seg(options, current, onPick) {
    return h('div', { class: 'seg' }, options.map(function (o) {
      return h('button', {
        type: 'button', 'aria-pressed': String(o.value === current), text: o.label,
        onclick: function () { onPick(o.value); }
      });
    }));
  }

  function field(label, control) {
    return h('div', { class: 'field' }, [h('div', { class: 'lbl', text: label }), control]);
  }

  function slider(label, key, min, max, fmt, onDone) {
    var out = h('output', { text: fmt(draft[key]) });
    var inp = h('input', {
      type: 'range', min: String(min), max: String(max), step: '1', value: String(draft[key]), 'aria-label': label,
      oninput: function () { draft[key] = Number(inp.value); out.textContent = fmt(draft[key]); lookChange(); if (onDone) onDone(); }
    });
    return field(label, h('div', { class: 'slider' }, [inp, out]));
  }

  function soundSelect(target) {
    var sel = h('select', {
      class: 'inp', 'aria-label': '효과음',
      onchange: function () { target.sound = sel.value; S.play(sel.value); lookChange(); }
    }, S.choices.map(function (c) { return h('option', { value: c.id, text: c.label }); }));
    sel.value = target.sound;
    return sel;
  }

  function imageCell(target) {
    var kids = [];
    if (target.image) kids.push(h('img', { class: 'thumb', src: target.image, alt: '' }));
    kids.push(h('button', {
      type: 'button', class: 'btn', text: target.image ? '바꾸기' : '이미지 선택',
      onclick: function () {
        App.Platform.pickImage().then(function (url) {
          if (!url) return;
          target.image = url; lookChange(); render();
        });
      }
    }));
    if (target.image) {
      kids.push(h('button', {
        type: 'button', class: 'btn icon', title: '이미지 지우기', 'aria-label': '이미지 지우기', text: '✕',
        onclick: function () { target.image = ''; lookChange(); render(); }
      }));
    }
    return h('div', { class: 'img-cell' }, kids);
  }

  function rankRow(target, i, opts) {
    // 화면에는 등수 없이 상품명만 나옵니다. 꽝 줄은 "꽝"이라는 표시 이름을 고칩니다.
    var key = opts.fixed ? 'name' : 'prize';
    var name = h('input', {
      class: 'inp', type: 'text', value: target[key], 'aria-label': '상품명',
      oninput: function () { target[key] = name.value; lookChange(); updateNote(); }
    });
    name.style.color = target.color;
    name.style.fontWeight = '900';
    var count;
    if (opts.auto) {
      count = h('input', { class: 'inp num', id: 'autoCount', type: 'text', value: String(opts.autoCount), disabled: true, 'aria-label': '수량(자동)', title: '남는 칸이 자동으로 들어갑니다' });
    } else {
      count = h('input', {
        class: 'inp num', type: 'number', min: '0', max: '9999', value: String(target.count), 'aria-label': '수량',
        oninput: function () {
          var n = Math.round(Number(count.value));
          target.count = isFinite(n) && n > 0 ? Math.min(9999, n) : 0;
          distChange(false);
        }
      });
    }
    var color = h('input', {
      class: 'inp', type: 'color', value: target.color, 'aria-label': '색상',
      oninput: function () { target.color = color.value; name.style.color = color.value; lookChange(); }
    });
    var tools = h('div', { class: 'tools' }, opts.fixed ? [] : [
      h('button', { type: 'button', class: 'btn icon', text: '▲', title: '위로', 'aria-label': L.label(target) + ' 위로', disabled: i === 0, onclick: function () { move(i, -1); } }),
      h('button', { type: 'button', class: 'btn icon', text: '▼', title: '아래로', 'aria-label': L.label(target) + ' 아래로', disabled: i === draft.ranks.length - 1, onclick: function () { move(i, 1); } }),
      h('button', { type: 'button', class: 'btn icon', text: '✕', title: '삭제', 'aria-label': L.label(target) + ' 삭제', onclick: function () { removeRank(i); } })
    ]);
    return h('div', { class: 'rank-row' }, [name, count, color, imageCell(target), soundSelect(target), tools]);
  }

  function move(i, d) {
    var j = i + d;
    if (j < 0 || j >= draft.ranks.length) return;
    var t = draft.ranks[i]; draft.ranks[i] = draft.ranks[j]; draft.ranks[j] = t;
    // 전원 당첨에서는 마지막 등수가 바뀌면 수량 배분도 바뀝니다.
    distChange(true);
  }

  function removeRank(i) {
    var r = draft.ranks[i];
    App.confirm({ title: '"' + L.label(r) + '" 삭제', text: '이 상품을 목록에서 지웁니다. 이미 뽑힌 칸의 표시는 그대로 남습니다.', okLabel: '삭제', danger: true }).then(function (yes) {
      if (!yes) return;
      draft.ranks.splice(i, 1);
      distChange(true);
    });
  }

  function addRank() {
    var colors = ['#B45F06', '#C2257A', '#0E7490', '#5B3FD6', '#2F3A8F', '#0F7A4A', '#B42318'];
    var n = draft.ranks.length + 1;
    draft.ranks.push({ id: L.uid(), name: String(n), prize: '새 상품', count: 0, color: colors[(n - 1) % colors.length], image: '', sound: 'tada' });
    distChange(true);
  }

  function stamp() {
    var d = new Date();
    var p = function (x) { return (x < 10 ? '0' : '') + x; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes());
  }

  // ---------- 전체 그리기 ----------
  function render() {
    if (!draft) return;
    clearInterval(previewTimer);
    var keepScroll = root.scrollTop;
    root.innerHTML = '';
    var eff = L.effectiveRanks(draft);
    var blankMode = draft.fillMode === 'blank';
    var auto = eff.list.length ? eff.list[eff.list.length - 1] : null;

    // 머리
    root.appendChild(h('div', { class: 'admin-head' }, [
      h('div', {}, [
        h('h1', { text: '관리자 설정' }),
        h('p', { text: 'F2 키로 열고 닫습니다 · 바꾼 내용은 바로 저장되고 뽑기판에 반영됩니다' })
      ]),
      h('button', { type: 'button', class: 'btn primary', text: '뽑기판으로 돌아가기 (F2)', onclick: close })
    ]));

    // 등수 · 상품
    var table = h('div', { class: 'rank-table' }, [
      h('div', { class: 'rank-row head' }, ['상품명', '수량', '색상', '상품 이미지', '효과음', ''].map(function (t) { return h('div', { text: t }); }))
    ]);
    draft.ranks.forEach(function (r, i) {
      var isAuto = !blankMode && i === draft.ranks.length - 1;
      table.appendChild(rankRow(r, i, { auto: isAuto, autoCount: auto ? auto.count : 0 }));
    });
    if (blankMode) table.appendChild(rankRow(draft.blank, -1, { auto: true, autoCount: auto ? auto.count : 0, fixed: true }));

    var rankCard = h('section', { class: 'card' }, [
      h('h2', { text: '상품' }),
      h('p', { class: 'sub', text: blankMode
        ? '상품은 자유롭게 추가·삭제할 수 있습니다. 남는 칸은 맨 아래 꽝으로 채워집니다.'
        : '상품은 자유롭게 추가·삭제할 수 있습니다. 맨 아래 상품이 남는 칸을 모두 가져갑니다.' }),
      table,
      h('button', { type: 'button', class: 'btn dashed', text: '+ 상품 추가', onclick: addRank }),
      h('div', { id: 'rankNote', class: 'note' })
    ]);

    // 기본 정보
    var title = h('input', { class: 'inp', type: 'text', value: draft.title, id: 'fTitle', oninput: function () { draft.title = title.value; lookChange(); } });
    var ev = h('input', { class: 'inp', type: 'text', value: draft.eventName, id: 'fEvent', placeholder: '예: 2026 가을 축제', oninput: function () { draft.eventName = ev.value; lookChange(); } });
    var pin = h('input', { class: 'inp', type: 'text', value: draft.adminPin, id: 'fPin', placeholder: '비워 두면 비밀번호 없이 열립니다', oninput: function () { draft.adminPin = pin.value; lookChange(); } });
    var infoCard = h('section', { class: 'card' }, [
      h('h2', { text: '기본 정보' }),
      h('div', { class: 'field' }, [h('label', { for: 'fTitle', text: '제목' }), title]),
      h('div', { class: 'field' }, [h('label', { for: 'fEvent', text: '행사 이름' }), ev]),
      h('div', { class: 'field' }, [h('label', { for: 'fPin', text: '관리자 비밀번호' }), pin])
    ]);

    // 판 · 연출
    var totalOpts = PRESET_TOTALS.map(function (n) { return { value: n, label: String(n) }; });
    totalOpts.push({ value: 'custom', label: '직접 입력' });
    var totalNow = customTotal ? 'custom' : draft.totalCells;
    var totalKids = [seg(totalOpts, totalNow, function (v) {
      if (v === 'custom') { customTotal = true; render(); return; }
      customTotal = false; draft.totalCells = v; distChange(true);
    })];
    if (customTotal) {
      var tin = h('input', {
        class: 'inp num', type: 'number', min: '1', max: '600', value: String(draft.totalCells), 'aria-label': '총 칸 수 직접 입력',
        onchange: function () {
          var n = Math.round(Number(tin.value));
          draft.totalCells = isFinite(n) ? Math.min(600, Math.max(1, n)) : draft.totalCells;
          tin.value = String(draft.totalCells);
          distChange(true);
        }
      });
      totalKids.push(tin);
    }
    var totalBox = h('div', {}, totalKids);
    totalBox.style.display = 'flex'; totalBox.style.flexDirection = 'column'; totalBox.style.gap = '6px';

    var preview = h('div', { class: 'row', 'aria-hidden': 'true' }, []);
    for (var k = 0; k < 12; k++) {
      var t = h('div', { class: 'cell', text: '★' });
      t.style.width = '34px'; t.style.height = '34px'; t.style.fontSize = '16px'; t.style.color = '#FFC83D'; t.style.borderRadius = '8px';
      preview.appendChild(t);
    }
    var pv = -1;
    function runPreview() {
      clearInterval(previewTimer);
      previewTimer = setInterval(function () {
        if (root.hidden) { clearInterval(previewTimer); return; }
        var next;
        if (draft.cursorMode === 'sequence') next = (pv + 1) % 12;
        else do { next = Math.floor(Math.random() * 12); } while (next === pv);
        if (pv >= 0) { preview.children[pv].classList.remove('cursor'); preview.children[pv].style.color = '#FFC83D'; }
        pv = next;
        preview.children[pv].classList.add('cursor'); preview.children[pv].style.color = '#1B1A3A';
      }, L.speedToMs(draft.cursorSpeed));
    }
    runPreview();

    var playCard = h('section', { class: 'card' }, [
      h('h2', { text: '판 · 연출' }),
      field('총 칸 수', totalBox),
      field('꽝', seg([{ value: 'blank', label: '꽝 있음' }, { value: 'last', label: '전원 당첨' }], draft.fillMode, function (v) { draft.fillMode = v; distChange(true); })),
      field('화면 방향', seg([{ value: 'auto', label: '자동' }, { value: 'landscape', label: '가로 TV' }, { value: 'portrait', label: '세로 TV' }], draft.orientation, function (v) { draft.orientation = v; lookChange(); render(); })),
      field('전체 화면', seg([{ value: true, label: '전체 화면 (F11)' }, { value: false, label: '창 모드' }], draft.fullscreen, function (v) { draft.fullscreen = v; App.Platform.setFullscreen(v); lookChange(); render(); })),
      field('불빛 이동', seg([{ value: 'random', label: '무작위로 점프' }, { value: 'sequence', label: '순서대로' }], draft.cursorMode, function (v) { draft.cursorMode = v; lookChange(); render(); })),
      slider('불빛 속도', 'cursorSpeed', 1, 10, function (v) { return v + '단계'; }, runPreview),
      field('속도 미리보기', preview),
      field('진행 방식', seg(
        [{ value: 'auto', label: '알아서 멈춤' }, { value: 'manual', label: '눌러서 멈춤' }, { value: 'always', label: '계속 돌기' }],
        draft.alwaysSpin ? 'always' : draft.autoStop ? 'auto' : 'manual',
        function (v) {
          draft.alwaysSpin = v === 'always'; draft.autoStop = v !== 'manual';
          // 계속 돌기는 누른 자리에 바로 멈추는 방식이라, 멈추는 시간을 '바로 멈춤'으로 맞춥니다.
          if (draft.alwaysSpin) draft.stopSeconds = 0;
          lookChange(); render();
        }
      )),
      h('p', { class: 'sub', text: draft.alwaysSpin
        ? '불빛이 항상 돌고 있습니다. 엔터를 누르면 그 자리에 멈추고 상품이 열립니다.'
        : draft.autoStop
          ? '엔터를 한 번 누르면 불빛이 돌다가 알아서 멈춥니다.'
          : '엔터를 누르면 불빛이 돌고, 한 번 더 누르면 멈춥니다.' }),
      draft.autoStop && !draft.alwaysSpin ? slider('도는 시간', 'spinSeconds', 1, 15, function (v) { return v + '초'; }) : null,
      slider('종이 보여주는 시간', 'paperSeconds', 0, 8, function (v) { return v + '초'; }),
      draft.alwaysSpin
        ? field('멈추는 시간', h('div', { class: 'status', text: '바로 멈춤 (계속 돌기에서는 고정)' }))
        : slider('멈추는 시간', 'stopSeconds', 0, 8, function (v) { return v === 0 ? '바로 멈춤' : v + '초'; }),
      slider('결과 유지 시간', 'resultSeconds', 0, 30, function (v) { return v === 0 ? '수동' : v + '초'; }),
      slider('음량', 'volume', 0, 100, function (v) { return v + '%'; }),
      field('남은 수량', seg([{ value: true, label: '화면에 보이기' }, { value: false, label: '숨기기' }], draft.showRemaining, function (v) { draft.showRemaining = v; lookChange(); render(); })),
      field('판을 다 뽑으면', seg([{ value: true, label: '버튼으로 새 판 시작' }, { value: false, label: '운영자가 새 판 만들기' }], draft.autoNewBoard, function (v) { draft.autoNewBoard = v; lookChange(); render(); }))
    ]);
    // 음량을 바꾸면 소리로 확인
    var vol = playCard.querySelector('input[aria-label="음량"]');
    if (vol) vol.addEventListener('change', function () { S.setVolume(draft.volume); S.play('ding'); });

    // 운영
    var recent = App.board.history.slice(-6).reverse();
    var log = h('ul', { class: 'log' }, recent.length ? recent.map(function (e) {
      var d = new Date(e.t);
      var p = function (x) { return (x < 10 ? '0' : '') + x; };
      return h('li', {}, [p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + ' · ' + (e.cell + 1) + '번 칸 · ', h('b', { text: e.name })]);
    }) : [h('li', { text: '아직 뽑은 기록이 없습니다.' })]);

    var opsCard = h('section', { class: 'card' }, [
      h('h2', { text: '운영' }),
      h('div', { id: 'boardStatus', class: 'status' }),
      log,
      h('div', { class: 'row' }, [
        h('button', {
          type: 'button', class: 'btn', text: '마지막 뽑기 되돌리기', disabled: !App.board.history.length,
          onclick: function () {
            var last = App.board.history[App.board.history.length - 1];
            App.confirm({ title: '마지막 뽑기 되돌리기', text: (last.cell + 1) + '번 칸(' + last.name + ')을 다시 안 뽑은 상태로 돌립니다.', okLabel: '되돌리기' }).then(function (yes) {
              if (!yes) return;
              L.undo(App.board); App.persist(); App.renderAll(); render();
            });
          }
        }),
        h('button', {
          type: 'button', class: 'btn', text: '뽑기 기록 내보내기 (CSV)',
          onclick: function () {
            App.Platform.exportText({ text: L.toCsv(App.board), defaultName: '뽑기기록_' + stamp() + '.csv', filterName: 'CSV', ext: 'csv' })
              .then(function (p) { if (p) App.toast('기록을 저장했습니다: ' + p); });
          }
        }),
        h('button', {
          type: 'button', class: 'btn', text: '설정 내보내기',
          onclick: function () {
            App.Platform.exportText({ text: JSON.stringify({ type: 'ppopgi-settings', version: 1, settings: App.settings }, null, 2), defaultName: '뽑기판설정_' + stamp() + '.json', filterName: '뽑기판 설정', ext: 'json' })
              .then(function (p) { if (p) App.toast('설정을 저장했습니다: ' + p); });
          }
        }),
        h('button', {
          type: 'button', class: 'btn', text: '설정 불러오기',
          onclick: function () {
            App.Platform.importText({ filterName: '뽑기판 설정', ext: 'json' }).then(function (text) {
              if (!text) return;
              var data;
              try { data = JSON.parse(text); } catch (e) { App.toast('설정 파일을 읽을 수 없습니다.'); return; }
              if (!data || data.type !== 'ppopgi-settings' || !data.settings) { App.toast('뽑기판 설정 파일이 아닙니다.'); return; }
              draft = L.normalizeSettings(data.settings);
              customTotal = PRESET_TOTALS.indexOf(draft.totalCells) < 0;
              App.Platform.setFullscreen(draft.fullscreen);
              dirtyDist = true;
              commit().then(function (ok) { render(); App.toast(ok ? '설정을 불러왔습니다.' : '불러온 설정에 고칠 곳이 있습니다.'); });
            });
          }
        })
      ]),
      h('div', { class: 'row spread' }, [
        h('button', {
          type: 'button', class: 'btn danger', text: '새 판 만들기 (다시 섞기)',
          onclick: function () {
            if (L.effectiveRanks(draft).error) { App.toast('먼저 상품 수량을 고쳐 주세요.'); return; }
            App.confirm({ title: '새 판 만들기', text: '지금 판의 뽑기 상태와 기록이 모두 지워지고, 상품을 새로 섞습니다.\n기록이 필요하면 먼저 내보내 주세요.', okLabel: '새 판 만들기', danger: true }).then(function (yes) {
              if (!yes) return;
              dirtyDist = false;
              App.settings = clone(draft);
              if (App.newBoard()) { App.toast('새 판을 만들었습니다.'); }
              render();
            });
          }
        }),
        h('button', {
          type: 'button', class: 'btn', text: '프로그램 종료',
          onclick: function () {
            App.confirm({ title: '프로그램 종료', text: '뽑기 상태는 저장되어 있어, 다시 켜면 이어서 진행됩니다.', okLabel: '종료' }).then(function (yes) { if (yes) App.Platform.quit(); });
          }
        })
      ])
    ]);

    // 문구: 화면에 나오는 글자를 모두 고칠 수 있습니다.
    function textField(label, obj, key, opts) {
      opts = opts || {};
      var id = 'f_' + key + (opts.suffix || '');
      var inp = h(opts.multi ? 'textarea' : 'input', {
        class: 'inp' + (opts.multi ? ' area' : ''), id: id, value: obj[key] || '', placeholder: opts.placeholder,
        oninput: function () { obj[key] = inp.value; lookChange(); }
      });
      if (!opts.multi) inp.type = 'text';
      return h('div', { class: 'field' }, [h('label', { for: id, text: label }), inp]);
    }
    var textCard = h('section', { class: 'card' }, [
      h('h2', { text: '문구' }),
      h('p', { class: 'sub', text: '화면에 나오는 글자를 바꿉니다. 비워 두면 그 자리는 표시되지 않습니다.' }),
      textField('판 위 안내', draft, 'tagline'),
      textField('대기 중 버튼', draft, 'hintIdle'),
      textField('캐릭터 말풍선', draft, 'bubbleText', { multi: true }),
      textField('당첨 머리말', draft, 'winHead'),
      textField('당첨 안내', draft, 'winNote'),
      textField('꽝 머리말', draft, 'blankHead'),
      textField('꽝 아래 문구', draft.blank, 'prize', { suffix: '_blank' }),
      textField('꽝 안내', draft, 'blankNote')
    ]);

    // 꾸미기: 배경·로고·캐릭터·색상
    function imageField(label, key) {
      var kids = [];
      if (draft[key]) kids.push(h('img', { class: 'thumb', src: draft[key], alt: '' }));
      kids.push(h('button', {
        type: 'button', class: 'btn', text: draft[key] ? '바꾸기' : '이미지 선택',
        onclick: function () {
          App.Platform.pickImage().then(function (url) {
            if (!url) return;
            draft[key] = url; lookChange(); render();
          });
        }
      }));
      if (draft[key]) {
        kids.push(h('button', { type: 'button', class: 'btn', text: '기본으로', onclick: function () { draft[key] = ''; lookChange(); render(); } }));
      }
      return field(label, h('div', { class: 'row' }, kids));
    }
    function colorField(label, key) {
      var inp = h('input', {
        class: 'inp color', type: 'color', value: draft[key], 'aria-label': label,
        oninput: function () { draft[key] = inp.value; lookChange(); }
      });
      return field(label, inp);
    }
    function showField(label, key) {
      return field(label, seg([{ value: true, label: '보이기' }, { value: false, label: '숨기기' }], draft[key], function (v) { draft[key] = v; lookChange(); render(); }));
    }
    var lookCard = h('section', { class: 'card' }, [
      h('h2', { text: '꾸미기' }),
      imageField('배경 이미지', 'bgImage'),
      imageField('로고 이미지', 'logoImage'),
      showField('로고', 'showLogo'),
      showField('캐릭터', 'showMascot'),
      showField('열쇠', 'showKey'),
      showField('칸 번호', 'showNumbers'),
      colorField('칸 색상', 'tileColor'),
      colorField('강조 색상', 'accentColor'),
      h('div', { class: 'row' }, [
        h('button', {
          type: 'button', class: 'btn', text: '문구·꾸미기를 기본값으로',
          onclick: function () {
            App.confirm({ title: '기본값으로 되돌리기', text: '문구와 꾸미기 설정만 처음 상태로 되돌립니다. 상품과 뽑기 상태는 그대로입니다.', okLabel: '되돌리기' }).then(function (yes) {
              if (!yes) return;
              var d = L.defaultSettings();
              ['tagline', 'bubbleText', 'hintIdle', 'winHead', 'winNote', 'blankHead', 'blankNote', 'bgImage', 'logoImage', 'showLogo', 'showMascot', 'showKey', 'showNumbers', 'tileColor', 'accentColor']
                .forEach(function (k) { draft[k] = d[k]; });
              draft.blank.prize = d.blank.prize;
              lookChange(); render();
            });
          }
        })
      ])
    ]);

    root.appendChild(h('div', { class: 'admin-grid' }, [
      h('div', { class: 'admin-col' }, [rankCard, textCard, opsCard]),
      h('div', { class: 'admin-col' }, [playCard, lookCard, infoCard])
    ]));

    updateNote();
    updateStatus();
    root.scrollTop = keepScroll;
  }

  // ---------- 열기 / 닫기 ----------
  function show() {
    App.interrupt();
    App.adminOpen = true;
    draft = clone(App.settings);
    dirtyDist = false;
    customTotal = PRESET_TOTALS.indexOf(draft.totalCells) < 0;
    root.hidden = false;
    root.scrollTop = 0;
    render();
  }

  function open() {
    if (App.adminOpen) return;
    var pin = App.settings.adminPin;
    if (!pin) { show(); return; }
    App.confirm({ title: '관리자 비밀번호', text: '설정을 열려면 비밀번호를 입력하세요.', input: true, okLabel: '열기' }).then(function (v) {
      if (v === null) return;
      if (v === pin) show(); else App.toast('비밀번호가 맞지 않습니다.');
    });
  }

  function close() {
    if (!App.adminOpen) return;
    clearInterval(previewTimer);
    if (L.effectiveRanks(draft).error) App.toast('수량 오류가 있어 마지막으로 올바르던 설정으로 진행합니다.');
    root.hidden = true;
    App.adminOpen = false;
    draft = null;
    App.toIdle();
    App.renderAll();
  }

  window.Admin = {
    open: open,
    close: close,
    toggle: function () { if (App.adminOpen) close(); else open(); },
    render: function () { if (App.adminOpen) { draft.fullscreen = App.settings.fullscreen; render(); } }
  };
})();
