// ===== Sentry エラー監視（任意・DSN 未設定なら no-op） =====
// SDK は CDN から動的 import するため、DSN 未設定時は一切読み込まず、
// オフライン/CDN 失敗でも PWA 本体を巻き込まない。
// プライバシー: breadcrumb を全破棄し request/user を送らない
// （練習記録などの内容や個人情報を Sentry に送信しないため）。
import { monitoringConfig } from './monitoring-config.js';

export async function initErrorMonitoring() {
  const dsn = monitoringConfig.sentryDsn;
  if (!dsn) return; // 未設定なら無効（no-op）
  try {
    const Sentry = await import('https://cdn.jsdelivr.net/npm/@sentry/browser@8/+esm');
    const host = location.hostname;
    Sentry.init({
      dsn,
      environment: host === 'localhost' || host === '127.0.0.1' ? 'development' : 'production',
      sendDefaultPii: false,
      beforeBreadcrumb: () => null,
      beforeSend(event) {
        delete event.request;
        delete event.user;
        return event;
      },
    });
  } catch (err) {
    console.warn('Sentry init skipped', err);
  }
}
