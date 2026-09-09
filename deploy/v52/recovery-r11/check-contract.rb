require 'yaml'
require 'digest'
require 'json'

# D085 preserves the complete R10 protocol and changes only invocation identity,
# the attested pre-authentication history and owned fixture cleanup.
raise 'Frozen R10 contract changed' unless Digest::SHA256.file('deploy/v52/recovery-r10/check-contract.rb').hexdigest == '74a486b0e533d9d982bc24a1d5b308cf31b44339640e80a6bca4d44ef45d18e8'
load 'deploy/v52/recovery-r10/check-contract.rb'

R11_HELPER_DIGESTS = {
  ".github/workflows/deploy-arthello-recovery-r11-20260909.yml" => "5e8e8fa0fd6efab28c46448cfb7fb4d65c4e4253d2ef2bd520dc6a5a893efd13",
  ".github/scripts/r11-replay-guard.py" => "8fa6658d913a3066cdb545fa09bf2e00c9b719db45e2fbb480d0c3b71c6c5d01",
  ".github/scripts/test-r11-replay-guard.py" => "6e7edfd976fbb7733de287f5fcc02966ae7d3ac40754c40af334b89f69fe6e66",
  ".github/scripts/run-r11-target-caddy.sh" => "5c6f90c02b6a56b3bf4b2bad50715e8dabf96eec25ac23bea0fea9e418f9e0b8",
  ".github/scripts/test-r11-target-caddy.test.mjs" => "75d49bae5a501ac6e425d24b9cb711ab88fe550bdb47afc2f87fe45abe52720c",
}
raise 'R11 reviewed manifest is incomplete' unless R11_HELPER_DIGESTS.length == 5
R11_HELPER_DIGESTS.each do |path, sha|
  raise "Unreviewed R11 source change: #{path}" unless digest(File.binread(path)) == sha
end

original = YAML.safe_load(File.read('.github/workflows/deploy-arthello-recovery-r10-20260909.yml'), aliases: true)
current = YAML.safe_load(File.read('.github/workflows/deploy-arthello-recovery-r11-20260909.yml'), aliases: true)
expected = Marshal.load(Marshal.dump(original))
expected['name'] = 'Deploy ArtHello recovery R11 D085'
expected['env'].merge!(
  'EXPECTED_RELEASE_HEAD'=>'codex/school-arthello-recovery-r11-20260909',
  'EXPECTED_RELEASE_PR'=>'380',
  'PREVIOUS_RELEASE_SHA'=>'2e57dd22c6ff1cec1fcad0bd11af479e465c00bb'
)
%w[bundle deploy].each do |name|
  expected['jobs'][name]['if'] = expected['jobs'][name]['if']
    .gsub('codex/school-arthello-recovery-r10-20260909', 'codex/school-arthello-recovery-r11-20260909')
    .gsub("fromJSON('379')", "fromJSON('380')")
    .gsub('D084: guarded R10', 'D085: guarded R11')
end
steps = expected.fetch('jobs').fetch('deploy').fetch('steps')
steps.first['name'] = 'Verify D085 R11 identity and preserved R5 R8 R9 R10 abort boundary'
pattern = /python3 -I - <<'D083_REPLAY'\n.*?D083_REPLAY/m
raise 'Frozen R10 inline guard boundary is ambiguous' unless steps.first['run'].scan(pattern).length == 1
steps.first['run'].sub!(pattern) { "python3 -I - <<'D085_REPLAY'\n" + File.read('.github/scripts/r11-replay-guard.py') + 'D085_REPLAY' }
steps.each do |step|
  if step['id'] == 'provenance'
    step['run'].sub!("'secret-scan,test,d084-candidate-tests'", "'secret-scan,test,d084-candidate-tests,d085-candidate-tests'")
  end
  if step['name'] == 'Verify actual gateway Caddy with isolated candidate fixture'
    step['run'].sub!('bash .github/scripts/run-d083-target-caddy.sh', 'bash .github/scripts/run-r11-target-caddy.sh')
  end
  if step['name'] == 'Production summary'
    step['run'].sub!('ArtHello R10 production deployment', 'ArtHello R11 production deployment')
  end
end
raise 'R11 changed frozen runtime, acceptance, recovery, authority or step sequence' unless expected == current

old_helper = File.read('.github/scripts/run-d083-target-caddy.sh')
new_helper = File.read('.github/scripts/run-r11-target-caddy.sh')
cleanup = /^cleanup\(\) \{\n.*?^\}\n/m
old_blocks, new_blocks = old_helper.scan(cleanup), new_helper.scan(cleanup)
raise 'Target fixture cleanup boundary is ambiguous' unless old_blocks.length == 1 && new_blocks.length == 1
raise 'R11 changed target Caddy fixture outside owned cleanup' unless new_helper.sub(new_blocks.first, old_blocks.first) == old_helper

quality_source = File.read('.github/workflows/quality.yml')
quality = YAML.safe_load(quality_source, aliases: true)
job = Marshal.load(Marshal.dump(quality.fetch('jobs').fetch('d085-candidate-tests')))
raise 'R11 contract pin does not match reviewed file' unless job.fetch('env').fetch('R11_CONTRACT_SHA256') == Digest::SHA256.file(__FILE__).hexdigest
job['env']['R11_CONTRACT_SHA256'] = 'CONTRACT_SHA256_PENDING'
raise 'R11 hosted source or regression tests changed' unless digest(JSON.generate(canonical(job))) == '96bb76e012f602c7924a8ecdc172d2696f13e419a8b716f984cce540da379433'
without_r11 = quality_source.sub(/\n  d085-candidate-tests:\n.*\z/m, '')
raise 'R11 Quality job is missing or duplicated' unless quality_source.scan(/^  d085-candidate-tests:\n/).length == 1
preserved_quality = YAML.safe_load(without_r11, aliases: true)
normalized_quality = Marshal.load(Marshal.dump(quality))
normalized_quality.fetch('jobs').delete('d085-candidate-tests')
raise 'R11 added another Quality job or overrode an existing gate' unless normalized_quality == preserved_quality
raise 'Existing Quality gates changed' unless digest(without_r11) == '16d666a6d3934e709a8bffa7733f4df25401d8f71af1744f520ea48e93727c05'
raise 'R11 contract is outside existing exact-image trigger' unless File.read('.github/workflows/verify-arthello-v52.yml').scan("      - deploy/v52/**\n").length == 2
puts 'ARTHELLO_D085_PRESERVED_R10_AND_OWNED_CLEANUP_CONTRACT=VERIFIED'
