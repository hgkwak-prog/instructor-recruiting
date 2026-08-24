/**
 * Self-contained HTML review sheet for one recruitment run.
 * This is what a reviewer actually looks at before approving.
 */

const FIELD_LABELS = {
  role: '역할 구분',
  courseTitle: '교육 과정명',
  customerLabel: '고객사 표기',
  customerDisclosure: '고객사 공개',
  audience: '수강 대상',
  format: '교육 형태',
  location: '장소',
  sessionDates: '교육일',
  hoursPerSession: '회차당 시간',
  totalHours: '총 시간',
  headcount: '모집 인원',
  objectives: '교육 목표 (공고 미노출)',
  curriculumOutline: '일차별 커리큘럼 (공고 미노출)',
  topics: '주요 주제',
  dailySchedule: '교육 시간',
  workingHours: '근무 시간',
  responsibilities: '담당 업무',
  deadlineTime: '마감 시각',
  environmentConstraints: '실습 환경 제약',
  requiredQualifications: '필수 자격',
  preferredQualifications: '우대 조건',
  travelExpenseIncluded: '출장비 포함',
  applicationMethod: '지원 방법',
  deadline: '모집 마감일'
};

export function labelFor(field) {
  return FIELD_LABELS[field] ?? field;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function formatValue(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return value.map((item) => {
      if (!item || typeof item !== 'object') return String(item);
      if ('kind' in item) return `${item.label} (${item.kind}) — ${item.content}`;
      // 자격 조건: 원문 근거인지 모델 제안인지 검토자가 바로 알아야 한다.
      if ('sourced' in item) return `${item.sourced ? '[원문]' : '[제안]'} ${item.text}`;
      return JSON.stringify(item);
    });
  }
  if (typeof value === 'boolean') return value ? '예' : '아니오';
  return String(value);
}

export function buildReport({ runId, result, verification, generatedAt, sourcePath }) {
  const facts = result.facts ?? {};
  const missingByField = new Map((result.missingFields ?? []).map((item) => [item.field, item]));

  const rows = Object.keys(FIELD_LABELS).map((field) => {
    const fact = facts[field];
    const value = formatValue(fact?.value);
    const missing = missingByField.get(field);
    let status = '확인';
    let statusClass = 'ok';
    if (value === null) {
      status = missing?.blocking ? '게시 차단' : '보완 권장';
      statusClass = missing?.blocking ? 'block' : 'warn';
    }
    const shown = value === null
      ? `<span class="empty">${escapeHtml(missing?.question ?? '값 없음')}</span>`
      : (Array.isArray(value)
        ? `<ul>${value.map((v) => `<li>${escapeHtml(v)}</li>`).join('')}</ul>`
        : escapeHtml(value));
    return `<tr>
      <th>${escapeHtml(labelFor(field))}</th>
      <td>${shown}</td>
      <td><span class="tag ${statusClass}">${escapeHtml(status)}</span></td>
      <td class="ev">${escapeHtml(fact?.evidence ?? '—')}</td>
    </tr>`;
  }).join('\n');

  const alerts = [
    ...verification.errors.map((text) => ({ kind: 'block', text })),
    ...verification.warnings.map((text) => ({ kind: 'warn', text })),
    ...(result.warnings ?? []).map((text) => ({ kind: 'warn', text }))
  ];

  const verdict = verification.errors.length > 0
    ? { klass: 'block', label: '게시 불가', detail: '검증 오류를 해결해야 합니다.' }
    : verification.postable
      ? { klass: 'ok', label: '게시 가능', detail: '남은 확인 항목이 없습니다.' }
      : {
        klass: 'warn',
        label: '담당자 입력 필요',
        detail: `${verification.pendingMarkers.length}개 항목을 채운 뒤 게시하세요.`
      };

  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>강사 구인 검토 — ${escapeHtml(facts.courseTitle?.value ?? runId)}</title>
<style>
 :root{--ink:#191919;--mute:#6b6b6b;--line:#e5e2dd;--bg:#faf9f7;--card:#fff;
  --ok:#1a7f5a;--okbg:#e6f4ee;--warn:#9a6200;--warnbg:#fdf3e0;--block:#a52c1f;--blockbg:#fbeae8;}
 *{box-sizing:border-box}
 body{margin:0;padding:32px 20px 64px;background:var(--bg);color:var(--ink);
  font:15px/1.65 -apple-system,BlinkMacSystemFont,"Pretendard","Apple SD Gothic Neo",sans-serif;}
 .wrap{max-width:960px;margin:0 auto}
 header{margin-bottom:24px}
 h1{font-size:22px;margin:0 0 6px;letter-spacing:-.02em}
 .meta{color:var(--mute);font-size:13px}
 .verdict{display:flex;align-items:baseline;gap:12px;padding:14px 18px;border-radius:10px;margin:20px 0 28px;font-weight:600}
 .verdict small{font-weight:400;opacity:.85}
 .verdict.ok{background:var(--okbg);color:var(--ok)}
 .verdict.warn{background:var(--warnbg);color:var(--warn)}
 .verdict.block{background:var(--blockbg);color:var(--block)}
 h2{font-size:15px;margin:28px 0 10px;letter-spacing:-.01em}
 .card{background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
 table{width:100%;border-collapse:collapse}
 th,td{padding:10px 14px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line);font-size:14px}
 tr:last-child th,tr:last-child td{border-bottom:0}
 th{width:132px;font-weight:600;color:var(--mute);background:#fcfbfa}
 td ul{margin:0;padding-left:18px}
 .ev{color:var(--mute);font-size:12px;width:200px}
 .empty{color:var(--mute);font-style:italic}
 .tag{display:inline-block;padding:1px 8px;border-radius:99px;font-size:12px;font-weight:600;white-space:nowrap}
 .tag.ok{background:var(--okbg);color:var(--ok)}
 .tag.warn{background:var(--warnbg);color:var(--warn)}
 .tag.block{background:var(--blockbg);color:var(--block)}
 ul.alerts{list-style:none;margin:0;padding:0}
 ul.alerts li{padding:10px 14px;border-bottom:1px solid var(--line);font-size:14px;display:flex;gap:10px}
 ul.alerts li:last-child{border-bottom:0}
 .bar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:28px 0 10px}
 button{font:inherit;font-weight:600;padding:8px 16px;border-radius:8px;border:1px solid var(--ink);
  background:var(--ink);color:#fff;cursor:pointer}
 button:active{transform:translateY(1px)}
 pre{margin:0;padding:18px;white-space:pre-wrap;word-break:break-word;font:14px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--card)}
 mark{background:#ffe9a8;padding:0 2px;border-radius:3px}
 footer{margin-top:36px;color:var(--mute);font-size:12px}
</style></head><body><div class="wrap">
<header>
 <h1>${escapeHtml(facts.courseTitle?.value ?? '(교육 과정명 미확인)')} — ${escapeHtml(facts.role?.value ?? '역할 미확인')} 구인 검토</h1>
 <div class="meta">run ${escapeHtml(runId)} · 생성 ${escapeHtml(generatedAt)} · 입력 ${escapeHtml(sourcePath ?? '-')}</div>
</header>

<div class="verdict ${verdict.klass}">${escapeHtml(verdict.label)} <small>${escapeHtml(verdict.detail)}</small></div>

<h2>확인된 사실</h2>
<div class="card"><table>${rows}</table></div>

<h2>검증 결과 ${alerts.length === 0 ? '' : `(${alerts.length})`}</h2>
<div class="card">
${alerts.length === 0
    ? '<ul class="alerts"><li>지적 사항 없음</li></ul>'
    : `<ul class="alerts">${alerts.map((a) =>
      `<li><span class="tag ${a.kind}">${a.kind === 'block' ? '차단' : '주의'}</span><span>${escapeHtml(a.text)}</span></li>`
    ).join('')}</ul>`}
</div>

<div class="bar"><h2 style="margin:0">Slack 게시용 초안</h2>
 <button id="copy" type="button">클립보드로 복사</button></div>
<div class="card"><pre id="post">${escapeHtml(verification.slackJobPost)
    .replace(/\[확인 필요: [^\]]+\]/g, (m) => `<mark>${m}</mark>`)}</pre></div>

<footer>본문은 확인된 사실로부터 코드가 조립합니다. 날짜·요일·시간 합계는 모델이 작성하지 않습니다.<br>
검토 후 담당자가 직접 Slack에 붙여넣고, <code>recruit approve --run-id ${escapeHtml(runId)}</code> 로 승인 기록을 남기세요.</footer>
</div>
<script>
 const raw = ${JSON.stringify(verification.slackJobPost)};
 document.getElementById('copy').addEventListener('click', async (event) => {
   const button = event.currentTarget;
   try { await navigator.clipboard.writeText(raw); button.textContent = '복사됨'; }
   catch { const r = document.createRange(); r.selectNodeContents(document.getElementById('post'));
     const s = getSelection(); s.removeAllRanges(); s.addRange(r); button.textContent = '선택됨 — Cmd+C'; }
   setTimeout(() => { button.textContent = '클립보드로 복사'; }, 2000);
 });
</script>
</body></html>`;
}
