import test from 'node:test';
import assert from 'node:assert/strict';
import { callSheets, fetchDecisions, sheetsConfigured } from '../adapters/sheets/sheets.mjs';

function withFetch(handler, run) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return Promise.resolve(run()).finally(() => { globalThis.fetch = original; });
}

/** Apps Script always answers 200, even when it rejects the request. */
function appsScript(body) {
  return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
}

test('sheetsConfigured requires both env vars', () => {
  const saved = { ...process.env };
  delete process.env.SHEETS_WEBHOOK_URL;
  delete process.env.SHEETS_WEBHOOK_SECRET;
  assert.equal(sheetsConfigured(), false);
  process.env.SHEETS_WEBHOOK_URL = 'https://example.test/exec';
  assert.equal(sheetsConfigured(), false, 'URL만 있으면 연동으로 보지 않습니다');
  process.env.SHEETS_WEBHOOK_SECRET = 's';
  assert.equal(sheetsConfigured(), true);
  process.env = saved;
});

test('the shared secret is sent in the body, never in the URL', async () => {
  let seen = null;
  await withFetch(async (url, init) => {
    seen = { url, body: JSON.parse(init.body), method: init.method };
    return appsScript(JSON.stringify({ ok: true }));
  }, async () => {
    await callSheets('https://example.test/exec', 'top-secret', 'recruitment.generated', { runId: 'r1' });
  });
  assert.equal(seen.method, 'POST');
  assert.ok(!seen.url.includes('top-secret'), '시크릿이 URL에 노출되면 안 됩니다');
  assert.equal(seen.body.sharedSecret, 'top-secret');
  assert.equal(seen.body.event, 'recruitment.generated');
  assert.equal(seen.body.runId, 'r1');
});

test('rejects unauthorized even though the HTTP status is 200', async () => {
  await withFetch(async () => appsScript(JSON.stringify({ ok: false, error: 'unauthorized' })), async () => {
    await assert.rejects(
      () => callSheets('https://example.test/exec', 'wrong', 'recruitment.completed'),
      /unauthorized/
    );
  });
});

test('rejects an HTML login page instead of silently succeeding', async () => {
  await withFetch(async () => new Response('<!doctype html><html>Sign in</html>', { status: 200 }), async () => {
    await assert.rejects(
      () => callSheets('https://example.test/exec', 's', 'recruitment.completed'),
      /JSON을 반환하지 않았습니다/
    );
  });
});

test('surfaces a network failure as a clear error', async () => {
  await withFetch(async () => { throw new TypeError('fetch failed'); }, async () => {
    await assert.rejects(() => callSheets('https://example.test/exec', 's', 'x'), /호출 실패/);
  });
});

test('fetchDecisions returns rows and tolerates an empty sheet', async () => {
  await withFetch(async () => appsScript(JSON.stringify({
    ok: true,
    rows: [{ runId: 'r1', status: '승인됨', reviewedBy: 'kyogoku', slackApplicants: 2 }]
  })), async () => {
    const rows = await fetchDecisions('https://example.test/exec', 's');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, '승인됨');
  });

  await withFetch(async () => appsScript(JSON.stringify({ ok: true })), async () => {
    assert.deepEqual(await fetchDecisions('https://example.test/exec', 's'), []);
  });
});
