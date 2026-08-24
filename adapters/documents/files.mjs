import { readFileSync, existsSync } from 'node:fs';
import { extname } from 'node:path';
import { spawnSync } from 'node:child_process';

export function readSource(path) {
  if (!existsSync(path)) throw new Error(`입력 파일을 찾을 수 없습니다: ${path}`);
  const extension = extname(path).toLowerCase();
  if (['.txt', '.md'].includes(extension)) return readFileSync(path, 'utf8');
  if (extension === '.pdf') {
    const result = spawnSync('pdftotext', ['-layout', path, '-'], { encoding: 'utf8' });
    if (result.error) {
      throw new Error('PDF 텍스트 추출에는 pdftotext가 필요합니다. macOS는 `brew install poppler`, Linux는 poppler-utils를 설치하거나 추출된 .txt 파일을 입력하세요.');
    }
    if (result.status !== 0 || !result.stdout.trim()) throw new Error(`PDF 텍스트 추출 실패: ${result.stderr}`);
    return result.stdout;
  }
  throw new Error(`지원하지 않는 입력 형식입니다: ${extension}. 현재 .txt, .md, .pdf를 지원합니다.`);
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
