// ===== 利用計測 PostHog（任意・キー未設定なら no-op） =====
// 機能ごとの利用頻度を把握するための最小計測。SDK は CDN から動的 import するため、
// キー未設定時は一切読み込まず、オフライン/CDN 失敗でも PWA 本体を巻き込まない。
//
// プライバシー方針: 送るのは「操作種別と頻度」のみ。曲名・記録内容などは送らない。
//   - autocapture 無効（クリック/入力/DOMテキストを自動収集しない）
//   - capture_pageview 無効（SPA。view_changed を手動送信）
//   - session recording 無効、Do Not Track を尊重
import { monitoringConfig } from './monitoring-config.js';

let ph = null; // 読み込めた posthog インスタンス（未ロード時は null）

export async function initAnalytics() {
  const key = monitoringConfig.posthogKey;
  if (!key) return; // 未設定なら無効（no-op）
  try {
    const mod = await import('https://cdn.jsdelivr.net/npm/posthog-js@1/+esm');
    const posthog = mod.default ?? mod.posthog ?? mod;
    posthog.init(key, {
      api_host: monitoringConfig.posthogHost || 'https://us.i.posthog.com',
      autocapture: false,
      capture_pageview: false,
      disable_session_recording: true,
      respect_dnt: true,
      persistence: 'localStorage',
    });
    ph = posthog;
  } catch (err) {
    console.warn('analytics init skipped', err);
  }
}

// 操作種別と頻度のみを送る。内容（曲名など）は props に含めないこと。
export function track(event, props = {}) {
  try {
    ph?.capture(event, props);
  } catch {
    /* 計測失敗はアプリに影響させない */
  }
}
