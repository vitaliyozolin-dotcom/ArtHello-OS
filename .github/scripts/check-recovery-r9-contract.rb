require 'yaml'
require 'digest'
require 'json'

# D080 is an explicit transaction-boundary change. Normalization below proves
# every unchanged R8 cutover line, and separately proves the preserved public tail.
EXPECTED_RELEASE_PR = '377'
EXPECTED_RELEASE_HEAD = 'codex/school-arthello-recovery-r9-20260909'
PREVIOUS_RELEASE_SHA = '582edaf1a66a953edb2d61e03040d1a13e70a0ad'
def canonical(value)
  case value
  when Hash then value.keys.sort.to_h {|key| [key, canonical(value.fetch(key))]}
  when Array then value.map {|item| canonical(item)}
  else value
  end
end
def digest(value)
  Digest::SHA256.hexdigest(value)
end
def block(source, name)
  pattern = /^# D080_#{name}_BEGIN\n.*?^# D080_#{name}_END\n/m
  matches = source.scan(pattern)
  raise "Missing or duplicate D080 block: #{name}" unless matches.length == 1
  matches.first
end
old_source = File.read('.github/workflows/deploy-arthello-recovery-r8-20260908.yml')
raise 'Preserved R8 changed' unless digest(old_source) == 'ed520a49c67cfd992242ff6321d2f56cdf13a974e694eb24390747b3e8d1a716'
old = YAML.safe_load(old_source, aliases: true)
source = File.read('.github/workflows/deploy-arthello-recovery-r9-20260909.yml')
current = YAML.safe_load(source, aliases: true)
actual_steps = current.fetch('jobs').fetch('deploy').fetch('steps')
old_steps = old.fetch('jobs').fetch('deploy').fetch('steps')
STEP_DIGESTS = {
  "Verify retained candidate before any replay skip" => "59a56ee1a6e5d48f85721b4b635765d0893cfa3bf7bdd70bc6c41b38568b8cd5",
  "Read-only School diagnostic before candidate acceptance" => "06487faeb4dd1d186d7f6d3f09987cc15d2dc382e7b83f31eecf8138d8e642cd",
  "Verify actual gateway Caddy with isolated candidate fixture" => "ecabbb6915e01cc8ff504ac91022083c42491714a57adedc53b37bfbd5cc5048",
  "Clone preflight and guarded production cutover" => "2805327e21ce958cce1d0077e429a4f2812bcfa36a75c083bfaac991c284ffea",
  "Production summary" => "09ca76a0f620ece849de4f73c8e342394706b1c386d85895869dfd3817e31dfd"
}
STEP_DIGESTS.each do |name, sha|
  matches = actual_steps.select {|step| step['name'] == name}
  raise "Unreviewed D080 step change: #{name}" unless matches.length == 1 && digest(JSON.generate(canonical(matches.first))) == sha
end
old_run = old_steps.find {|step| step['id'] == 'cutover'}.fetch('run')
new_run = actual_steps.find {|step| step['id'] == 'cutover'}.fetch('run')
tail_start = 'require_current_main_release' + "\n" + 'docker cp "$work/external-routes.candidate.caddy"'
a = old_run.index(tail_start)
b = old_run.index("\ncandidate_id=", old_run.index("printf 'ARTHELLO_RELEASE_ACTIVE=", a))
old_tail = old_run[a...b]
completion = block(new_run, 'CANDIDATE_COMPLETION')
public_tail = completion[completion.index(tail_start)...completion.index("\n}\n# D080_CANDIDATE_COMPLETION_END")]
public_tail = public_tail.sub(/if ! docker exec "\$CADDY_CONTAINER" caddy validate.*?\nfi\n/m,
  'docker exec "$CADDY_CONTAINER" caddy validate --config "$config_new" --adapter caddyfile >/dev/null' + "\n")
public_tail = public_tail.sub(/^public_audit_work=.*?GITHUB_RUN_ATTEMPT"\)"\n/m, '')
public_tail = public_tail.sub(/^python3 -I .github\/scripts\/d080-candidate-state.py public-start \\\n[^\n]*\n/, '')
public_tail = public_tail.gsub('"$public_audit_work"', '"$work"').gsub('EXPECTED_CURRENT_SHA="$maintenance_route_sha"', 'EXPECTED_CURRENT_SHA="$original_route_sha"')
raise 'Original public checks or bank activation changed' unless public_tail == old_tail
normalized = new_run.dup
%w[RESUME_IMAGE CANDIDATE_COMPLETION RESUME_COMPLETION].each {|name| normalized.sub!(block(new_run, name) + "\n", '')}
normalized.sub!(block(new_run, 'MAINTENANCE_ACTIVATION')) { old_tail }
a = old_run.index('OLD_UPSTREAM=')
b = old_run.index("\ndocker volume create", a)
normalized.sub!(block(new_run, 'MAINTENANCE_RENDER')) { old_run[a...b] }
normalized.sub!(/^python3 -I - "\$durable_work_root".*?^D080_DURABLE_WORK\n/m, '')
a = old_run.index('  if [ "$public_commit_started"')
b = old_run.index("  printf 'ARTHELLO_ROLLBACK=START", a)
old_rollback = old_run[a...b]
a = normalized.index('  if [ "$public_commit_started"')
b = normalized.index("  printf 'ARTHELLO_ROLLBACK=START", a)
normalized[a...b] = old_rollback
normalized.sub!('durable_work_root="$HOME/.config/arthello/release-state/candidate-work"' + "\n" + 'work="$durable_work_root/arthello-deploy-$run_key"', 'work="$RUNNER_TEMP/arthello-deploy-$run_key"')
normalized.sub!('"$durable_work_root"/arthello-deploy-*) ;;', '"$RUNNER_TEMP"/arthello-deploy-*) ;;')
[
  'candidate_auth_started=0', 'maintenance_route_sha=""',
  'maintenance_route_new="$route_new.maintenance"', 'maintenance_config_new="$config_new.maintenance"',
  'candidate_state_file="$secret_dir/release-state/candidate-acceptance-$RELEASE_SHA.json"',
  'gate_nonce_file="$work/candidate-gate.nonce"',
  '    "$maintenance_route_new" "$maintenance_config_new" \\'
].each {|line| normalized.sub!(line + "\n", '')}
normalized.sub!('if [ "$candidate_auth_started" -eq 0 ] && require_safe_work_path; then', 'if require_safe_work_path; then')
raise 'Preserved R8 clone, backup, identities, locks or rollback changed' unless normalized == old_run

expected = Marshal.load(Marshal.dump(old))
expected['name'] = 'Deploy ArtHello recovery R9 D080'
expected['env'].merge!('EXPECTED_RELEASE_HEAD'=>EXPECTED_RELEASE_HEAD, 'EXPECTED_RELEASE_PR'=>EXPECTED_RELEASE_PR, 'PREVIOUS_RELEASE_SHA'=>PREVIOUS_RELEASE_SHA)
%w[bundle deploy].each do |name|
  expected['jobs'][name]['if'] = expected['jobs'][name]['if'].gsub('codex/school-arthello-recovery-r8-20260908', EXPECTED_RELEASE_HEAD).gsub("fromJSON('370')", "fromJSON('#{EXPECTED_RELEASE_PR}')").gsub('D078: guarded R8','D080: guarded R9')
end
steps = expected.fetch('jobs').fetch('deploy').fetch('steps')
replay = File.read('.github/scripts/d080-replay-guard.py')
steps.first['name'] = 'Verify D080 R9 identity and preserved R5 R8 abort boundary'
steps.first['run'] = steps.first.fetch('run').sub(/python3 -I - <<'D078_REPLAY'\n.*?D078_REPLAY/m) { "python3 -I - <<'D080_REPLAY'\n" + replay + 'D080_REPLAY' }
imports = ['Measure import capacity before downloading the verified archive', 'Verify archive, import off-host bundle and verify portable identity', 'Download and load exact hosted-verified image', 'Verify and load exact hosted-verified image', 'Resolve authoritative School sync secret']
steps.each do |step|
  step['if'] = "env.R9_RESUME_CANDIDATE != '1'" if imports.include?(step['name']) || step['uses'].to_s.start_with?('actions/download-artifact@')
end
before = steps.find {|step| step['name'] == 'School diagnostic and real browser acceptance before cutover'}
readonly = actual_steps.find {|step| step['name'] == 'Read-only School diagnostic before candidate acceptance'}
preserved_prefix = before.fetch('run').split('SCHOOL_DIAGNOSTIC_FILE="$diagnostic_file"').first
current_prefix = readonly.fetch('run').split("printf 'SCHOOL_DIAGNOSTIC_FILE=").first.sub("python3 -I .github/scripts/d080-baseline-evidence.py\n", '')
raise 'Readonly School probe changed' unless preserved_prefix == current_prefix
steps[steps.index(before)] = readonly
%w[cutover].each {|id| steps[steps.index {|step| step['id'] == id}] = actual_steps.find {|step| step['id'] == id}}
steps[-1] = actual_steps.last
post = steps.find {|step| step['name'] == 'School diagnostic and real browser acceptance after cutover'}
post['run'] = post.fetch('run').sub('run-r8-live-browser.sh', 'run-r9-live-browser.sh')
['Verify retained candidate before any replay skip','Verify actual gateway Caddy with isolated candidate fixture'].each do |name|
  index = actual_steps.index {|step| step['name'] == name}
  steps.insert(index, actual_steps[index])
end
raise 'R9 platform, provenance, locks or step sequence changed' unless current == expected
raise 'Unexpected D076 cleanup in release flow' if source.include?('retire-image.mjs')
job = current.fetch('jobs').fetch('deploy')
checkout = actual_steps.index {|item| item['uses'].to_s.start_with?('actions/checkout@')}
raise 'Production capability before source verification' if actual_steps.take(checkout).map {|item| item['run'].to_s}.join("\n").match?(/(^|\s)(docker|ssh|sudo)(\s|$)/)
browser = YAML.safe_load(File.read('.github/workflows/check-arthello-server-browser.yml'), aliases: true)
bundle = Marshal.load(Marshal.dump(browser.fetch('jobs').fetch('bundle')))
bundle['if'] = job.fetch('if').strip + " && startsWith(github.event.workflow_run.head_commit.message, 'D080: guarded R9')"
raise 'Canonical D076 bundle changed' unless current.fetch('jobs').fetch('bundle') == bundle
{
  'r8-live-browser-acceptance.py'=>'417b9c6f1177708a1ea9b0b136ac49a6be7041001de94a6a0fc06974fe11934b',
  'run-r8-live-browser.sh'=>'a03cf5573df4278410ea772c04f3fff211614fdf7b67e2c15e999455dbc16f70',
  'test-r8-live-browser-acceptance.py'=>'fce53267a8569bca44aaa13002778b5a187ee13294b553f82d41411a4c2443bc',
  'check-school-live-acceptance-r7.py'=>'6fae34638acd1757cad922c288ede1282f8300a8ecfcbe3547661378445cb884'
}.each {|file, sha| raise "Old browser gate changed: #{file}" unless digest(File.read('.github/scripts/' + file)) == sha}
HELPER_DIGESTS = {
  ".github/scripts/d080-replay-guard.py" => "c8340b7073272dc2c56ea6cb0d3e4d1516fbb8b7e0b5ea5d4eb0b09bc210a9d8",
  ".github/scripts/test-d080-replay-guard.py" => "354721e93538d2395ca617714c14d4151c24389f493215ca7c777a76d17841ff",
  ".github/scripts/r9-live-browser-acceptance.py" => "92acf05c27c4cc74ce36ae12155a5ffc5d3eb522bb73ebdce14e8bda321774ac",
  ".github/scripts/test-r9-live-browser-acceptance.py" => "7fdd1e7a5b8bdf585e67a1197ae82afa78bd927a3e28404f6cdf7e7a0bea23f9",
  ".github/scripts/run-r9-live-browser.sh" => "d4944ae1cece161152e92b263f8f65dff6afaf6874b503dc83537a4f07b3de7c",
  ".github/scripts/d080-baseline-evidence.py" => "1c3bfff3e241fa39c77709953c57cad211af1e86abf392e23efb5b771b3fe177",
  ".github/scripts/test-d080-baseline-evidence.py" => "5ccbdc50226d551f9c13efd732e328a662e97375d6ac7b0f5d39fb429cd010a1",
  ".github/scripts/d080-resume-candidate.py" => "a4a14f1dc49aa4d6513fe1491be5dcbf660ace3dcf42dc1c3e2fd6773677b28a",
  ".github/scripts/test-d080-resume-candidate.py" => "220c7d34d7474a0840c86c88acbce90ec6ac977e615af3f298214c94159ac44f",
  ".github/scripts/d080-public-audit.py" => "b8f286a322b002aa6e6e6009fb9e4cfec14aad949d9bd003ced4adbf3726779c",
  ".github/scripts/test-d080-public-audit.py" => "60b985e267a197103d07d747a767ce648d56e218d30b24818e6858bd63e85b57",
  ".github/scripts/test-d080-controller-boundary.py" => "8cd891085cf4be3df1345e3d062a0239f7216a366258a6e5c3e54e3b19b576e8",
  ".github/scripts/d080-candidate-state.py" => "f6d01685380ccbf2c42d4d31831c2ce1d97f3c573186748b07b3188a403b1c30",
  ".github/scripts/test-d080-candidate-state.py" => "6bdefcd13136a222bc626b2dffa304aedb7f11a8f169a032c5c1d7d2ab861b58",
  ".github/scripts/d080-maintenance-route.py" => "3dc40bd012925c5f52d33b0dfb1ba3187108d007329337b8757e4b337b41ede7",
  ".github/scripts/test-d080-maintenance-route.py" => "3068652d873580290f0c976addd8c102ea7b86ab0d731ff437d27771f62401fa",
  ".github/scripts/test-d080-maintenance-caddy.py" => "d5b5d81c0f0bb070f9a15d5a391dc26fb17e94ca419d85e4fc407e888890eb1f",
  ".github/scripts/run-d080-hosted-caddy.sh" => "360ef427739b7e8041124cb5abea8fcbbbb60b0081d38181f8717091f455e1ad",
  ".github/scripts/run-d080-target-caddy.sh" => "96629d15702d04b1759978a76c6c9c1109ce9c4c43d41411705ea25921afb76c"
}
HELPER_DIGESTS.each {|path, sha| raise "Unreviewed D080 helper change: #{path}" unless digest(File.read(path)) == sha}
verification = File.read('.github/workflows/verify-arthello-v52.yml')
paths = [
  ".github/workflows/deploy-arthello-recovery-r9-20260909.yml",
  ".github/scripts/check-recovery-r9-contract.rb",
  ".github/scripts/d080-replay-guard.py",
  ".github/scripts/test-d080-replay-guard.py",
  ".github/scripts/r9-live-browser-acceptance.py",
  ".github/scripts/test-r9-live-browser-acceptance.py",
  ".github/scripts/run-r9-live-browser.sh",
  ".github/scripts/d080-baseline-evidence.py",
  ".github/scripts/test-d080-baseline-evidence.py",
  ".github/scripts/d080-resume-candidate.py",
  ".github/scripts/test-d080-resume-candidate.py",
  ".github/scripts/d080-public-audit.py",
  ".github/scripts/test-d080-public-audit.py",
  ".github/scripts/test-d080-controller-boundary.py",
  ".github/scripts/d080-candidate-state.py",
  ".github/scripts/test-d080-candidate-state.py",
  ".github/scripts/d080-maintenance-route.py",
  ".github/scripts/test-d080-maintenance-route.py",
  ".github/scripts/test-d080-maintenance-caddy.py",
  ".github/scripts/run-d080-hosted-caddy.sh",
  ".github/scripts/run-d080-target-caddy.sh"
]
commands = [
  "ruby .github/scripts/check-recovery-r9-contract.rb",
  "python3 -I .github/scripts/test-d080-replay-guard.py",
  "python3 -I .github/scripts/test-r9-live-browser-acceptance.py",
  "bash -n .github/scripts/run-r9-live-browser.sh",
  "python3 -I .github/scripts/test-d080-baseline-evidence.py",
  "python3 -I .github/scripts/test-d080-resume-candidate.py",
  "python3 -I .github/scripts/test-d080-public-audit.py",
  "python3 -I .github/scripts/test-d080-controller-boundary.py",
  "bash -n .github/scripts/run-d080-hosted-caddy.sh",
  "bash -n .github/scripts/run-d080-target-caddy.sh"
]
paths.each do |path|
  raise "R9 path absent: #{path}" unless File.file?(path)
  line = "      - #{path}\n"
  raise "R9 hosted path filter incomplete: #{path}" unless verification.scan(line).length == 2
  verification = verification.gsub(line, '')
end
commands.each do |command|
  line = "          #{command}\n"
  raise "R9 hosted check absent: #{command}" unless verification.scan(line).length == 1
  verification = verification.sub(line, '')
end
candidate_job = YAML.safe_load(verification, aliases: true).fetch('jobs').fetch('d080-candidate-tests')
raise 'Candidate hosted gate changed' unless digest(JSON.generate(canonical(candidate_job))) == '34ded1f1cff4e1d39b3e20d9422235906e3b13fa39c893162f84385270a53b74'
verification = verification.sub(/\n  d080-candidate-tests:\n.*\z/m, '')
raise 'Existing v52 checks or platform authority changed' unless digest(verification) == '97b3e75457c709c802cac1e658c46e98eaac97b4ea9777940331e7902fbe9ee4'
puts 'ARTHELLO_D080_PRESERVED_R8_CUTOVER_AND_NATURAL_BROWSER_CONTRACT=VERIFIED'
