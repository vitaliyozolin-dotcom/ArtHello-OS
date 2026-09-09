require 'yaml'
require 'digest'

# A new one-shot identity inherits the complete reviewed R8 transaction. Any
# further behavior change needs its own explicit diff and evidence.
EXPECTED_RELEASE_PR = '0' # Nonoperational until the real release PR is bound.
EXPECTED_RELEASE_HEAD = 'codex/school-arthello-recovery-r9-20260909'
PREVIOUS_RELEASE_SHA = '582edaf1a66a953edb2d61e03040d1a13e70a0ad'
raise 'R9 release PR is not bound' unless EXPECTED_RELEASE_PR.match?(/\A[1-9][0-9]*\z/) && EXPECTED_RELEASE_PR.to_i > 370

old_source = File.read('.github/workflows/deploy-arthello-recovery-r8-20260908.yml')
raise 'Preserved R8 changed' unless Digest::SHA256.hexdigest(old_source) == 'ed520a49c67cfd992242ff6321d2f56cdf13a974e694eb24390747b3e8d1a716'
old = YAML.safe_load(old_source, aliases: true)
source = File.read('.github/workflows/deploy-arthello-recovery-r9-20260909.yml')
current = YAML.safe_load(source, aliases: true)
expected = Marshal.load(Marshal.dump(old))
expected['name'] = 'Deploy ArtHello recovery R9 D080'
expected['env'].merge!(
  'EXPECTED_RELEASE_HEAD'=>EXPECTED_RELEASE_HEAD,
  'EXPECTED_RELEASE_PR'=>EXPECTED_RELEASE_PR,
  'PREVIOUS_RELEASE_SHA'=>PREVIOUS_RELEASE_SHA)
%w[bundle deploy].each do |name|
  expected['jobs'][name]['if'] = expected['jobs'][name]['if']
    .gsub('codex/school-arthello-recovery-r8-20260908', EXPECTED_RELEASE_HEAD)
    .gsub("fromJSON('370')", "fromJSON('#{EXPECTED_RELEASE_PR}')")
    .gsub('D078: guarded R8', 'D080: guarded R9')
end
steps = expected.fetch('jobs').fetch('deploy').fetch('steps')
replay = File.read('.github/scripts/d080-replay-guard.py')
raise 'Replay source must have a terminal newline' unless replay.end_with?("\n")
steps.first['name'] = 'Verify D080 R9 identity and preserved R5 R8 abort boundary'
steps.first['run'] = steps.first.fetch('run').sub(/python3 -I - <<'D078_REPLAY'\n.*?D078_REPLAY/m) do
  "python3 -I - <<'D080_REPLAY'\n" + replay + 'D080_REPLAY'
end
%w[before after].each do |phase|
  step = steps.find {|item| item['name'] == "School diagnostic and real browser acceptance #{phase} cutover"}
  raise 'Missing R8 browser phase' unless step
  step['run'] = step.fetch('run').sub('run-r8-live-browser.sh', 'run-r9-live-browser.sh')
end
steps.last['run'] = steps.last.fetch('run').sub('ArtHello R8 production deployment','ArtHello R9 production deployment')
raise 'R9 changed a preserved R8 capability or production boundary' unless current == expected

# The complete job comparison above also protects sequencing. These explicit
# checks make failures at the essential mutation/acceptance boundaries readable.
job = current.fetch('jobs').fetch('deploy')
actual_steps = job.fetch('steps')
raise 'Cutover transaction changed' unless actual_steps.find {|item| item['id'] == 'cutover'} == old.fetch('jobs').fetch('deploy').fetch('steps').find {|item| item['id'] == 'cutover'}
before = actual_steps.index {|item| item['name'] == 'School diagnostic and real browser acceptance before cutover'}
cutover = actual_steps.index {|item| item['id'] == 'cutover'}
after = actual_steps.index {|item| item['name'] == 'School diagnostic and real browser acceptance after cutover'}
raise 'Natural browser ordering changed' unless before < cutover && cutover < after
raise 'Unexpected image lifecycle in release' if source.include?('retire-image.mjs')
checkout = actual_steps.index {|item| item['uses'].to_s.start_with?('actions/checkout@')}
raise 'Production capability before exact provenance' if actual_steps.take(checkout).map {|item| item['run'].to_s}.join("\n").match?(/(^|\s)(docker|ssh|sudo)(\s|$)/)

browser = YAML.safe_load(File.read('.github/workflows/check-arthello-server-browser.yml'), aliases: true)
expected_bundle = Marshal.load(Marshal.dump(browser.fetch('jobs').fetch('bundle')))
expected_bundle['if'] = job.fetch('if').strip + " && startsWith(github.event.workflow_run.head_commit.message, 'D080: guarded R9')"
raise 'Hosted browser capability widened' unless current.fetch('jobs').fetch('bundle') == expected_bundle
browser.fetch('jobs').fetch('natural-browser').fetch('steps').each do |item|
  next unless ['Check current trusted main and existing runner runtime before checkout',
               'Measure import capacity before downloading the verified archive',
               'Verify archive, import off-host bundle and verify portable identity',
               'Remove only this downloaded temporary archive'].include?(item['name']) || item['uses'].to_s.start_with?('actions/download-artifact@')
  preserved = Marshal.load(Marshal.dump(item))
  preserved['name'] = 'Check current release and existing browser runtime' if item['name'] == 'Check current trusted main and existing runner runtime before checkout'
  raise 'Reviewed browser import boundary changed' unless actual_steps.include?(preserved)
end

# Natural browser helpers only receive a fresh filename, report namespace and
# release marker. Schema3, real employee checks and 45-minute freshness remain.
{
  'r8-live-browser-acceptance.py'=>'417b9c6f1177708a1ea9b0b136ac49a6be7041001de94a6a0fc06974fe11934b',
  'run-r8-live-browser.sh'=>'a03cf5573df4278410ea772c04f3fff211614fdf7b67e2c15e999455dbc16f70',
  'test-r8-live-browser-acceptance.py'=>'fce53267a8569bca44aaa13002778b5a187ee13294b553f82d41411a4c2443bc',
  'check-school-live-acceptance-r7.py'=>'6fae34638acd1757cad922c288ede1282f8300a8ecfcbe3547661378445cb884'
}.each do |filename, digest|
  prior = File.read('.github/scripts/' + filename)
  raise "Preserved browser acceptance changed: #{filename}" unless Digest::SHA256.hexdigest(prior) == digest
  next if filename == 'check-school-live-acceptance-r7.py'
  replacement = prior.gsub('r8-live-browser','r9-live-browser')
    .gsub('ARTHELLO_R8_SSO_ACCEPTANCE','ARTHELLO_R9_SSO_ACCEPTANCE')
    .gsub('/r8-browser-','/r9-browser-')
  raise "R9 browser acceptance widened: #{filename}" unless File.read('.github/scripts/' + filename.sub('r8','r9')) == replacement
end

verification = File.read('.github/workflows/verify-arthello-v52.yml')
paths = %w[
  .github/workflows/deploy-arthello-recovery-r9-20260909.yml
  .github/scripts/check-recovery-r9-contract.rb
  .github/scripts/d080-replay-guard.py
  .github/scripts/test-d080-replay-guard.py
  .github/scripts/r9-live-browser-acceptance.py
  .github/scripts/test-r9-live-browser-acceptance.py
  .github/scripts/run-r9-live-browser.sh
]
commands = [
  'ruby .github/scripts/check-recovery-r9-contract.rb',
  'python3 -I .github/scripts/test-d080-replay-guard.py',
  'python3 -I .github/scripts/test-r9-live-browser-acceptance.py',
  'bash -n .github/scripts/run-r9-live-browser.sh'
]
paths.each do |path|
  raise "R9 path is absent: #{path}" unless File.file?(path)
  line = "      - #{path}\n"
  raise "Hosted R9 path is incomplete: #{path}" unless verification.scan(line).length == 2
  verification = verification.gsub(line, '')
end
commands.each do |command|
  line = "          #{command}\n"
  raise "Hosted R9 check is missing: #{command}" unless verification.scan(line).length == 1
  verification = verification.sub(line, '')
end
raise 'Existing v52 checks or platform authority changed' unless Digest::SHA256.hexdigest(verification) == '97b3e75457c709c802cac1e658c46e98eaac97b4ea9777940331e7902fbe9ee4'
puts 'ARTHELLO_D080_PRESERVED_R8_CUTOVER_AND_NATURAL_BROWSER_CONTRACT=VERIFIED'
