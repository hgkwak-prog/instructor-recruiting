/**
 * HTML에서 사람이 읽는 글만 뽑는다.
 *
 * 이 팀이 만드는 HTML은 대개 **완성된 문서**다 — 제안서 덱, 리서치 브리프.
 * 인라인 `<style>`과 `<script>`가 본문보다 길 때도 있다. 그대로 모델에 넣으면
 * 태그 뭉치에 구독 한도를 태우고, 추출 정확도도 떨어진다.
 *
 * 파서를 붙이지 않는 이유: `core/`는 의존성 0이고, 우리가 다루는 것은
 * 우리가 만든 정적 문서다. 임의의 웹페이지를 긁는 게 아니라서 이 정도면 된다.
 * 대신 무엇을 버리고 무엇을 남기는지 아래에 다 적어 둔다.
 */

/** 통째로 버릴 것. 내용까지 지운다. */
const DROP_WHOLE = /<(script|style|noscript|template|svg|head)\b[^>]*>[\s\S]*?<\/\1>/gi;
const COMMENTS = /<!--[\s\S]*?-->/g;

/** 줄바꿈이 생겨야 하는 태그. 없으면 문장이 다 붙어버린다. */
const BLOCK = /<\/?(p|div|section|article|header|footer|h[1-6]|tr|table|ul|ol|blockquote|pre|hr)\b[^>]*>/gi;
const LINE_BREAK = /<br\s*\/?>/gi;
const LIST_ITEM = /<li\b[^>]*>/gi;
const CELL = /<\/(td|th)>/gi;

const TAG = /<[^>]+>/g;

const ENTITIES = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>',
  '&quot;': '"', '&#39;': "'", '&apos;': "'",
  '&middot;': '·', '&hellip;': '…', '&mdash;': '—', '&ndash;': '–'
};

export function decodeEntities(text) {
  return text
    .replace(/&[a-z]+;|&#\d+;|&#x[0-9a-f]+;/gi, (entity) => {
      const known = ENTITIES[entity.toLowerCase()];
      if (known !== undefined) return known;
      const decimal = /^&#(\d+);$/.exec(entity);
      if (decimal) return String.fromCodePoint(Number(decimal[1]));
      const hex = /^&#x([0-9a-f]+);$/i.exec(entity);
      if (hex) return String.fromCodePoint(Number.parseInt(hex[1], 16));
      // 모르는 엔티티는 그대로 둔다. 지우면 글자가 사라진 줄 모른다.
      return entity;
    });
}

export function htmlToText(html) {
  if (typeof html !== 'string') return '';

  const text = html
    .replace(COMMENTS, '')
    .replace(DROP_WHOLE, '\n')
    .replace(LINE_BREAK, '\n')
    .replace(LIST_ITEM, '\n• ')
    .replace(CELL, '\t')
    .replace(BLOCK, '\n')
    .replace(TAG, '');

  return decodeEntities(text)
    .split('\n')
    // 줄 안의 연속 공백만 줄인다. **탭은 남긴다** — 표의 셀 구분자라서
    // 공백으로 뭉개면 `1일차 2026-09-01`이 되어 어디까지가 한 칸인지 사라진다.
    .map((line) => line.replace(/[^\S\t\n]+/g, ' ').replace(/ *\t */g, '\t').trim())
    .join('\n')
    // 빈 줄이 셋 이상이면 둘로. 문단 구분은 남기고 여백만 줄인다.
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function looksLikeHtml(text) {
  return typeof text === 'string' && /<(!doctype|html|body|div|p|h[1-6]|table)\b/i.test(text);
}
