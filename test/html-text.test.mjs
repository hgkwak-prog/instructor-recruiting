import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeEntities, htmlToText, looksLikeHtml } from '../core/html-text.mjs';
import { isHtmlFile, isSupportedFile } from '../adapters/slack/intake.mjs';
import { MAX_SOURCE_CHARS, assertReadableSize } from '../adapters/documents/files.mjs';

test('스타일과 스크립트는 내용까지 버린다', () => {
  // 이 팀의 HTML 산출물은 인라인 CSS·JS가 본문보다 길 때가 있다.
  // 그대로 모델에 넣으면 태그 뭉치에 구독 한도를 태운다.
  const html = `
    <html><head><title>제안서</title><style>.a{color:red}</style></head>
    <body><script>var x = "교육";</script><p>AI 코딩 기초 교육</p></body></html>`;
  const text = htmlToText(html);
  assert.equal(text, 'AI 코딩 기초 교육');
  assert.ok(!text.includes('color'));
  assert.ok(!text.includes('var x'));
});

test('블록 태그가 줄바꿈이 된다 — 안 그러면 문장이 다 붙는다', () => {
  // 블록 사이에 빈 줄이 남는다. 일부러 그렇게 둔다 — 커리큘럼은 문단·섹션
  // 구조가 뜻을 나르므로, 다 붙여 놓으면 모델이 회차 경계를 놓친다.
  assert.equal(htmlToText('<h1>제목</h1><p>첫 문단</p><p>둘째 문단</p>'), '제목\n\n첫 문단\n\n둘째 문단');
});

test('목록은 글머리표로 남는다', () => {
  const text = htmlToText('<ul><li>Claude Code</li><li>MCP 연동</li></ul>');
  assert.equal(text, '• Claude Code\n• MCP 연동');
});

test('표는 셀 구분을 남긴다 — 일정표가 한 줄로 뭉치면 못 읽는다', () => {
  const text = htmlToText(
    '<table><tr><td>1일차</td><td>2026-09-01</td></tr><tr><td>2일차</td><td>2026-09-08</td></tr></table>'
  );
  assert.match(text, /1일차\t2026-09-01/);
  assert.match(text, /2일차\t2026-09-08/);
});

test('<br>도 줄바꿈이다', () => {
  assert.equal(htmlToText('가<br>나<br/>다'), '가\n나\n다');
});

test('엔티티를 되돌린다', () => {
  assert.equal(decodeEntities('A&nbsp;&amp;&nbsp;B'), 'A & B');
  assert.equal(decodeEntities('&lt;태그&gt;'), '<태그>');
  assert.equal(decodeEntities('&#54620;&#44544;'), '한글');
  assert.equal(decodeEntities('&#xAC00;'), '가');
});

test('모르는 엔티티는 지우지 않고 그대로 둔다', () => {
  // 지우면 글자가 사라진 줄 모른다.
  assert.equal(decodeEntities('&zwnj;'), '&zwnj;');
});

test('주석은 버린다', () => {
  assert.equal(htmlToText('<p>본문</p><!-- 내부 메모: 금액 5,000,000 -->'), '본문');
});

test('빈 줄이 과하게 늘어나지 않는다', () => {
  const text = htmlToText('<div></div><div></div><p>가</p><div></div><div></div><p>나</p>');
  assert.ok(!text.includes('\n\n\n'));
  assert.match(text, /가[\s\S]*나/);
});

test('줄 안의 공백만 줄이고 줄 구조는 지킨다', () => {
  assert.equal(htmlToText('<p>하루   7시간</p><p>총   21시간</p>'), '하루 7시간\n\n총 21시간');
});

test('탭은 공백으로 뭉개지 않는다', () => {
  // 셀 구분자다. 공백이 되면 `1일차 2026-09-01`에서 어디까지가 한 칸인지 사라진다.
  assert.equal(htmlToText('<table><tr><td>가</td><td>나</td></tr></table>'), '가\t나');
});

test('문자열이 아니면 빈 문자열이다', () => {
  for (const bad of [null, undefined, 42, {}]) assert.equal(htmlToText(bad), '');
});

test('HTML인지 알아본다', () => {
  assert.ok(looksLikeHtml('<!DOCTYPE html><html>'));
  assert.ok(looksLikeHtml('<div>x</div>'));
  assert.ok(!looksLikeHtml('# 마크다운 제목'));
});

// --- 인테이크가 받는 형식 ------------------------------------------------------

test('HTML도 받는다', () => {
  for (const name of ['제안서.html', '덱.htm', 'x.HTML']) {
    assert.ok(isSupportedFile({ name }), name);
  }
  assert.ok(isHtmlFile({ name: '제안서.html' }));
  assert.ok(isHtmlFile({ mimetype: 'text/html' }));
  assert.ok(!isHtmlFile({ name: '커리큘럼.pdf' }));
});

test('기존 형식도 그대로 받는다', () => {
  for (const file of [{ name: 'a.pdf' }, { name: 'b.txt' }, { name: 'c.md' }, { mimetype: 'application/pdf' }]) {
    assert.ok(isSupportedFile(file), JSON.stringify(file));
  }
  assert.ok(!isSupportedFile({ name: 'x.hwp' }));
});

// --- 크기 상한 ----------------------------------------------------------------

test('너무 긴 입력은 자르지 않고 거절한다', () => {
  // 조용히 잘린 커리큘럼에서 뽑은 사실은 틀린 줄도 모르고 공고로 나간다.
  assert.throws(
    () => assertReadableSize('가'.repeat(MAX_SOURCE_CHARS + 1), '제안서.html'),
    /너무 깁니다/
  );
  const fine = '가'.repeat(100);
  assert.equal(assertReadableSize(fine, 'x'), fine);
});

test('거절 메시지가 무엇을 하라고 알려준다', () => {
  try {
    assertReadableSize('가'.repeat(MAX_SOURCE_CHARS + 1), '제안서.html');
    assert.fail('던졌어야 합니다');
  } catch (error) {
    assert.match(error.message, /커리큘럼 부분만 잘라/);
    assert.match(error.message, /사용 한도/);
  }
});
