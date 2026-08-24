import { createServer } from 'node:http';

function json(response, statusCode, body) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  response.end(JSON.stringify(body));
}

/**
 * 구독 토큰의 남은 수명(일).
 *
 * `claude setup-token`이 발급하는 토큰은 1년짜리인데, 만료 경고가 뜨지 않는다
 * (경고는 `/login` 자격증명에만 붙는다). 상주 봇은 **어느 날 조용히 죽는다.**
 * 토큰 자체에서 만료일을 읽을 방법이 없으므로 발급일을 환경변수로 받아 센다.
 * 부정확할 수 있지만, 아무 경고도 없는 것보다는 낫다.
 */
export function tokenDaysRemaining({ issuedAt, lifetimeDays = 365, now = new Date() }) {
  if (!issuedAt) return null;
  const issued = new Date(issuedAt);
  if (Number.isNaN(issued.getTime())) return null;
  const elapsedDays = (now.getTime() - issued.getTime()) / 86_400_000;
  return Math.floor(lifetimeDays - elapsedDays);
}

export function startHealthServer({
  pingDatabase,
  host = '0.0.0.0',
  port = 3000,
  isReady = () => true,
  isShuttingDown = () => false,
  tokenIssuedAt = process.env.CLAUDE_CODE_OAUTH_TOKEN_ISSUED_AT ?? null,
  tokenWarnDays = 30,
  logger = console
}) {
  const server = createServer((request, response) => {
    if (request.method !== 'GET') return json(response, 405, { status: 'method_not_allowed' });

    if (request.url === '/healthz') {
      const down = isShuttingDown();
      return json(response, down ? 503 : 200, { status: down ? 'shutting_down' : 'ok' });
    }

    if (request.url === '/readyz') {
      let databaseReady = false;
      try {
        databaseReady = pingDatabase();
      } catch {
        databaseReady = false;
      }
      const days = tokenDaysRemaining({ issuedAt: tokenIssuedAt });
      const tokenExpired = days !== null && days <= 0;
      const ready = !isShuttingDown() && isReady() && databaseReady && !tokenExpired;

      return json(response, ready ? 200 : 503, {
        status: ready ? 'ready' : 'not_ready',
        database: databaseReady ? 'ok' : 'unavailable',
        token: days === null
          ? 'unknown'
          : tokenExpired
            ? 'expired'
            : days <= tokenWarnDays ? 'expiring' : 'ok',
        tokenDaysRemaining: days
      });
    }

    json(response, 404, { status: 'not_found' });
  });

  server.listen(port, host, () => logger.log(`헬스 서버 http://${host}:${port} (/healthz, /readyz)`));
  return server;
}
