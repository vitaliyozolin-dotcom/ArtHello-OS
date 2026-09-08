require 'yaml'
require 'digest'

old_source = File.read('.github/workflows/deploy-arthello-recovery-r7-20260908.yml')
raise 'Preserved R7 changed' unless Digest::SHA256.hexdigest(old_source) == '1c73cc425ae8b6448ec6fcc86d502f676ec10d8313fb0db59ef214b1d649c390'
old = YAML.safe_load(old_source, aliases: true)
source = File.read('.github/workflows/deploy-arthello-recovery-r8-20260908.yml')
current = YAML.safe_load(source, aliases: true)
%w[on permissions concurrency].each {|key| raise 'Platform authority changed' unless current.fetch(key) == old.fetch(key)}
job, previous = current.fetch('jobs').fetch('deploy'), old.fetch('jobs').fetch('deploy')
%w[runs-on timeout-minutes environment concurrency].each {|key| raise 'Protected boundary changed' unless job.fetch(key) == previous.fetch(key)}
identity = current.fetch('env')
raise 'R8 PR is not bound' unless identity.fetch('EXPECTED_RELEASE_PR') == '370'
raise 'Browser dependency is missing' unless job.fetch('needs') == 'bundle'
raise 'Browser fingerprint is not bound to this producing job' unless job.fetch('env') == {'BROWSER_FINGERPRINT'=>'${{ needs.bundle.outputs.fingerprint }}'}
raise 'Unexpected environment/candidate parent' unless identity == old.fetch('env').merge(
  'EXPECTED_RELEASE_HEAD'=>'codex/school-arthello-recovery-r8-20260908',
  'EXPECTED_RELEASE_PR'=>'370',
  'PREVIOUS_RELEASE_SHA'=>'e5a51ca8ef26d150ac02d30eb1318603e140f08f',
  'CHECKED_SOURCE_SHA'=>'${{ github.event.workflow_run.head_sha }}',
  'BROWSER_SOURCE_SHA'=>'${{ github.event.workflow_run.head_sha }}')
raise 'Exact owner/canonical trigger changed' unless job.fetch('if') == previous.fetch('if').gsub('recovery-r7-20260908','recovery-r8-20260908').gsub("'362'", "'370'")
steps, old_steps = job.fetch('steps'), previous.fetch('steps')
raise 'Unexpected production step' unless steps.length == old_steps.length + 6
changed = ['Verify D069 R7 identity and safe verified-School resume', 'Read-only School diagnostic and real browser acceptance', 'Production summary']
old_steps.each do |step|
  next if changed.include?(step['name'])
  raise "Preserved capability changed: #{step['name']}" unless steps.find {|item| item['name'] == step['name']} == step
end
# The entire cutover step, including clone, first backup, durable write boundary,
# isolated activation writer, rollback and source/secret guards, is byte-identical.
raise 'Cutover changed' unless steps.find {|step| step['id'] == 'cutover'} == old_steps.find {|step| step['id'] == 'cutover'}
replay = File.read('.github/scripts/d078-replay-guard.py')
first = Marshal.load(Marshal.dump(old_steps.first))
first['name'] = 'Verify D078 R8 identity and preserved R5 R7 abort boundary'
first['run'] = first.fetch('run').sub(/python3 -I - <<'D069_REPLAY'\n.*?D069_REPLAY/m, "python3 -I - <<'D078_REPLAY'\n" + replay + 'D078_REPLAY')
raise 'First identity/replay step drifted' unless steps.first == first
['validate_installation(', 'validate_r6_abort(', 'validate_r7_abort(', '34227595623', '102065872459',
 "identities.count(current_run) == 1", "cutovers[0].get('conclusion') == 'skipped'"].each {|token| raise 'Replay boundary missing' unless replay.include?(token)}
old_diagnostic = old_steps.find {|step| step['name'] == changed[1]}
%w[before after].each do |phase|
  expected = Marshal.load(Marshal.dump(old_diagnostic))
  expected['name'] = "School diagnostic and real browser acceptance #{phase} cutover"
  expected['env'].merge!('ARTHELLO_E2E_LOGIN'=>'${{ secrets.ARTHELLO_E2E_LOGIN }}',
                         'ARTHELLO_E2E_PASSWORD'=>'${{ secrets.ARTHELLO_E2E_PASSWORD }}', 'BROWSER_PHASE'=>phase)
  expected['run'] = expected.fetch('run').sub('python3 -I .github/scripts/check-school-live-acceptance-r7.py','bash .github/scripts/run-r8-live-browser.sh')
  raise 'School/browser step widened' unless steps.find {|step| step['name'] == expected['name']} == expected
end
before = steps.index {|step| step['name'].to_s.end_with?('before cutover')}
cutover = steps.index {|step| step['id'] == 'cutover'}
after = steps.index {|step| step['name'].to_s.end_with?('after cutover')}
raise 'Natural browser ordering changed' unless before < cutover && cutover < after
summary = Marshal.load(Marshal.dump(old_steps.last))
summary['run'] = summary.fetch('run').sub('ArtHello R7 production deployment','ArtHello R8 production deployment')
raise 'After-public preservation summary changed' unless steps.last == summary
checkout = steps.index {|step| step['uses'].to_s.start_with?('actions/checkout@')}
raise 'Production capability before exact provenance' if steps.take(checkout).map {|step| step['run'].to_s}.join("\n").match?(/(^|\s)(docker|ssh|sudo)(\s|$)/)
browser = YAML.safe_load(File.read('.github/workflows/check-arthello-server-browser.yml'), aliases: true)
expected_bundle = Marshal.load(Marshal.dump(browser.fetch('jobs').fetch('bundle')))
expected_bundle['if'] = job.fetch('if').strip + " && startsWith(github.event.workflow_run.head_commit.message, 'D078: guarded R8')"
raise 'Hosted browser capability widened' unless current.fetch('jobs').fetch('bundle') == expected_bundle
canonical_steps = browser.fetch('jobs').fetch('natural-browser').fetch('steps')
canonical_steps.each do |step|
  next unless ['Check current trusted main and existing runner runtime before checkout',
               'Measure import capacity before downloading the verified archive',
               'Verify archive, import off-host bundle and verify portable identity',
               'Remove only this downloaded temporary archive'].include?(step['name']) || step['uses'].to_s.start_with?('actions/download-artifact@')
  expected = Marshal.load(Marshal.dump(step))
  if expected['name'] == 'Check current trusted main and existing runner runtime before checkout'
    expected['name'] = 'Check current release and existing browser runtime'
  end
  raise 'Reviewed browser import boundary changed' unless steps.include?(expected)
end
verification = File.read('.github/workflows/verify-arthello-v52.yml')
['ruby .github/scripts/check-recovery-r8-contract.rb', 'python3 -I .github/scripts/test-d078-replay-guard.py',
 'python3 -I .github/scripts/test-r8-live-browser-acceptance.py', 'bash -n .github/scripts/run-r8-live-browser.sh'].each {|token| raise 'Hosted R8 check missing' unless verification.include?(token)}
puts 'ARTHELLO_D078_PRESERVED_CUTOVER_AND_NATURAL_BROWSER_CONTRACT=VERIFIED'
