import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Hosted CI runs as its ordinary user. A single-UID local namespace may expose
// UID0 without any capabilities; accept it only with no privilege and prove the
// filesystem permission boundary below. Privileged root would conceal this bug.
if (process.getuid() === 0) {
  const status = readFileSync('/proc/self/status', 'utf8');
  for (const field of ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb']) assert.match(status, new RegExp(`^${field}:\\s+0+$`, 'm'));
  assert.match(status, /^NoNewPrivs:\s+1$/m);
}
const here = dirname(fileURLToPath(import.meta.url));
const image = `sha256:${'a'.repeat(64)}`;
const gateway = 'b'.repeat(64);
const container = 'arthello-caddy-fixture-12345-1';

const fakeDocker = `#!/usr/bin/python3
import hashlib,json,os,pathlib,shutil,sys
a=sys.argv[1:]
root=pathlib.Path(os.environ['FAKE_ROOT'])
mode=os.environ['FAKE_MODE']
with (root/'docker.jsonl').open('a') as f: f.write(json.dumps(a)+'\\n')
state_file=root/'docker-state.json'
state=json.loads(state_file.read_text()) if state_file.exists() else {}
gateway='b'*64
binary=b'synthetic public Caddy executable fixture\\n'
name='arthello-caddy-fixture-12345-1'
if a==['image','inspect','sha256:'+'a'*64,'--format','{{.Config.User}}']:
 print('node'); sys.exit(0)
if a==['inspect','stroios-caddy-1','--format','{{.Id}}']:
 print('c'*64 if mode=='gateway_changed' and state.get('ran') else gateway); sys.exit(0)
if a==['inspect',gateway,'--format','{{.State.Running}}']:
 print('true'); sys.exit(0)
if a==['exec',gateway,'sha256sum','/usr/bin/caddy']:
 print(hashlib.sha256(binary).hexdigest()+'  /usr/bin/caddy'); sys.exit(0)
if a==['inspect',name]: sys.exit(0 if mode=='existing_container' else 1)
if a==['inspect',name,'--format','{{index .Config.Labels "arthello.caddy-fixture.invocation"}}']:
 if not state.get('ran'): sys.exit(1)
 print('another-invocation' if mode=='foreign_container' else '12345-1'); sys.exit(0)
if a==['exec',gateway,'cat','/usr/bin/caddy']:
 if mode=='copy_failure': sys.exit(9)
 sys.stdout.buffer.write(binary); sys.exit(0)
if a==['rm','-f',name]:
 state['removed']=True; state_file.write_text(json.dumps(state)); sys.exit(0)
if a and a[0]=='run':
 mount=a[a.index('--mount')+1]
 work=pathlib.Path(mount.split('src=',1)[1].split(',dst=',1)[0])
 state.update(ran=True,work=str(work)); state_file.write_text(json.dumps(state))
 if mode in ('nested_symlink','nested_file','nested_missing'):
  work.chmod(0o700); (work/'test-fixtures').chmod(0o700)
  shutil.rmtree(work/'test-fixtures')
  if mode=='nested_symlink': (work/'test-fixtures').symlink_to(root/'outside',target_is_directory=True)
  if mode=='nested_file': (work/'test-fixtures').write_text('unexpected regular file')
  work.chmod(0o555)
 if mode=='work_symlink':
  work.rename(str(work)+'.retained'); work.symlink_to(root/'outside',target_is_directory=True)
 if mode=='run_failure':
  print('SYNTHETIC_CADDY_FAILURE',file=sys.stderr); sys.exit(42)
 if mode=='run_timeout': sys.exit(124)
 print('SYNTHETIC_CADDY_CHECKS=134'); sys.exit(0)
print('UNEXPECTED_FAKE_DOCKER_COMMAND',file=sys.stderr); sys.exit(90)
`;

function dispose(path) {
  if (!existsSync(path) && !lstatMaybe(path)) return;
  const info = lstatSync(path);
  if (info.isSymbolicLink()) { rmSync(path); return; }
  if (info.isDirectory()) {
    chmodSync(path, 0o700);
    for (const name of readdirSync(path)) dispose(join(path, name));
  }
  rmSync(path, { recursive: true, force: true });
}
function lstatMaybe(path) { try { return lstatSync(path); } catch { return null; } }

function run(t, mode = 'success', legacy = false) {
  const root = mkdtempSync(join(tmpdir(), 'arthello-r11-cleanup-'));
  t.after(() => dispose(root));
  const bin = join(root, 'bin'), runner = join(root, 'runner'), repo = join(root, 'repo');
  mkdirSync(bin); mkdirSync(runner); mkdirSync(join(repo, '.github/scripts/test-fixtures'), { recursive: true });
  const outside = join(root, 'outside'); mkdirSync(outside);
  writeFileSync(join(outside, 'keep'), 'outside public sentinel'); chmodSync(outside, 0o555);
  const scripts = join(repo, '.github/scripts');
  for (const name of ['d083-maintenance-route.py', 'test-d083-maintenance-caddy.py']) writeFileSync(join(scripts, name), '# public fixture\n');
  writeFileSync(join(scripts, 'test-fixtures/d083-stroios-Caddyfile'), 'fixture.example.test { respond 200 }\n');
  const script = join(root, 'target.sh');
  cpSync(join(here, legacy ? 'run-d083-target-caddy.sh' : 'run-r11-target-caddy.sh'), script);
  writeFileSync(join(bin, 'docker'), fakeDocker, { mode: 0o700 });
  let runnerTemp = runner;
  if (mode === 'runner_symlink') { runnerTemp = join(root, 'runner-link'); symlinkSync(runner, runnerTemp); }
  const result = spawnSync('bash', [script], { cwd: repo, encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, VALIDATED_IMAGE_ID: image,
      GITHUB_RUN_ID: '12345', GITHUB_RUN_ATTEMPT: '1', CADDY_CONTAINER: 'stroios-caddy-1', RUNNER_TEMP: runnerTemp,
      FAKE_ROOT: root, FAKE_MODE: mode },
  });
  assert.ifError(result.error);
  const calls = existsSync(join(root, 'docker.jsonl')) ? readFileSync(join(root, 'docker.jsonl'), 'utf8').trim().split('\n').map(JSON.parse) : [];
  const state = existsSync(join(root, 'docker-state.json')) ? JSON.parse(readFileSync(join(root, 'docker-state.json'), 'utf8')) : {};
  return { root, runner, outside, result, calls, state };
}

function outsidePreserved(fixture) {
  assert.equal(readFileSync(join(fixture.outside, 'keep'), 'utf8'), 'outside public sentinel');
  assert.equal(statSync(fixture.outside).mode & 0o777, 0o555, 'cleanup must not chmod an outside target');
  assert.deepEqual(readdirSync(fixture.outside), ['keep']);
}

test('the test process cannot bypass directory write permissions', t => {
  const root = mkdtempSync(join(tmpdir(), 'arthello-r11-permissions-'));
  t.after(() => dispose(root));
  const file = join(root, 'public-fixture'); writeFileSync(file, 'synthetic fixture');
  chmodSync(root, 0o555);
  assert.throws(() => unlinkSync(file), { code: 'EACCES' });
});

test('frozen R10 reproduces nested 0555 cleanup failure after successful checks without privilege', t => {
  const f = run(t, 'success', true);
  assert.notEqual(f.result.status, 0);
  assert.match(f.result.stdout, /SYNTHETIC_CADDY_CHECKS=134/);
  assert.match(f.result.stdout, /ARTHELLO_TARGET_CADDY_FIXTURE=VERIFIED/);
  assert.match(f.result.stderr, /Permission denied/);
  assert.equal(statSync(join(f.state.work, 'test-fixtures')).mode & 0o777, 0o555);
  outsidePreserved(f);
});

test('R11 cleans the owned immutable nested fixture after all 134 checks and preserves isolation', t => {
  const f = run(t);
  assert.equal(f.result.status, 0, f.result.stderr);
  assert.match(f.result.stdout, /SYNTHETIC_CADDY_CHECKS=134/);
  assert.match(f.result.stdout, /ARTHELLO_TARGET_CADDY_FIXTURE=VERIFIED/);
  assert.deepEqual(readdirSync(f.runner), []);
  outsidePreserved(f);
  const runs = f.calls.filter(a => a[0] === 'run'); assert.equal(runs.length, 1);
  const a = runs[0];
  for (const [flag, value] of [['--pull','never'],['--user','node'],['--network','none'],['--log-driver','none'],['--cap-drop','ALL'],['--security-opt','no-new-privileges'],['--memory','384m'],['--memory-swap','384m'],['--cpus','1'],['--pids-limit','128']]) assert.equal(a[a.indexOf(flag) + 1], value, flag);
  for (const flag of ['--rm','--init','--read-only']) assert.ok(a.includes(flag));
  assert.equal(a[a.indexOf('--mount') + 1], `type=bind,src=${f.state.work},dst=/opt/d083-caddy-fixture,readonly`);
  assert.equal(a[a.indexOf('--tmpfs') + 1], '/tmp:rw,nosuid,nodev,size=64m,uid=1000,gid=1000,mode=700');
  assert.deepEqual(a.slice(-4), ['python3', image, '-I', '/opt/d083-caddy-fixture/test-d083-maintenance-caddy.py']);
  assert.deepEqual(f.calls.filter(a => a[0] === 'rm'), [['rm', '-f', container]]);
  assert.equal(f.calls.filter(a => a.join(' ') === `exec ${gateway} sha256sum /usr/bin/caddy`).length, 2);
});

for (const [mode, status] of [['copy_failure',9],['run_failure',42],['run_timeout',124],['gateway_changed',1]]) {
  test(`R11 preserves ${mode} exit status and cleans only its fixture`, t => {
    const f = run(t, mode); assert.equal(f.result.status, status, f.result.stderr);
    assert.deepEqual(readdirSync(f.runner), []); outsidePreserved(f);
    assert.doesNotMatch(f.result.stdout, /ARTHELLO_TARGET_CADDY_FIXTURE=VERIFIED/);
  });
}

test('an early failure or already absent nested directory needs no chmod of a missing path', t => {
  const f = run(t, 'nested_missing'); assert.equal(f.result.status, 0, f.result.stderr);
  assert.deepEqual(readdirSync(f.runner), []); outsidePreserved(f);
});

for (const mode of ['nested_symlink','work_symlink','nested_file']) {
  test(`R11 refuses ${mode} replacement and retains the unexpected path`, t => {
    const f = run(t, mode); assert.notEqual(f.result.status, 0);
    outsidePreserved(f);
    const unexpected = mode === 'work_symlink' ? f.state.work : join(f.state.work, 'test-fixtures');
    assert.ok(lstatMaybe(unexpected), 'unexpected path must not be deleted');
    assert.equal(lstatSync(unexpected).isSymbolicLink(), mode !== 'nested_file');
  });
}

test('a foreign invocation container is never removed', t => {
  const f = run(t, 'foreign_container'); assert.equal(f.result.status, 0, f.result.stderr);
  assert.equal(f.calls.some(a => a[0] === 'rm'), false);
  assert.deepEqual(readdirSync(f.runner), []); outsidePreserved(f);
});

for (const mode of ['existing_container','runner_symlink']) {
  test(`${mode} refuses before creating a fixture or removing any container`, t => {
    const f = run(t, mode); assert.notEqual(f.result.status, 0);
    assert.equal(f.calls.some(a => ['run','rm'].includes(a[0])), false);
    assert.deepEqual(readdirSync(f.runner), []); outsidePreserved(f);
  });
}
