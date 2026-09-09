require 'yaml'
require 'digest'
require 'json'

# D086 retains the complete R11/R10 protocol and all existing Quality gates.
raise 'Frozen R11 contract changed' unless Digest::SHA256.file('deploy/v52/recovery-r11/check-contract.rb').hexdigest == '67c2f3165e8275c2610dee6619e67fc943cfb14e300b232a61e0d889e6da2ede'
load 'deploy/v52/recovery-r11/check-contract.rb'

R12_HELPER_DIGESTS = {
  ".github/workflows/deploy-arthello-recovery-r12-20260909.yml" => "70466a2199d72611f5b3ee10f580163c02695496370db5159defdb2740db7798",
  ".github/scripts/r12-replay-guard.py" => "b4cfe6e07346a076c72c2c2d848ac9a1d3fe43f915618431ea164079b9b81213",
  ".github/scripts/test-r12-replay-guard.py" => "09097be61fb834925e8b124b22d5a02cdc33fad9cced55c45729a198ec357632",
  "deploy/browser/retire-r10-images.mjs" => "7fb985a43b52940792cfd641e2226883166858891c9393ce77f11b4c8d72dd5d",
  "scripts/test/retire-r10-images.test.mjs" => "ee1351e288cba460c44d6c5e3b29f1725e85bd5932800f9844070f29aa662556",
  "deploy/browser/capacity.mjs" => "61db6b108b43420f7e0b9124a4470c028d30552ab4733ac73b3446013277ccb0",
  "deploy/v52/maintenance/image-runtime-fingerprint.jq" => "6c39aba7adaf25a48d0882443c56d4741af65cca2785f4fcaedd5e11f132e041",
}
raise 'R12 reviewed manifest is incomplete' unless R12_HELPER_DIGESTS.length == 7
R12_HELPER_DIGESTS.each do |path, sha|
  raise "Unreviewed R12 source change: #{path}" unless digest(File.binread(path)) == sha
end

original = YAML.safe_load(File.read('.github/workflows/deploy-arthello-recovery-r11-20260909.yml'), aliases: true)
current = YAML.safe_load(File.read('.github/workflows/deploy-arthello-recovery-r12-20260909.yml'), aliases: true)
expected = Marshal.load(Marshal.dump(original))
expected['name'] = 'Deploy ArtHello recovery R12 D086'
expected['env'].merge!(
  'EXPECTED_RELEASE_HEAD'=>'codex/school-arthello-recovery-r12-20260909',
  'EXPECTED_RELEASE_PR'=>'381',
  'PREVIOUS_RELEASE_SHA'=>'e579a20a2a1a40fab489340511f8c35dc6929081'
)
%w[bundle deploy].each do |name|
  expected['jobs'][name]['if'] = expected['jobs'][name]['if']
    .gsub('codex/school-arthello-recovery-r11-20260909', 'codex/school-arthello-recovery-r12-20260909')
    .gsub("fromJSON('380')", "fromJSON('381')")
    .gsub('D085: guarded R11', 'D086: guarded R12')
end
steps = expected.fetch('jobs').fetch('deploy').fetch('steps')
steps.first['name'] = 'Verify D086 R12 identity and preserved R5 R8 R9 R10 R11 abort boundary'
pattern = /python3 -I - <<'D085_REPLAY'\n.*?D085_REPLAY/m
raise 'Frozen R11 inline guard boundary is ambiguous' unless steps.first['run'].scan(pattern).length == 1
steps.first['run'].sub!(pattern) { "python3 -I - <<'D086_REPLAY'\n" + File.read('.github/scripts/r12-replay-guard.py') + 'D086_REPLAY' }
steps.each do |step|
  if step['id'] == 'provenance'
    step['run'].sub!("proof_run=\"\"\n", "proof_run=\"\"\nr12_run=\"\"\n")
    step['run'].sub!(
      '  if [ -n "$quality_run" ] && [ -n "$verify_run" ] && [ -n "$proof_run" ]; then',
      "  if [ -z \"$r12_run\" ]; then\n" +
      "    r12_run=\"$(workflow_success verify-arthello-r12.yml 'Verify ArtHello R12 continuation' 'd086-candidate-tests' || true)\"\n" +
      "  fi\n" +
      '  if [ -n "$quality_run" ] && [ -n "$verify_run" ] && [ -n "$proof_run" ] && [ -n "$r12_run" ]; then'
    )
    step['run'].sub!("test -n \"$proof_run\"\n", "test -n \"$proof_run\"\ntest -n \"$r12_run\"\n")
    step['run'].sub!("printf 'ARTHELLO_EXACT_SHA_GATES=VERIFIED\\n'", "printf 'r12_run=%s\\n' \"$r12_run\" >> \"$GITHUB_OUTPUT\"\nprintf 'ARTHELLO_EXACT_SHA_GATES=VERIFIED\\n'")
  end
  if step['name'] == 'Production summary'
    step['run'].sub!('ArtHello R11 production deployment', 'ArtHello R12 production deployment')
    step['env']['R12_RUN'] = '${{ steps.provenance.outputs.r12_run }}'
    step['run'].sub!('  echo "- Quality run: $QUALITY_RUN"', "  echo \"- Quality run: $QUALITY_RUN\"\n  echo \"- R12 regression run: $R12_RUN\"")
  end
end
retirement_name = 'Retire only unused recoverable R10 images for import capacity under D086'
current_steps = current.fetch('jobs').fetch('deploy').fetch('steps')
raise 'R12 retirement is missing or duplicated' unless current_steps.count {|s| s['name'] == retirement_name} == 1
retirement_index = current_steps.index {|s| s['name'] == retirement_name}
raise 'R12 retirement must follow R9 retirement and precede fresh capacity' unless current_steps[retirement_index-1]['name'] == 'Retire only the exact unused R9 browser image under D084' && current_steps[retirement_index+1]['name'] == 'Measure import capacity before downloading the verified archive'
retirement = current_steps[retirement_index]
raise 'R12 retirement runs during held-candidate resume' unless retirement['if'] == "env.R9_RESUME_CANDIDATE != '1'"
raise 'R12 retirement invocation changed' unless digest(JSON.generate(canonical(retirement))) == 'a6c4cf4509fa8f971815e4a916dc73efd7158849afc5a619535816eb0713720f'
steps.insert(retirement_index, retirement)
raise 'R12 changed frozen runtime, acceptance, recovery, authority or step sequence' unless expected == current

gate = YAML.safe_load(File.read('.github/workflows/verify-arthello-r12.yml'), aliases: true)
job = gate.fetch('jobs').fetch('d086-candidate-tests')
raise 'R12 contract pin does not match reviewed file' unless job.fetch('env').fetch('R12_CONTRACT_SHA256') == Digest::SHA256.file(__FILE__).hexdigest
job['env']['R12_CONTRACT_SHA256'] = 'CONTRACT_SHA256_PENDING'
raise 'R12 hosted source, triggers, authority or tests changed' unless digest(JSON.generate(canonical(gate))) == 'af017ad773bfc9c4d9c0558605f5a2f09bbf9aabd912dbb010bb4a4e6c6f1d00'
raise 'R12 contract is outside existing exact-image trigger' unless File.read('.github/workflows/verify-arthello-v52.yml').scan("      - deploy/v52/**\n").length == 2
puts 'ARTHELLO_D086_PRESERVED_R11_AND_BOUNDED_IMAGE_LIFECYCLE_CONTRACT=VERIFIED'
