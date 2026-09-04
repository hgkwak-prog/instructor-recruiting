/**
 * 한 건이 만들어지는 동안의 중간 산출물을 전부 남긴다.
 *
 * 봇은 Slack UI라 결과만 보인다. 무엇이 잘못됐을 때 "모델이 이상하게 뽑았나,
 * 파서가 글을 놓쳤나, 내가 넣은 운영사항이 안 먹었나"를 가릴 방법이 있어야 한다.
 * 그래서 `data/runs/<run-id>/`에 단계별로 하나씩 떨군다.
 *
 *   curriculum.txt     파서가 뽑아낸 텍스트 — PDF·HTML이 무엇으로 바뀌었는지
 *   conditions.json    사람이 넣은 운영사항 — 모달에 무엇을 쳤는지
 *   prompt.txt         모델에 보낸 글자 그대로
 *   schema.json        outputFormat으로 함께 보낸 스키마
 *   result.json        모델이 돌려준 facts
 *   verification.json  검산 결과 (오류·경고·조립된 공고·게시 가능 여부)
 *
 * 스키마를 남기는 이유: 항목별 추출 기준은 각 필드의 `description`에 있고, 그건
 * 프롬프트가 아니라 `outputFormat`으로 간다. 스키마가 없으면 `prompt.txt`만 보고
 * "모델이 무슨 지시를 받았나"를 답할 수 없다. 둘을 합쳐야 그 답이 나온다.
 *
 * **CLI와 봇이 같은 것을 남긴다.** 그래야 CLI로 검수한 결과를 봇 동작이라고
 * 믿을 수 있다. 한쪽만 남기면 검수가 검수가 아니게 된다.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

export function writeRunArtifacts(runDirectory, artifacts) {
  mkdirSync(runDirectory, { recursive: true });
  const written = [];
  const put = (name, contents) => {
    if (contents === undefined || contents === null) return;
    writeFileSync(join(runDirectory, name), contents);
    written.push(name);
  };

  put('curriculum.txt', artifacts.curriculum);
  put('conditions.json', artifacts.conditions && json(artifacts.conditions));
  put('prompt.txt', artifacts.prompt);
  put('schema.json', artifacts.schema && json(artifacts.schema));
  put('result.json', artifacts.result && json(artifacts.result));
  put('verification.json', artifacts.verification && json(artifacts.verification));
  return written;
}
