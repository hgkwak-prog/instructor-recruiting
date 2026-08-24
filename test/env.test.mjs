import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { envNumber, envOr } from '../core/env.mjs';

test('빈 문자열은 설정되지 않은 것으로 본다', () => {
  // `.env`에서 온 값은 비어 있어도 빈 문자열이다. `??`로는 못 거른다.
  // 실제로 `CAREERDAY_BROWSER_PROFILE=` 한 줄이 mkdir('')까지 가서 죽었다.
  assert.equal(envOr({ X: '' }, 'X', '기본값'), '기본값');
  assert.equal(envOr({ X: '   ' }, 'X', '기본값'), '기본값');
  assert.equal(envOr({}, 'X', '기본값'), '기본값');
});

test('값이 있으면 앞뒤 공백을 떼고 돌려준다', () => {
  assert.equal(envOr({ X: ' 값 ' }, 'X'), '값');
});

test('기본값이 없으면 null이다', () => {
  assert.equal(envOr({ X: '' }, 'X'), null);
});

test('숫자가 아닌 값은 조용히 기본값으로 넘어가지 않는다', () => {
  // `RECRUIT_DAILY_CALL_LIMIT=삼십`이 30으로 둔갑하면 아무도 모른다.
  assert.equal(envNumber({ N: '50' }, 'N', 30), 50);
  assert.equal(envNumber({ N: '' }, 'N', 30), 30);
  assert.throws(() => envNumber({ N: '삼십' }, 'N', 30), /숫자여야 합니다/);
});

test('.env.example의 빈 항목이 전부 기본값으로 떨어진다', () => {
  // 우리가 `cp .env.example .env` 하라고 안내하므로, 그 템플릿이 만드는 설정이
  // 그대로 동작해야 한다. 이 테스트가 없어서 안내대로 하면 죽는 상태였다.
  const example = readFileSync(join(import.meta.dirname, '..', '.env.example'), 'utf8');
  const blanks = [...example.matchAll(/^([A-Z_]+)=$/gm)].map((match) => match[1]);
  assert.ok(blanks.length > 0, '템플릿에 빈 항목이 있어야 이 테스트가 의미 있습니다');

  const env = Object.fromEntries(blanks.map((name) => [name, '']));
  for (const name of blanks) {
    assert.equal(envOr(env, name, '기본값'), '기본값', `${name}이 빈 문자열로 새어 나갑니다`);
  }
});

test('코드 어디에도 process.env를 ??로 읽는 곳이 없다', async () => {
  // 이 패턴이 이 버그의 원인이다. 되살아나면 여기서 잡는다.
  const { readdirSync, statSync } = await import('node:fs');
  const root = join(import.meta.dirname, '..');
  const offenders = [];

  const walk = (directory) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith('.mjs')) {
        for (const [index, line] of readFileSync(path, 'utf8').split('\n').entries()) {
          // 주석은 코드가 아니다. env.mjs가 이 패턴을 설명하면서 스스로 걸렸다.
          if (/^\s*(\*|\/\/)/.test(line)) continue;
          if (/process\.env\.[A-Z_]+\s*\?\?/.test(line)) {
            offenders.push(`${entry}:${index + 1}`);
          }
        }
      }
    }
  };
  for (const directory of ['core', 'adapters', 'apps']) walk(join(root, directory));

  assert.deepEqual(offenders, [], 'envOr / envNumber를 쓰세요');
});
