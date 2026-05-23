#!/usr/bin/env node
// 테스트를 실행하고 결과를 UTF-8로 저장한다.
// 사용법: node scripts/save-test.js <npm-script> <output-file>
const { spawnSync } = require('child_process');
const fs = require('fs');

const script = process.argv[2];
const outFile = process.argv[3] || 'test-output.txt';

if (!script) {
  console.error('사용법: node scripts/save-test.js <npm-script> <output-file>');
  process.exit(1);
}

const result = spawnSync('npm', ['run', script], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: true,
});

if (result.error) {
  const errMsg = `실행 오류: ${result.error.message}\n`;
  fs.writeFileSync(outFile, errMsg, 'utf8');
  console.error(errMsg);
  process.exit(1);
}

const output = [result.stdout, result.stderr].filter(Boolean).join('');
fs.writeFileSync(outFile, output, 'utf8');
console.log(`→ ${outFile} 저장 완료 (UTF-8, ${output.length} bytes)`);
process.exit(result.status ?? 0);
