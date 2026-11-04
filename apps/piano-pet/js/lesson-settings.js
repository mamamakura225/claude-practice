// ===== せってい：ピアノのレッスンび（#393）の画面部分 =====
// 設定オーバーレイを開くまで不要なので遅延読込（#284）。登録・解除の確定（全再計算）は
// app.js の setLessonDates が担い、ここは一覧の描画と入力の受け口だけ。

// 戻り値は再描画関数（設定を開くたびに最新の登録日で描き直す）。
export function initLessonSettings({ getDates, setDates, today, onRemoved }) {
  const listEl = document.getElementById('lessonList');
  const inputEl = document.getElementById('lessonDateInput');

  let showMore = false;
  const render = (collapse = false) => {
    if (collapse) showMore = false;
    if (!listEl) return;
    const t = today();
    // 先の予定は全部、過去日は新しい順に3件（「もっと みる」で12件・一覧が画面を占めないように #401）
    const all = [...getDates()].reverse();
    const past = all.filter((d) => d <= t);
    const pastLimit = showMore ? 12 : 3;
    const shown = [...all.filter((d) => d > t), ...past.slice(0, pastLimit)];
    listEl.replaceChildren(...shown.map((d) => {
      const li = document.createElement('li');
      const label = document.createElement('span');
      const wd = '日月火水木金土'[new Date(`${d}T00:00:00Z`).getUTCDay()];
      label.textContent = `${d.slice(5).replace('-', '/')}（${wd}）${d > t ? ' よてい' : ''}`;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'settings-btn settings-btn--ghost lesson-del';
      del.dataset.date = d;
      del.setAttribute('aria-label', `${d} の レッスンを とりけす`);
      del.textContent = '×';
      li.append(label, del);
      return li;
    }));
    if (!showMore && past.length > 3) {
      const li = document.createElement('li');
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'settings-btn settings-btn--ghost settings-btn--block lesson-more';
      more.textContent = `もっと みる（あと ${Math.min(past.length, 12) - 3}けん）`;
      li.append(more);
      listEl.append(li);
    }
  };

  document.getElementById('lessonAddBtn')?.addEventListener('click', () => {
    const d = inputEl?.value;
    if (!d || getDates().includes(d)) return;
    setDates([...getDates(), d], { announce: true });
    inputEl.value = '';
    if (d <= today()) showMore = true;   // 古い入れ忘れを足しても一覧に出ないと失敗に見える
    render();
  });
  listEl?.addEventListener('click', (e) => {
    if (e.target.closest('.lesson-more')) {
      const shown = listEl.querySelectorAll('.lesson-del').length;
      showMore = true;
      render();
      listEl.querySelectorAll('.lesson-del')[shown]?.focus();   // 足した先頭へ
      return;
    }
    const btn = e.target.closest('.lesson-del');
    if (!btn) return;
    setDates(getDates().filter((d) => d !== btn.dataset.date));
    render();
    onRemoved?.(btn.dataset.date);   // 取り消しトースト（#398）
  });

  return render;
}
