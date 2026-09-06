import { describe, it, expect, vi, afterEach } from 'vitest';
import { createCloudQueue } from '../js/cloud-queue.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('createCloudQueue（#313）', () => {
  it('保留中に state が変わっても、送るのは「送信時点の最新」（thunk）', async () => {
    const sent = [];
    const q = createCloudQueue((d) => sent.push(d));
    let snapshot = { n: 1 };

    q.pushCloudDebounced(() => snapshot, 5);
    snapshot = { n: 2 };          // 保留中にリモート取り込み等で state が差し替わる
    await new Promise((r) => setTimeout(r, 15));

    expect(sent).toEqual([{ n: 2 }]);   // 呼び出し時点の {n:1} を焼き付けない
  });

  it('複数回の呼び出しは最後の thunk だけを1回送る（デバウンス）', async () => {
    const sent = [];
    const q = createCloudQueue((d) => sent.push(d));
    q.pushCloudDebounced(() => 'a', 5);
    q.pushCloudDebounced(() => 'b', 5);
    q.pushCloudDebounced(() => 'c', 5);
    await new Promise((r) => setTimeout(r, 15));
    expect(sent).toEqual(['c']);
  });

  it('navigator.onLine === false では pending を保持し、再オンライン後の flush で送る（#288）', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const sent = [];
    const q = createCloudQueue((d) => sent.push(d));

    q.pushCloudDebounced(() => 'x', 5);
    await new Promise((r) => setTimeout(r, 15));   // タイマー満了で flush が走るが、オフラインなので送らない
    expect(sent).toEqual([]);

    navigator.onLine = true;
    q.flushCloud();                                // 再オンライン後の確定経路
    expect(sent).toEqual(['x']);
  });

  it('flush 済みなら次の flush は no-op（二重送信しない）', async () => {
    const sent = [];
    const q = createCloudQueue((d) => sent.push(d));
    q.pushCloudDebounced(() => 'a', 5);
    await new Promise((r) => setTimeout(r, 15));
    q.flushCloud();
    expect(sent).toEqual(['a']);
  });
});
