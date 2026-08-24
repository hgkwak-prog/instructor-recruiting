/**
 * core/ 의 의존성 0을 기계적으로 강제한다.
 *
 * 이 레포의 설계 전제는 "모델은 사실만 추출하고, 공고 본문은 코드가 조립한다"이고,
 * 그 조립 코드(core/)가 외부 서비스 없이 테스트되는 성질이 통합 과정에서 가장
 * 잃기 쉬운 것이다. Slack 클라이언트 하나를 core에 들이는 순간 테스트가 네트워크를
 * 타기 시작한다. 사람 눈으로 막지 말고 CI가 막는다.
 *
 * 허용: node: 빌트인, core/ 내부 상대 경로
 * 금지: npm 패키지, core 바깥(../adapters, ../apps 등)으로 나가는 상대 경로
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const coreRoot = join(projectRoot, 'core');

function walk(directory) {
  const found = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) found.push(...walk(path));
    else if (entry.endsWith('.mjs')) found.push(path);
  }
  return found;
}

// import ... from 'x'  /  export ... from 'x'  /  import('x')
const STATIC = /^\s*(?:import|export)\b[^'"]*?from\s*['"]([^'"]+)['"]/gm;
const BARE = /^\s*import\s*['"]([^'"]+)['"]/gm;
const DYNAMIC = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function specifiers(source) {
  const found = [];
  for (const pattern of [STATIC, BARE, DYNAMIC]) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) found.push(match[1]);
  }
  return found;
}

const violations = [];
for (const file of walk(coreRoot)) {
  const shown = relative(projectRoot, file);
  for (const specifier of specifiers(readFileSync(file, 'utf8'))) {
    if (specifier.startsWith('node:')) continue;

    if (!specifier.startsWith('.')) {
      violations.push(`${shown}: 외부 패키지 '${specifier}' — core는 의존성 0이다`);
      continue;
    }

    const target = resolve(dirname(file), specifier);
    if (!target.startsWith(coreRoot + '/')) {
      violations.push(
        `${shown}: '${specifier}' 가 core 바깥(${relative(projectRoot, target)})을 가리킨다`
      );
    }
  }
}

if (violations.length > 0) {
  console.error('core/ 의존성 규칙 위반:');
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}

console.log(`core/ 의존성 0 확인 (파일 ${walk(coreRoot).length}개)`);
