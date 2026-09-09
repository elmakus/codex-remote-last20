import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

function control(...args) {
  return spawnSync('bash', ['./control.sh', ...args], {
    cwd: new URL('.', import.meta.url),
    encoding: 'utf8',
  });
}

test('rejects thread IDs that could inject systemd directives', () => {
  const result=control('setup', 'thread\nEnvironment=UNSAFE=1', 'desktop.service');
  assert.notEqual(result.status, 0);
});

test('rejects malformed desktop unit names before changing systemd', () => {
  const result=control('setup', 'thread-safe', '../desktop.service');
  assert.notEqual(result.status, 0);
});

test('prints the complete supported usage', () => {
  const result=control('unknown');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /setup THREAD_ID \[DESKTOP_UNIT\.service\] \| switch \| rollback/);
});
