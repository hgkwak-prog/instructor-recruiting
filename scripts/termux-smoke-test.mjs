#!/usr/bin/env node
/**
 * Termux(안드로이드) 이식 검증용 스모크 테스트.
 *
 * `@anthropic-ai/claude-agent-sdk`는 플랫폼별 네이티브 바이너리를
 * optionalDependencies로 받는다(linux-arm64/linux-arm64-musl/darwin-arm64/...).
 * Termux 기본 유저랜드는 커널은 리눅스지만 libc가 Bionic(안드로이드 고유)이라
 * glibc용도 musl용도 아니다 — `npm install`이 조용히 끝나도 실제로 SDK를
 * import하는 순간 네이티브 바이너리 로딩이 깨질 수 있다.
 *
 * 이 스크립트는 **모델을 호출하지 않는다.** SDK가 import되고 `query`가
 * 함수로 잡히는지만 확인한다 — 실패한다면 십중팔구 네이티브 바이너리 문제고,
 * 여기서 성공해야 실제 추출 파이프라인을 테스트할 가치가 있다.
 *
 * 사용법: node scripts/termux-smoke-test.mjs
 */

console.log(`Node ${process.version} / ${process.platform}-${process.arch}`);

try {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  if (typeof query !== 'function') {
    throw new TypeError(`query가 함수가 아닙니다: ${typeof query}`);
  }
  console.log('✅ SDK 로드 성공 — query() 사용 가능. 네이티브 바이너리가 이 환경에서 동작합니다.');
  console.log('   다음 단계: npm test, 그다음 실제 커리큘럼으로 --dry-run 확인.');
  process.exit(0);
} catch (error) {
  console.error('❌ SDK 로드 실패.');
  console.error(`   ${error.message}`);
  console.error('');
  console.error('   흔한 원인: Termux 기본 유저랜드(Bionic libc)에서 npm이 받은');
  console.error('   linux-arm64 네이티브 바이너리(glibc 대상)가 링크되지 않는 것.');
  console.error('   proot-distro로 Ubuntu ARM64 같은 진짜 glibc 유저랜드를 깔고');
  console.error('   그 안에서 node/npm install/이 스크립트를 다시 돌려보세요.');
  console.error('   (docs/termux-setup.md 참고)');
  process.exit(1);
}
