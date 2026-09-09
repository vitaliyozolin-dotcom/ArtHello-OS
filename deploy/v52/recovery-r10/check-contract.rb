require 'yaml'
require 'digest'
require 'json'

# D084 adds one observed shared-gateway template and immutable evidence binding.
# The R9 controller, protocol and V52 gate remain frozen and execute their contract.
R10_RELEASE_PR = '379'
R10_RELEASE_HEAD = 'codex/school-arthello-recovery-r10-20260909'
R10_PREVIOUS_RELEASE_SHA = 'edb7bfa1c666853be162c99295e0044820753ab0'
R10_HELPER_DIGESTS = {
  ".github/workflows/deploy-arthello-recovery-r10-20260909.yml" => "037901841a1fcb3a12a64c07e0f7cd71de8375dda955b9d0a1251c492e5be7fa",
  ".github/scripts/d083-candidate-state.py" => "d3ce4a4c6ccca6ea851a395734227169b19289d07d44a29ea3be843aa4e0183b",
  ".github/scripts/d083-maintenance-route.py" => "f669e1889be6f31ddb88fbdb5316a07bdfa9dcd0cae3cf82ae429e7235363276",
  ".github/scripts/d083-public-audit.py" => "551c62fbcff2603f69602fd207d46e378099c2fd5900d2e69c7893a5c9fefcda",
  ".github/scripts/d083-replay-guard.py" => "e786f8e173246c274cddc9b6faff79230da2773edbeae3ee91a4123228600e93",
  ".github/scripts/d083-resume-candidate.py" => "08609dd4f2ef2df6c15ae5714518d4cf6c821a49fc4457238af990a3f1d88f69",
  ".github/scripts/r10-live-browser-acceptance.py" => "e41949e4a9a48100e3db752e75d27ced4265dc63905e4972a84bc29e85aeb84b",
  ".github/scripts/run-d083-hosted-caddy.sh" => "682f0e40ab97ed2ca8834fe1bb5e69cfe88baf1d5a214fead52787f808ad0d4d",
  ".github/scripts/run-d083-target-caddy.sh" => "805f746d9379483f11ba145e6df0051f9cef5d92f77f553420382957a23d2949",
  ".github/scripts/run-r10-live-browser.sh" => "9715a63c8f1a95168e2a3596641e841eb5f88b6fabef823e9ad78dd05d92e653",
  ".github/scripts/test-d083-candidate-state.py" => "d0156f8912f56060530c4f9861b248b8826b74131397218fab3d53ea51167539",
  ".github/scripts/test-d083-controller-boundary.py" => "ef7779d29194660e0e0839cddd952376bc390509b63970f39c4a548bcd8642d2",
  ".github/scripts/test-d083-maintenance-caddy.py" => "6b001f9e2ed28dc97697564f5b3aad17390ea7577226d319b05e884f48dcbb90",
  ".github/scripts/test-d083-maintenance-route.py" => "5fe77a73dad386322477bbe4b346db0aeb61a2050973f36f7021499d6970cc30",
  ".github/scripts/test-d083-public-audit.py" => "b7666a60fbcff45a04ae5fc8ce20df84f3fa20448b398ffa9747a914ae455598",
  ".github/scripts/test-d083-replay-guard.py" => "c88ad359f0746d0cbcc8d0d2e47e2a90da1c6d5bd91852a4b0633ef59d77a49c",
  ".github/scripts/test-d083-resume-candidate.py" => "6c91d4be936f9db97f769698ac9ef582dd72de12c251650617e990fc083daa38",
  ".github/scripts/test-r10-live-browser-acceptance.py" => "0826c96ad60268af2797e83deb542f444166688e8cac9594df7cdb9a41c4356d",
  ".github/scripts/test-fixtures/d083-stroios-Caddyfile" => "6e0122649c18de2c14ed9607256de05173da30af5df88dcc5846410ad9261cd0",
  "deploy/browser/retire-r9-image.mjs" => "ce1a9898f81273d938de254b1dc26036b292fb7e387d10bfd7a4bf6379a66aeb",
  "scripts/test/retire-r9-browser.test.mjs" => "30125cf498311b5947e6649dafdc13528f5d928152d828d365418feb2c7f11e0",
}
raise 'Frozen R9 contract changed' unless Digest::SHA256.file('.github/scripts/check-recovery-r9-contract.rb').hexdigest == 'ca091c6ce6a53a2dd41eda8ffb255952e6c7c679cb103622b195e109efc5d4ef'
load '.github/scripts/check-recovery-r9-contract.rb'
raise 'Frozen R9 workflow changed' unless digest(File.binread('.github/workflows/deploy-arthello-recovery-r9-20260909.yml')) == '2e9f171944d0d01e7f2a2fecf9ac644c694cf5dd05970f453a7bf9e90b344b54'
raise 'Frozen V52 workflow changed' unless digest(File.binread('.github/workflows/verify-arthello-v52.yml')) == '142b270828ceded751a2e4fbd5cfc8d60f181005c116802e60d70fc0ad4cc02b'

R10_HELPER_DIGESTS.each do |path, sha|
  raise "Unreviewed R10 source change: #{path}" unless digest(File.binread(path)) == sha
end

def r10_rename(source)
  [
    ['r9-live-browser', 'r10-live-browser'], ['r9-acceptance-', 'r10-acceptance-'],
    ['ARTHELLO_R9_', 'ARTHELLO_R10_'], ['d080-candidate-state.py', 'd083-candidate-state.py'],
    ['d080-resume-candidate.py', 'd083-resume-candidate.py'], ['d080-public-audit.py', 'd083-public-audit.py'],
    ['d080-maintenance-route.py', 'd083-maintenance-route.py'], ['run-d080-target-caddy.sh', 'run-d083-target-caddy.sh']
  ].reduce(source.dup) {|text, (before, after)| text.gsub(before, after)}
end

def r10_gateway_block(source, name)
  pattern = /^# D084_#{name}_BEGIN\n.*?^# D084_#{name}_END\n/m
  matches = source.scan(pattern)
  raise "Missing or duplicate gateway boundary: #{name}" unless matches.length == 1
  matches.first
end

r9 = YAML.safe_load(File.read('.github/workflows/deploy-arthello-recovery-r9-20260909.yml'), aliases: true)
r10 = YAML.safe_load(File.read('.github/workflows/deploy-arthello-recovery-r10-20260909.yml'), aliases: true)
r9_steps = r9.fetch('jobs').fetch('deploy').fetch('steps')
r10_steps = r10.fetch('jobs').fetch('deploy').fetch('steps')
r9_cutover = r10_rename(r9_steps.find {|step| step['id'] == 'cutover'}.fetch('run'))
r10_cutover = r10_steps.find {|step| step['id'] == 'cutover'}.fetch('run')
normalized_cutover = r10_cutover.dup
%w[GATEWAY_OBSERVATION GATEWAY_PRE_ACTIVATION GATEWAY_CONTEXT].each do |name|
  normalized_cutover.sub!(r10_gateway_block(r10_cutover, name), '')
end
normalized_cutover.sub!('--gateway-env-evidence "$work/gateway-evidence.json" --nonce-file "$gate_nonce_file"', '--nonce-file "$gate_nonce_file"')
raise 'R9 clone, backup, locks, candidate auth, rollback or public completion changed' unless normalized_cutover == r9_cutover

expected = Marshal.load(Marshal.dump(r9))
expected['name'] = 'Deploy ArtHello recovery R10 D084'
expected['env'].merge!('EXPECTED_RELEASE_HEAD'=>R10_RELEASE_HEAD, 'EXPECTED_RELEASE_PR'=>R10_RELEASE_PR, 'PREVIOUS_RELEASE_SHA'=>R10_PREVIOUS_RELEASE_SHA)
%w[bundle deploy].each do |name|
  expected['jobs'][name]['if'] = expected['jobs'][name]['if'].gsub('codex/school-arthello-recovery-r9-20260909', R10_RELEASE_HEAD).gsub("fromJSON('377')", "fromJSON('#{R10_RELEASE_PR}')").gsub('D081: guarded R9', 'D084: guarded R10')
end
steps = expected.fetch('jobs').fetch('deploy').fetch('steps')
steps.each do |step|
  step['run'] = r10_rename(step['run']) if step.key?('run')
  if step['id'] == 'provenance'
    step['run'].sub!("workflow_success quality.yml 'Quality gates' 'secret-scan,test'", "workflow_success quality.yml 'Quality gates' 'secret-scan,test,d084-candidate-tests'")
  end
  step['run'] = r10_cutover if step['id'] == 'cutover'
  if step['name'] == 'Production summary'
    step['run'].sub!('ArtHello R9 production deployment', 'ArtHello R10 production deployment')
  end
end
steps.first['name'] = 'Verify D084 R10 identity and preserved R5 R8 R9 abort boundary'
steps.first['run'].sub!(/python3 -I - <<'D080_REPLAY'\n.*?D080_REPLAY/m) { "python3 -I - <<'D083_REPLAY'\n" + File.read('.github/scripts/d083-replay-guard.py') + 'D083_REPLAY' }
retirement_name = 'Retire only the exact unused R9 browser image under D084'
retirement_index = r10_steps.index {|step| step['name'] == retirement_name}
raise 'Exact browser retirement must immediately precede fresh capacity' unless retirement_index && r10_steps[retirement_index + 1]['name'] == 'Measure import capacity before downloading the verified archive'
raise 'Retirement is forbidden during candidate resume' unless r10_steps[retirement_index]['if'] == "env.R9_RESUME_CANDIDATE != '1'"
steps.insert(retirement_index, r10_steps[retirement_index])
raise 'R10 changed platform, authority, provenance or step sequence' unless expected == r10
browser = YAML.safe_load(File.read('.github/workflows/check-arthello-server-browser.yml'), aliases: true)
bundle = Marshal.load(Marshal.dump(browser.fetch('jobs').fetch('bundle')))
bundle['if'] = r10.fetch('jobs').fetch('deploy').fetch('if').strip + " && startsWith(github.event.workflow_run.head_commit.message, 'D084: guarded R10')"
raise 'R10 changed canonical browser build' unless r10.fetch('jobs').fetch('bundle') == bundle

# Preserve every old durable-state rule; only two context fields and their
# validation are added. The receipt continues to bind the full context digest.
old_state = File.read('.github/scripts/d080-candidate-state.py')
new_state = File.read('.github/scripts/d083-candidate-state.py')
new_state.sub!('D083 binds gateway evidence to the preserved D080 durable auth boundary', 'D080 durable auth boundary')
new_state.sub!('backupRuntimeStateFile gatewayEvidenceFile gatewayEvidenceSha256', 'backupRuntimeStateFile')
new_state.sub!('schoolRepairReceiptSha256 gatewayEvidenceSha256', 'schoolRepairReceiptSha256')
new_state.sub!('publicRouteFile gateNonceFile gatewayEvidenceFile', 'publicRouteFile gateNonceFile')
new_state.sub!(/^    if Path\(context\['gatewayEvidenceFile'\]\).name != 'gateway-evidence.json':\n        raise ValueError\('Gateway evidence filename does not match this invocation'\)\n/, '')
new_state.gsub!(/^    validate_gateway\(context\)\n/, '')
new_state.sub!(/^\ndef validate_gateway\(context\):\n.*?^def validate_receipt/m, 'def validate_receipt')
raise 'R10 weakened durable state or receipt validation' unless new_state == old_state
old_resume = r10_rename(File.read('.github/scripts/d080-resume-candidate.py'))
new_resume = File.read('.github/scripts/d083-resume-candidate.py')
new_resume.sub!(/^    gateway_evidence = state.validate_gateway\(context\)\n    require\(gateway.get\('Id'\).*?\n/, '')
new_resume.sub!(/^    command\(\['python3', '-I', str\(HERE \/ 'd083-maintenance-route.py'\), 'verify-gateway',\n.*?'--gateway-env-evidence', context\['gatewayEvidenceFile'\]\]\)\n/m, '')
raise 'R10 weakened candidate resume or pre-public runtime validation' unless new_resume == old_resume
{
  'r9-live-browser-acceptance.py'=>'r10-live-browser-acceptance.py',
  'run-r9-live-browser.sh'=>'run-r10-live-browser.sh',
  'd080-public-audit.py'=>'d083-public-audit.py'
}.each do |before, after|
  original = r10_rename(File.read('.github/scripts/' + before)).gsub('r9-browser-', 'r10-browser-')
  raise "R10 weakened browser or public-audit acceptance: #{after}" unless original == File.read('.github/scripts/' + after)
end

# The target, artifact and CLI scope differ; the tested lifecycle does not.
old_retirement = File.read('deploy/browser/retire-image.mjs')
new_retirement = File.read('deploy/browser/retire-r9-image.mjs')
%w[runDocker imageFingerprint retirementImageMatches parseImageIds retireTarget].each do |name|
  pattern = /^(?:async )?function #{name}\(.*?^\}\n/m
  before = old_retirement.scan(pattern)
  after = new_retirement.scan(pattern)
  raise "R10 changed immutable image lifecycle: #{name}" unless before.length == 1 && before == after
end

quality_source = File.read('.github/workflows/quality.yml')
quality = YAML.safe_load(quality_source, aliases: true)
quality_job = Marshal.load(Marshal.dump(quality.fetch('jobs').fetch('d084-candidate-tests')))
raise 'Quality contract pin does not match this reviewed file' unless quality_job.fetch('env').fetch('R10_CONTRACT_SHA256') == Digest::SHA256.file(__FILE__).hexdigest
quality_job['env']['R10_CONTRACT_SHA256'] = 'CONTRACT_SHA256_PENDING'
raise 'R10 hosted source, tests or Caddy fixture changed' unless digest(JSON.generate(canonical(quality_job))) == '5d7ce4f79fc1c7706c0b1cbb62a9d8d491a577a03d1509518793bf34c4d51ae5'
quality_without_r10 = quality_source.sub(/\n  d084-candidate-tests:\n.*\z/m, '')
raise 'Existing diagnostic Quality gates changed' unless digest(quality_without_r10) == 'fd57cc19a756490f558aa59d2e43056922112e96def586925ca58b2d267d5cf1'
raise 'R10 contract is outside the existing V52 trigger' unless File.read('.github/workflows/verify-arthello-v52.yml').scan("      - deploy/v52/**\n").length == 2
puts 'ARTHELLO_D084_PRESERVED_R9_AND_BOUND_GATEWAY_CONTRACT=VERIFIED'
