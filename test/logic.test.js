// 뽑기 규칙 검사: `npm test` 로 실행합니다.
const assert = require('assert');
const L = require('../renderer/logic.js');

function count(arr) {
  const m = {};
  arr.forEach((x) => { m[x] = (m[x] || 0) + 1; });
  return m;
}

// 1. 전원 당첨: 마지막 등수가 남는 칸을 채운다
{
  const s = L.defaultSettings();
  const b = L.createBoard(s);
  assert.strictEqual(b.cells.length, 200);
  const c = count(b.cells);
  assert.deepStrictEqual(c, { r1: 1, r2: 3, r3: 10, r4: 186 });
}

// 2. 꽝 있음: 남는 칸은 꽝
for (const total of [100, 120, 150, 200]) {
  const s = L.defaultSettings();
  s.fillMode = 'blank';
  s.totalCells = total;
  const b = L.createBoard(s);
  const c = count(b.cells);
  assert.strictEqual(b.cells.length, total);
  assert.strictEqual(c.r1, 1);
  assert.strictEqual(c.r4, 40);
  assert.strictEqual(c[L.BLANK_ID], total - 54);
}

// 3. 수량이 칸 수보다 많으면 판을 만들지 않는다
{
  const s = L.defaultSettings();
  s.fillMode = 'blank';
  s.totalCells = 50;
  assert.ok(L.effectiveRanks(s).error);
  assert.strictEqual(L.createBoard(s), null);
}

// 4. 뽑기와 되돌리기, 남은 수량
{
  const s = L.defaultSettings();
  const b = L.createBoard(s);
  const first = L.closedIndices(b)[0];
  const e = L.draw(b, first, s);
  assert.ok(e && e.cell === first);
  assert.strictEqual(L.draw(b, first, s), null, '같은 칸은 두 번 못 뽑는다');
  assert.strictEqual(L.closedIndices(b).length, 199);
  const left = L.remainingByRank(b, s);
  assert.strictEqual(Object.values(left).reduce((a, x) => a + x, 0), 199);
  L.undo(b);
  assert.strictEqual(L.closedIndices(b).length, 200);
  assert.strictEqual(b.history.length, 0);
}

// 5. 판을 끝까지 뽑으면 등수별 수량이 정확히 맞는다
{
  const s = L.defaultSettings();
  s.fillMode = 'blank';
  s.totalCells = 120;
  const b = L.createBoard(s);
  while (L.closedIndices(b).length) L.draw(b, L.closedIndices(b)[0], s);
  const c = count(b.history.map((h) => h.rankId));
  assert.deepStrictEqual(c, { r1: 1, r2: 3, r3: 10, r4: 40, [L.BLANK_ID]: 66 });
}

// 6. 진행 중 수량 변경: 뜯긴 칸은 그대로, 남은 칸만 다시 섞는다
{
  const s = L.defaultSettings();
  s.fillMode = 'blank';
  const b = L.createBoard(s);
  for (let i = 0; i < 30; i++) L.draw(b, L.closedIndices(b)[i], s);
  const openedBefore = b.opened.slice();
  const cellsBefore = b.cells.slice();
  const usedR2 = b.history.filter((h) => h.rankId === 'r2').length;
  s.ranks[1].count = 8; // 2등을 3개 -> 8개
  const nb = L.redistribute(b, s);
  assert.ok(nb);
  assert.deepStrictEqual(nb.opened, openedBefore);
  openedBefore.forEach((o, i) => { if (o) assert.strictEqual(nb.cells[i], cellsBefore[i]); });
  const left = L.remainingByRank(nb, s);
  assert.strictEqual(left.r2 || 0, 8 - usedR2);
  assert.strictEqual(L.closedIndices(nb).length, 170);
}

// 7. 판 크기 변경: 뜯긴 칸이 잘리면 거부, 아니면 허용
{
  const s = L.defaultSettings();
  const b = L.createBoard(s);
  L.draw(b, 199, s);
  s.totalCells = 150;
  assert.strictEqual(L.redistribute(b, s), null);
  s.totalCells = 250;
  const nb = L.redistribute(b, s);
  assert.strictEqual(nb.cells.length, 250);
  assert.strictEqual(nb.opened[199], true);
}

// 8. 등수 추가와 삭제
{
  const s = L.defaultSettings();
  s.ranks.push({ id: 'sp', name: '특별상', prize: '특별 상품', count: 2, color: '#000', image: '', sound: 'ding' });
  // 전원 당첨에서는 마지막 등수(특별상)가 남는 칸을 채우므로 4등은 입력 수량 40 그대로
  const c = count(L.createBoard(s).cells);
  assert.strictEqual(c.r4, 40);
  assert.strictEqual(c.sp, 200 - 54);
  s.ranks = [];
  assert.ok(L.effectiveRanks(s).error);
}

// 9. 기록 내보내기, 속도, 격자
{
  const s = L.defaultSettings();
  s.ranks[0].prize = '상품, "특별"';
  const b = L.createBoard(s);
  b.cells[0] = 'r1';
  L.draw(b, 0, s, new Date(2026, 10, 19, 9, 5, 7));
  const csv = L.toCsv(b);
  assert.ok(csv.startsWith('﻿순번,시간,칸 번호,상품'));
  assert.ok(csv.includes('1,2026-11-19 09:05:07,1,"상품, ""특별"""'));
  assert.strictEqual(L.speedToMs(1), 400);
  assert.strictEqual(L.speedToMs(10), 45);
  assert.ok(L.speedToMs(5) < L.speedToMs(4));
  assert.strictEqual(L.gridCols(200, false), 20);
  assert.strictEqual(L.gridCols(100, false), 10);
  assert.strictEqual(L.gridCols(150, true), 10);
  assert.ok(L.gridCols(37, false) >= 1);
}

// 10. 저장된 설정 복구
{
  const n = L.normalizeSettings({ totalCells: '120', ranks: [{ name: 'A', count: '5' }], volume: 999 });
  assert.strictEqual(n.totalCells, 120);
  assert.strictEqual(n.ranks[0].count, 5);
  assert.ok(n.ranks[0].id);
  assert.strictEqual(n.volume, 100);
  assert.strictEqual(n.blank.id, L.BLANK_ID);
  assert.strictEqual(L.normalizeSettings(null).totalCells, 200);
}

console.log('뽑기 규칙 검사 통과');
