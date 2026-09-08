require 'yaml'

source = File.read('.github/workflows/deploy-arthello-recovery-r5-20260908.yml')
workflow = YAML.safe_load(source, aliases: true)
trigger = workflow['on'] || workflow[true]
raise 'D067 trigger must be workflow_run only' unless trigger.keys == ['workflow_run']
raise 'D067 must consume only successful canonical Verify completion' unless trigger.fetch('workflow_run') == {'workflows'=>['Verify ArtHello v52 release'], 'types'=>['completed'], 'branches'=>['main']}
env = workflow.fetch('env')
raise 'D067 release identity changed' unless env.fetch('EXPECTED_REPOSITORY') == 'vitaliyozolin-dotcom/ArtHello-OS' && env.fetch('EXPECTED_RELEASE_HEAD') == 'codex/school-arthello-recovery-r5-20260908' && env.fetch('EXPECTED_RELEASE_PR').to_s == '360' && env.fetch('PREVIOUS_RELEASE_SHA') == 'ce7c50ba367fca14d71669305bf4e82b791ce4f7'
raise 'Release identity must come from upstream verified head' unless env.fetch('RELEASE_SHA') == '${{ github.event.workflow_run.head_sha }}'
raise 'Current event SHA is not release identity' if source.include?('$GITHUB_SHA') || source.include?('github.sha')
raise 'Release must not send issue comments' if workflow.fetch('permissions').key?('issues') || source.include?('/comments')
job = workflow.fetch('jobs').fetch('deploy')
raise 'Wrong production runner' unless job.fetch('runs-on') == ['self-hosted','linux','x64','arthello-gateway']
raise 'Production Environment missing' unless job.fetch('environment') == 'production-ru'
raise 'Shared production workflow lock missing' unless workflow.fetch('concurrency') == {'group'=>'gateway-38-55-arthello-production','cancel-in-progress'=>false,'queue'=>'max'}
raise 'Shared School lock missing' unless job.fetch('concurrency') == {'group'=>'school-1-11-production','cancel-in-progress'=>false,'queue'=>'max'}
condition = job.fetch('if')
["github.event_name == 'workflow_run'", "head_branch == 'main'", "conclusion == 'success'", "actor.login == 'vitaliyozolin-dotcom'", "triggering_actor.login == 'vitaliyozolin-dotcom'", "number == fromJSON('360')", "codex/school-arthello-recovery-r5-20260908"].each {|token| raise 'Missing D067 trigger condition' unless condition.include?(token)}
steps = job.fetch('steps')
bindings = 'serviceBindings: { TOCHKA_TRANSPORT: createTochkaTransport(), BACKUP_TRANSPORT: createBackupTransport() }'
checkout_contract = steps.find {|step| step['name'] == 'Verify checkout and release contracts'}.fetch('run')
raise 'Both production service bindings must be verified' unless checkout_contract.include?(bindings) && File.read('.github/workflows/verify-arthello-v52.yml').include?(bindings)
checkout_index = steps.index {|step| step['uses'].to_s.start_with?('actions/checkout@')}
raise 'Checkout missing' unless checkout_index
before_checkout = steps.take(checkout_index).map {|step| step['run'].to_s}.join("\n")
raise 'Capability accessed before exact gates' if before_checkout.match?(/(^|\s)(docker|ssh)(\s|$)/)
["workflow_success quality.yml 'Quality gates' 'secret-scan,test'", "workflow_success proof-gates.yml 'ArtHello Proof Gates' 'prove'", "workflow_success verify-arthello-v52.yml 'Verify ArtHello v52 release' 'verify-v52'", "test -n \"$proof_run\"", '.commit.verification.verified == true', '.parents[0].sha == $previous_sha', '.merged == true', 'safe_previous_job(job)', "cutovers[0].get('conclusion') == 'skipped'", "'Successful or ambiguous release cannot be replayed'"].each {|token| raise 'Missing exact gate or safe retry control' unless before_checkout.include?(token)}
diagnostic_index = steps.index {|step| step['name'] == 'Read-only School diagnostic and real browser acceptance'}
image_index = steps.index {|step| step['id'] == 'image_import'}
cutover_index = steps.index {|step| step['id'] == 'cutover'}
raise 'Diagnostic must precede image mutation and cutover' unless diagnostic_index && image_index && cutover_index && diagnostic_index < image_index && image_index < cutover_index
diagnostic = steps.fetch(diagnostic_index).fetch('run')
['school-sso-readonly-diagnostic.sh', 'check-school-live-acceptance-r5.py', 'OBSERVED_LIVE_ARTHELLO_SHA', 'StrictHostKeyChecking=yes', 'SHA256:/kBNohTF+5g8U+jQt+PzOCoWZ9yCSFjBnEP3Oc3MwRI'].each {|token| raise 'Missing diagnostic or real acceptance gate' unless diagnostic.include?(token)}
raise 'Diagnostic stage must not mutate production' if diagnostic.match?(/docker\s+(?:stop|rm|restart|update|run)|systemctl\s+(?:start|restart|enable)|install(?:-bridge)?\.sh/)
image = steps.fetch(image_index).fetch('run')
['.runnerTrust == "github-hosted-ephemeral"', '.productionCapability == false', '.headSha == $sha', '.treeSha == $tree', '.imageArchiveSha256 == $archive', 'runtimeFingerprintSha256'].each {|token| raise 'Missing hosted artifact trust check' unless image.include?(token)}
cutover = steps.fetch(cutover_index).fetch('run')
clone_proof = cutover.index("printf 'ARTHELLO_CLONE_PREFLIGHT=VERIFIED")
backup_install = cutover.index('bash deploy/v52/backup/install.sh "$host_active_d1"')
live_stop = cutover.index('docker stop --time 30 "$live_id"')
raise 'Backup install must follow clone proof and precede live stop' unless clone_proof && backup_install && live_stop && clone_proof < backup_install && backup_install < live_stop
raise 'Host path inspection must support sudo runner' unless cutover.index('root_command=(sudo -n)') < cutover.index('"${root_command[@]}" test -d "$data_mountpoint"')
raise 'Backup socket readiness must be bounded before live stop' unless cutover.index('for bridge_attempt in $(seq 1 30)') < live_stop && cutover.include?('test "$bridge_ready" -eq 1')
['bash deploy/v52/backup/install-bridge.sh', '--group-add "$backup_control_gid"', 'src=/var/lib/arthello-v52-backup-control,dst=/var/lib/arthello-v52-backup-control,readonly', 'TOCHKA_AUTOSYNC_ENABLED=0', 'TOCHKA_AUTOSYNC_ENABLED=1', 'ARTHELLO_ROLLBACK_VOLUME=VERIFIED', 'trap on_exit EXIT', 'verify_public "$run_key"', 'require_current_main_release'].each {|token| raise 'Missing backup/runtime/rollback integration' unless cutover.include?(token)}
local_check = cutover.index('verify_public "$run_key-internal" http://127.0.0.1:8081')
durable = cutover.index('d063-activation-state.py activation-start')
boundary = cutover.index('public_commit_started=1')
route_move = cutover.index('mv "$CANDIDATE_ROUTE" /data/external-routes.caddy')
public_check = cutover.index('verify_public "$run_key"', route_move)
bank_activation = cutover.index('d063-activation-state.py enable-autosync')
raise 'Public commit boundary or bank activation order changed' unless local_check < durable && durable < boundary && boundary < route_move && route_move < public_check && public_check < bank_activation
rollback = cutover[cutover.index('rollback() {')...cutover.index('on_exit() {')]
preserve = rollback.index('if [ "$public_commit_started" -eq 1 ]; then')
restore = rollback.index('copy_volume "$rollback_volume" "$DATA_VOLUME"')
raise 'Post-activation rollback must preserve new writes and diagnostics' unless preserve < restore && rollback[preserve...restore].include?('exit "$original_rc"') && rollback.include?('ARTHELLO_POST_ACTIVATION_RECOVERY_REQUIRED=1')
['RELEASE_SHA="$RELEASE_SHA"', 'TOCHKA_AUTOSYNC_ACTIVATION_ID="$autosync_activation_id"'].each {|token| raise 'Missing bank activation identity' unless cutover.include?(token)}
raise 'Broad pruning forbidden' if source.match?(/docker\s+(system|builder|image)\s+prune/)


require 'json'
require 'digest'
repair_index = steps.index {|step| step['id'] == 'school_repair'}
raise 'School repair must follow checkout and precede diagnosis/ArtHello image import' unless repair_index && checkout_index < repair_index && repair_index < diagnostic_index
repair = steps.fetch(repair_index).fetch('run')
['deploy/school/sso-relay-r5', 'r4-school-repair-remote.py', 'EXPECTED_REPAIR_CONFIG_SHA256', 'EXPECTED_REPAIR_BUNDLE_SHA256', 'check-school-repair-receipt-r3.py', 'StrictHostKeyChecking=yes', "SHA256:/kBNohTF+5g8U+jQt+PzOCoWZ9yCSFjBnEP3Oc3MwRI"].each {|token| raise 'Missing exact protected School repair transport' unless repair.include?(token)}
raise 'Current main must be rechecked immediately before School mutation' unless repair.index('test "$current_main" = "$RELEASE_SHA"') < repair.index('timeout --signal=TERM --kill-after=15s 720s') && repair.include?('/git/ref/heads/main')
raise 'Repair cannot build or pull production images' if repair.match?(/docker\s+(?:build|pull)|npm\s+install|pnpm\s+install/)
raise 'Repair replay must reject failed/ambiguous repairs' unless before_checkout.include?("repairs[0].get('conclusion') in ('success', 'skipped')")
raise 'SSO evidence must bind current verified repair config' unless steps.fetch(diagnostic_index).fetch('env').fetch('SCHOOL_REPAIR_CONFIG_SHA256') == '${{ steps.school_repair.outputs.config_sha256 }}'
raise 'Read-only Alfa presence probe missing' unless diagnostic.include?('r2-alfacrm-env-presence.sh') && diagnostic.include?('--current-arthello') && diagnostic.include?('--school-legacy')
root = 'deploy/school/sso-relay-r5'
manifest = JSON.parse(File.read("#{root}/manifest.json"))
raise 'R3 configuration-only scope changed' unless manifest['schemaVersion'] == 2 && manifest['decisionId'] == 'D067' && manifest['school'] == {'container'=>'school-1-11','sourceSha'=>'54242340f2d9b6a9887d69ecc03520ddf9f7982c','imageId'=>'sha256:664c2c0c3e628a53ca492953803b420e0c4a44acab35eb250f5f899c10bc93df','network'=>'arthello-os_backend'}
raise 'Relay fixed scope changed' unless manifest['relay'] == {'container'=>'school-arthello-sso-relay','egressNetwork'=>'school-arthello-sso-egress','hostname'=>'arthello-188-225-38-55.sslip.io','upstream'=>'188.225.38.55:443','uid'=>1001,'gid'=>1001}
raise 'R3 must preserve School application/data/shared network' unless manifest['scope'] == {'applicationBuildOnProduction'=>false,'schoolDataChanges'=>false,'schoolRuntimeChanges'=>false,'sharedNetworkInternalChanges'=>false,'tlsTermination'=>false}
raise 'Reviewed DNS diagnosis identity changed' unless manifest['diagnosis'] == {'category'=>'internal_bridge_dns_unavailable','dnsError'=>'EAI_AGAIN','jobId'=>101955030295,'runId'=>34193103822}
raise 'Unexpected relay bundle files' unless manifest.fetch('files').keys.sort == ['healthcheck.mjs','relay.mjs','repair.py']
manifest.fetch('files').each do |filename, sha|
  path = "#{root}/#{filename}"
  raise 'Relay bundle source escaped review' unless File.file?(path) && !File.symlink?(path) && File.size(path).between?(1,262144) && Digest::SHA256.file(path).hexdigest == sha
end
verify_source = File.read('.github/workflows/verify-arthello-v52.yml')
['ruby .github/scripts/check-recovery-r5-contract.rb','python3 -I .github/scripts/test-recovery-r5-gates.py','node --test scripts/test/school-sso-relay-r5.test.mjs','python3 -I scripts/test/school-sso-repair-r5.test.py','bash scripts/test/school-sso-relay-r5-docker-smoke.sh'].each {|token| raise 'Hosted R3 gate missing' unless verify_source.include?(token)}
raise 'R3 ordinary-user execution scope changed' unless manifest['execution'] == {'elevation'=>false,'requireOrdinaryUid'=>true,'sharedLock'=>'/var/lock/school-1-11-production.lock','sharedLockAccess'=>'existing-readonly-no-follow-nonblock','stateLeaf'=>'.arthello-school-sso-relay','stateOwner'=>'passwd-home-caller'}
bootstrap = File.read('.github/scripts/r3-school-repair-remote.py')
raise 'R3 bootstrap must not elevate or accept a state path' if bootstrap.include?("['sudo'") || bootstrap.include?('os.execvp') || bootstrap.include?("os.environ['HOME']") || bootstrap.include?('STATE_ROOT=')
['pwd.getpwuid(uid).pw_dir', "root = home / '.arthello-school-sso-relay'", 'checked_shared_lock(uid)', 'os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK', 'os.getgid() != os.getegid()', "prefix='.incoming-', dir=root"].each {|token| raise 'R3 caller/lock/staging boundary missing' unless bootstrap.include?(token)}
acceptance_source = File.read('.github/scripts/check-school-live-acceptance-r5.py')
['observedSchoolRepairExecutionUid', 'observedSchoolRepairStateDirectorySha256', "record.get('schemaVersion') == 3", 'minutes=45'].each {|token| raise 'R3 browser evidence identity missing' unless acceptance_source.include?(token)}

# D067 preserves the existing shared queues; old authorization and
# deployment code are byte-identical to the inspected main parent.
legacy_queue_sources = {'deploy-arthello-direct-38-55.yml'=>'f3e7759119cc717835c607275fc227219ae6de6dced40c71e44097b4e5f06ac9','deploy-arthello-recovery-20260908.yml'=>'246bf0cd6c19e98fceb96ae608fb6fd2b11272baf98be5abfcf116f663cef53b','deploy-arthello-recovery-r2-20260908.yml'=>'8653741f0974eb837d19a524de384ab8b16b3e3b2dd82e719bffe96e2658f28e','deploy-arthello-recovery-r3-20260908.yml'=>'f03324b9e580c9ff58e2a5299160e95cc5859266f52a4fe9044a0c4951872a42'}
legacy_queue_sources.each do |filename, expected|
  legacy_source = File.read('.github/workflows/' + filename)
  raise 'Only the two existing shared queues may change' unless legacy_source.lines.count { |line| line.match?(/^\s*queue: max$/) } == 2
  baseline_source = legacy_source.gsub(/^\s*queue: max\n/, '')
  raise 'An old release controller changed beyond queue capacity' unless Digest::SHA256.hexdigest(baseline_source) == expected
  document = YAML.safe_load(legacy_source, aliases: true)
  raise 'Existing gateway serialization changed' unless document.fetch('concurrency') == {'group'=>'gateway-38-55-arthello-production','cancel-in-progress'=>false,'queue'=>'max'}
  raise 'Existing School serialization changed' unless document.fetch('jobs').fetch('deploy').fetch('concurrency') == {'group'=>'school-1-11-production','cancel-in-progress'=>false,'queue'=>'max'}
end

r4_bootstrap = File.read('.github/scripts/r4-school-repair-remote.py')
raise 'R4 bootstrap must preserve ordinary execution boundary' if r4_bootstrap.include?("['sudo'") || r4_bootstrap.include?('os.execvp') || r4_bootstrap.include?("os.environ['HOME']") || r4_bootstrap.include?('STATE_ROOT=')
['EXPECTED_UID = 1000', 'EXPECTED_GID = 1000', 'SOURCE_MODE = 0o664', 'TARGET_MODE = 0o644', 'os.fchmod(fd, TARGET_MODE)', 'fcntl.LOCK_EX | fcntl.LOCK_NB', 'modeChangeAttempted', "file=sys.stderr", 'sanitized_failure(error)'].each {|token| raise 'R4 bounded owner-lock normalization missing' unless r4_bootstrap.include?(token)}
r4_main = r4_bootstrap[r4_bootstrap.index('def main():')...r4_bootstrap.index('ERROR_CODES =')]
raise 'R4 permission mutation must follow identity, home/state and exact bundle validation' unless r4_main.index('validated_environment()') < r4_main.index('decoded = decode_bundle(') && r4_main.index('checked_home(') < r4_main.index('decoded = decode_bundle(') && r4_main.index("STAGE = 'existing_private_state'") < r4_main.index('decoded = decode_bundle(') && r4_main.index('decoded = decode_bundle(') < r4_main.index('normalization = normalize()')
raise 'R4 normalization must precede strict R3 lock and private staging' unless r4_main.index('normalization = normalize()') < r4_main.index('checked_shared_lock(uid)') && r4_main.index('checked_shared_lock(uid)') < r4_main.index('root.mkdir(mode=0o700)')
['python3 -I .github/scripts/test-school-shared-lock-d066.py', 'python3 -I .github/scripts/test-recovery-r4-bootstrap.py'].each {|token| raise 'Hosted D067 normalization/bootstrap gate missing' unless verify_source.include?(token)}
raise 'D067 must use its fresh natural-browser evidence path' unless acceptance_source.include?('2026-09-08-school-live-acceptance-r5.json?ref=codex/recovery-evidence-20260907')
raise 'D066 controller changed after failed repair' unless Digest::SHA256.file('.github/workflows/deploy-arthello-recovery-r4-20260908.yml').hexdigest == '484fba618e4ee3118fbae703f22cd07a3b4677cb5e4bf1390a9797c0da84da5b'
raise 'Actual Docker mount comparison is mandatory' unless verify_source.include?('bash scripts/test/school-sso-fingerprint-r5-docker-smoke.sh')
puts 'ARTHELLO_D067_CONTRACT=VERIFIED'
