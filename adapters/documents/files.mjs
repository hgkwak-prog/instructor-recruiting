/**
 * 입력 문서 읽기.
 *
 * PDF는 `pdf-parse`로 읽는다. 예전에는 `pdftotext`(poppler) 바이너리를 스폰했는데,
 * Slack이 보내는 PDF는 파일 경로가 아니라 **메모리 위의 버퍼**로 도착하고,
 * 컨테이너 이미지에 poppler를 넣어야 하는 시스템 의존성도 생긴다.
 * 순수 JS 파서로 바꾸면 경로 입력(CLI)과 버퍼 입력(Slack)을 한 함수로 다룰 수 있다.
 */
import { readFile, access } from 'node:fs/promises';
import { extname } from 'node:path';
import { htmlToText } from '../../core/html-text.mjs';

const TEXT_EXTENSIONS = ['.txt', '.md'];
const HTML_EXTENSIONS = ['.html', '.htm'];
export const SUPPORTED_EXTENSIONS = [...TEXT_EXTENSIONS, ...HTML_EXTENSIONS, '.pdf'];

/**
 * 모델에 넣을 글자 수 상한.
 *
 * 제안서 덱 HTML은 통째로 넘기면 수십만 자가 되기도 한다. 그걸 그대로 보내면
 * 담당자 구독 한도가 한 번에 크게 빠진다. 자르는 대신 **거절한다** —
 * 조용히 잘린 커리큘럼에서 뽑은 사실은 틀린 줄도 모르고 공고로 나간다.
 */
export const MAX_SOURCE_CHARS = 120_000;

export function assertReadableSize(text, label) {
  if (text.length > MAX_SOURCE_CHARS) {
    throw new Error(
      `${label}이 너무 깁니다 (${text.length.toLocaleString('ko-KR')}자, 상한 `
      + `${MAX_SOURCE_CHARS.toLocaleString('ko-KR')}자). 커리큘럼 부분만 잘라 보내 주세요. `
      + '전체를 넣으면 필요 없는 내용까지 읽느라 사용 한도가 크게 빠집니다.'
    );
  }
  return text;
}

/** PDF 버퍼에서 텍스트를 뽑는다. 경로가 아니라 바이트를 받는 것이 요점이다. */
export async function readPdfBuffer(buffer, { label = 'PDF' } = {}) {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  let text;
  try {
    ({ text } = await parser.getText());
  } finally {
    await parser.destroy?.();
  }
  if (!text?.trim()) {
    throw new Error(
      `${label}에서 텍스트를 찾지 못했습니다. 스캔 이미지로 된 PDF일 수 있습니다. `
      + '텍스트로 변환해 다시 넣어 주세요.'
    );
  }
  return assertReadableSize(text, label);
}

/** 확장자로 형식을 판별해 텍스트를 돌려준다. */
export async function readSourceAsync(path) {
  try {
    await access(path);
  } catch {
    throw new Error(`입력 파일을 찾을 수 없습니다: ${path}`);
  }
  const extension = extname(path).toLowerCase();
  if (TEXT_EXTENSIONS.includes(extension)) {
    return assertReadableSize(await readFile(path, 'utf8'), path);
  }
  if (HTML_EXTENSIONS.includes(extension)) {
    return assertReadableSize(htmlToText(await readFile(path, 'utf8')), path);
  }
  if (extension === '.pdf') return readPdfBuffer(await readFile(path), { label: path });
  throw new Error(
    `지원하지 않는 입력 형식입니다: ${extension}. 현재 ${SUPPORTED_EXTENSIONS.join(', ')}를 지원합니다.`
  );
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}
