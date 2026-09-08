require 'yaml'
require 'digest'

baseline_path = '.github/workflows/deploy-arthello-recovery-r5-20260908.yml'
candidate_path = '.github/workflows/deploy-arthello-recovery-r6-20260908.yml'
baseline_source = File.read(baseline_path)
raise 'Previously installed R5 controller changed' unless Digest::SHA256.hexdigest(baseline_source) == '493c0529579cbcf655b18f7ab529b37ca7142c08f8d0a61acc70b8051091e74a'
raise 'Installed R5 repair library changed' unless Digest::SHA256.file('deploy/school/sso-relay-r5/repair.py').hexdigest == '5d947a82413e193a558ac412be08d7a47988d2c97fa711e7c2a54511711de0f0'
source = File.read(candidate_path)
baseline = YAML.safe_load(baseline_source, aliases: true)
candidate = YAML.safe_load(source, aliases: true)
raise 'R6 must retain workflow_run trigger and platform permissions' unless candidate.fetch('on') == baseline.fetch('on') && candidate.fetch('permissions') == baseline.fetch('permissions')
raise 'Shared gateway queue changed' unless candidate.fetch('concurrency') == baseline.fetch('concurrency')
old_job, job = baseline.fetch('jobs').fetch('deploy'), candidate.fetch('jobs').fetch('deploy')
%w[runs-on timeout-minutes environment concurrency].each {|key| raise 'Protected capability boundary changed' unless job.fetch(key) == old_job.fetch(key)}
expected_env = baseline.fetch('env').merge('EXPECTED_RELEASE_HEAD'=>'codex/school-arthello-recovery-r6-20260908', 'EXPECTED_RELEASE_PR'=>'361', 'PREVIOUS_RELEASE_SHA'=>'c9e7da06f7d3637c0032af542085f28acb02816a')
raise 'Candidate and installation identity confused' unless candidate.fetch('env') == expected_env
expected_condition = old_job.fetch('if').gsub('recovery-r5-20260908', 'recovery-r6-20260908').gsub("'360'", "'361'")
raise 'Exact successful owner-owned canonical Verify gate weakened' unless job.fetch('if') == expected_condition
steps, old_steps = job.fetch('steps'), old_job.fetch('steps')
raise 'Unexpected release steps' unless steps.length == old_steps.length + 1
%w[image_import cutover].each do |id|
  raise 'Artifact or cutover contract changed' unless steps.find {|step| step['id'] == id} == old_steps.find {|step| step['id'] == id}
end
old_steps.each do |old_step|
  next if ['Verify D067 R5 identity and safe verified-School resume', 'Wait for exact main Quality Proof and v52 verification',
    'Repair School egress configuration with durable receipt', 'Read-only School diagnostic and real browser acceptance',
    'Production summary'].include?(old_step['name'])
  raise 'Unrelated protected release step changed' unless steps.find {|step| step['name'] == old_step['name']} == old_step
end
provenance = steps.find {|step| step['name'] == 'Wait for exact main Quality Proof and v52 verification'}
raise 'Exact main/parent/provenance gate changed' unless provenance == old_steps.find {|step| step['name'] == provenance['name']}
identity = steps.first.fetch('run')
replay = File.read('.github/scripts/d068-replay-guard.py')
raise 'Reviewed replay logic must match capability-bearing inline code' unless identity.include?("python3 -I - <<'D068_REPLAY'\n" + replay + "D068_REPLAY")
['safe_previous_job(job)', "cutovers[0].get('conclusion') == 'skipped'", 'validate_installation(', '34208952716', '102005327418',
 "'ee8f3080d941a12be357eec0fd1d902acd01a2f9'", "run['run_attempt'] == 1", "identities.count(current_run) == 1",
 'len(set(identities)) == len(identities)', "'Successful or ambiguous release cannot be replayed'"].each {|token| raise 'Installation provenance or replay boundary missing' unless replay.include?(token)}
checkout = steps.index {|step| step['uses'].to_s.start_with?('actions/checkout@')}
raise 'Production capability used before exact verification' if steps.take(checkout).map {|step| step['run'].to_s}.join("\n").match?(/(^|\s)(docker|ssh|sudo)(\s|$)/)
verification_index = steps.index {|step| step['id'] == 'school_repair'}
diagnostic_index = steps.index {|step| step['name'] == 'Read-only School diagnostic and real browser acceptance'}
capability_index = steps.index {|step| step['name'] == 'Check existing gateway backup installation capability'}
image_index = steps.index {|step| step['id'] == 'image_import'}
raise 'Read-only preconditions must precede evidence/image/cutover' unless checkout < verification_index && verification_index < capability_index && capability_index < diagnostic_index && diagnostic_index < image_index
verification = steps.fetch(verification_index)
raise 'Installed verification identity changed' unless verification['name'] == 'Verify installed R5 School relay with fresh receipt'
run = verification.fetch('run')
['verify-installed-school-relay-r6.py', 'R6_VERIFIER_BASE64', 'deploy/school/sso-relay-r5',
 'check-school-repair-receipt-r3.py', 'test "$current_main" = "$RELEASE_SHA"',
 'StrictHostKeyChecking=yes', 'SHA256:/kBNohTF+5g8U+jQt+PzOCoWZ9yCSFjBnEP3Oc3MwRI'].each {|token| raise 'Installed verification transport missing' unless run.include?(token)}
raise 'R6 must not invoke a mutating School repair' if run.match?(/r[234]-school-repair-remote|docker\s+(create|run|stop|rm|restart|network|update)|sudo|fchmod|chown/)
diagnostic = steps.fetch(diagnostic_index)
expected_diagnostic = Marshal.load(Marshal.dump(old_steps.find {|step| step['name'] == diagnostic['name']}))
expected_diagnostic['run'] = expected_diagnostic['run'].gsub('check-school-live-acceptance-r5.py', 'check-school-live-acceptance-r6.py')
raise 'Natural SSO diagnostic gate changed beyond fresh evidence path' unless diagnostic == expected_diagnostic
old_acceptance = File.read('.github/scripts/check-school-live-acceptance-r5.py')
acceptance = File.read('.github/scripts/check-school-live-acceptance-r6.py')
raise 'Natural SSO evidence constraints changed' unless acceptance == old_acceptance.gsub('2026-09-08-school-live-acceptance-r5.json','2026-09-08-school-live-acceptance-r6.json')
capability = steps.fetch(capability_index).fetch('run')
['ARTHELLO_OBSERVED_LIVE_RELEASE_SHA', 'arthello.release.sha', 'gateway_uid="$(id -u)"',
 'sudo -n true </dev/null >/dev/null 2>&1', 'ARTHELLO_BACKUP_INSTALL_CAPABILITY=BLOCKED', 'exit 1'].each {|token| raise 'Required early capability evidence missing' unless capability.include?(token)}
raise 'Early capability check must not install or alter permissions' if capability.match?(/chmod|chown|install\.sh|systemctl|docker\s+(run|stop|rm|restart|create|update)/)
verify_source = File.read('.github/workflows/verify-arthello-v52.yml')
['ruby .github/scripts/check-recovery-r6-contract.rb', 'python3 -I .github/scripts/test-recovery-r6-gates.py',
 'python3 -I .github/scripts/test-installed-school-relay-r6.py'].each {|token| raise 'Hosted R6 proof missing' unless verify_source.include?(token)}
puts 'ARTHELLO_D068_PRESERVED_R5_CONTINUATION_CONTRACT=VERIFIED'
