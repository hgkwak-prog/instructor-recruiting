/**
 * Google Sheets control plane.
 *
 * Apps Script's ContentService cannot set an HTTP status code -- a rejected
 * request still returns 200. Success must be read from the response body, never
 * from `response.ok`, or an unauthorized call gets recorded as a successful write.
 *
 * Reads go through POST as well, so the shared secret never appears in a URL
 * (and therefore never in a proxy or browser history).
 */

export function sheetsConfigured() {
  return Boolean(process.env.SHEETS_WEBHOOK_URL && process.env.SHEETS_WEBHOOK_SECRET);
}

export function requireSheetsConfig() {
  if (!process.env.SHEETS_WEBHOOK_URL) {
    throw new Error('SHEETS_WEBHOOK_URL이 필요합니다. 흐름 검증만 하려면 --local-only를 사용하세요.');
  }
  if (!process.env.SHEETS_WEBHOOK_SECRET) {
    throw new Error('SHEETS_WEBHOOK_SECRET이 필요합니다. 흐름 검증만 하려면 --local-only를 사용하세요.');
  }
  return { url: process.env.SHEETS_WEBHOOK_URL, secret: process.env.SHEETS_WEBHOOK_SECRET };
}

export async function callSheets(url, secret, event, payload = {}, { timeoutMs = 20000 } = {}) {
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...payload, event, sharedSecret: secret }),
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    throw new Error(`Google Sheets webhook 호출 실패: ${error.message}`);
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Google Sheets webhook 실패: HTTP ${response.status} ${text.slice(0, 200)}`);
  }

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(
      `Google Sheets webhook이 JSON을 반환하지 않았습니다. 웹 앱 배포 접근 권한과 /exec URL을 확인하세요: ${text.slice(0, 200)}`
    );
  }
  if (body.ok !== true) throw new Error(`Google Sheets webhook 거부: ${body.error ?? '알 수 없는 오류'}`);
  return body;
}

/** Push a freshly generated draft so a reviewer can act on it in the sheet. */
export function publishGenerated(url, secret, run) {
  return callSheets(url, secret, 'recruitment.generated', run);
}

/** Mirror a CLI-side approval/rejection back into the sheet. */
export function publishReview(url, secret, run) {
  return callSheets(url, secret, 'recruitment.reviewed', run);
}

export function recordCompletion(url, secret, run) {
  return callSheets(url, secret, 'recruitment.completed', run);
}

/** Pull reviewer decisions and outcome numbers entered by hand in the sheet. */
export async function fetchDecisions(url, secret) {
  const body = await callSheets(url, secret, 'recruitment.sync_request');
  return Array.isArray(body.rows) ? body.rows : [];
}
