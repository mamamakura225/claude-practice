// ===== せってい：ピアノのレッスンび（#393）の画面部分 =====
// 設定オーバーレイを開くまで不要なので遅延読込（#284）。登録・解除の確定（全再計算）は
// app.js の setLessonDates が担い、ここは一覧の描画と入力の受け口だけ。

// 戻り値は再描画関数（設定を開くたびに最新の登録日で描き直す）。
export function initLessonSettings({ getDates, setDates, today }) {
  const listEl = document.getElementById('lessonList');
  const inputEl = document.getElementById('lessonDateInput');

  const render = () => {
    if (!listEl) return;
    const t = today();
    // 先の予定は全部、過去日は新しい順に12件（予定が多くても誤登録した過去日を解除できる）
    const all = [...getDates()].reverse();
    const shown = [...all.filter((d) => d > t), ...all.filter((d) => d <= t).slice(0, 12)];
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
  };

  document.getElementById('lessonAddBtn')?.addEventListener('click', () => {
    const d = inputEl?.value;
    if (!d || getDates().includes(d)) return;
    setDates([...getDates(), d], { announce: true });
    inputEl.value = '';
    render();
  });
  listEl?.addEventListener('click', (e) => {
    const btn = e.target.closest('.lesson-del');
    if (!btn) return;
    setDates(getDates().filter((d) => d !== btn.dataset.date));
    render();
  });

  return render;
}
