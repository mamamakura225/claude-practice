let alarmTime = null;
let alarmSet = false;

function updateClock() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  document.getElementById('clock').textContent = `${h}:${m}:${s}`;

  if (alarmSet && alarmTime) {
    const current = `${h}:${m}`;
    if (current === alarmTime && now.getSeconds() === 0) {
      triggerAlarm();
    }
  }
}

function toggleAlarm() {
  const input = document.getElementById('alarm-time');
  const btn = document.getElementById('set-btn');
  const status = document.getElementById('status');

  if (alarmSet) {
    alarmSet = false;
    alarmTime = null;
    btn.textContent = 'セット';
    btn.classList.remove('active');
    status.textContent = 'アラームは設定されていません';
    status.classList.remove('active');
  } else {
    if (!input.value) {
      status.textContent = '時刻を選択してください';
      return;
    }
    alarmTime = input.value;
    alarmSet = true;
    btn.textContent = 'キャンセル';
    btn.classList.add('active');
    status.textContent = `${alarmTime} にアラームをセット`;
    status.classList.add('active');
  }
}

function triggerAlarm() {
  document.getElementById('overlay').classList.add('show');
  const sound = document.getElementById('alarm-sound');
  sound.play().catch(() => {});
}

function dismissAlarm() {
  document.getElementById('overlay').classList.remove('show');
  const sound = document.getElementById('alarm-sound');
  sound.pause();
  sound.currentTime = 0;

  alarmSet = false;
  alarmTime = null;
  document.getElementById('set-btn').textContent = 'セット';
  document.getElementById('set-btn').classList.remove('active');
  document.getElementById('status').textContent = 'アラームは設定されていません';
  document.getElementById('status').classList.remove('active');
}

setInterval(updateClock, 1000);
updateClock();
