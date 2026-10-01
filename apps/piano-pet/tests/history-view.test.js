import { describe, it, expect } from 'vitest';
import { historyCardMarkup, songCollectionMarkup, calendarCellsMarkup, weeklyChartSvg, formatDateJa } from '../js/history-view.js';

// 「きろく」画面の組み立て（#382 で app.js から遅延モジュールへ移した）。
describe('historyCardMarkup', () => {
  const session = { date: '2026-09-02', totalCount: 3, songs: [{ name: '<img src=x onerror=alert(1)>', count: 3 }], praise: 'jouzu', tempo: null };

  it('曲名をエスケープし、操作ボタンに元配列の index を載せる', () => {
    const html = historyCardMarkup(session, 7);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(html.match(/data-index="7"/g)).toHaveLength(2 + 3 + 3);   // なおす・けす＋はなまる3＋テンポ3
    expect(html).toContain(formatDateJa('2026-09-02'));
  });

  it('付いているスタンプだけ選択中になる', () => {
    const html = historyCardMarkup(session, 0);
    expect(html).toMatch(/praise-stamp praise-stamp--on"[^>]*data-id="jouzu"/);
    expect(html).not.toContain('tempo-stamp--on');
  });
});

describe('songCollectionMarkup', () => {
  it('渡された色マップを使い、50かい以上に👑を付ける', () => {
    const colors = new Map([['A', { fill: '#123456' }]]);
    const html = songCollectionMarkup([{ name: 'A', count: 50 }, { name: 'B', count: 1 }], colors);
    expect(html).toContain('background:#123456');
    expect(html.match(/song-collection__crown/g)).toHaveLength(1);
  });
});

describe('calendarCellsMarkup / weeklyChartSvg', () => {
  it('空きセルはパディング、今日と未来日にクラスが付く', () => {
    const html = calendarCellsMarkup([[null, { day: 1, count: 10, level: 3, isToday: true, isFuture: false }, { day: 2, count: 0, level: 0, isToday: false, isFuture: true }]], 9);
    expect(html).toContain('cal-cell--pad');
    expect(html).toContain('class="cal-cell cal-cell--today" data-level="3" title="9/1：10かい"');
    expect(html).toContain('cal-cell--future');
  });

  it('0回の週は値ラベルを出さない', () => {
    const svg = weeklyChartSvg([{ total: 0, ratio: 0, label: '9/1' }, { total: 5, ratio: 1, label: '9/8' }]);
    expect(svg.match(/class="bar-value"/g)).toHaveLength(1);
  });
});
