require 'yaml'

source = File.read('.github/workflows/deploy-arthello-recovery-20260908.yml')
workflow = YAML.safe_load(source, aliases: true)
trigger = workflow['on'] || workflow[true]
raise 'D063 trigger must be workflow_run only' unless trigger.keys == ['workflow_run']
raise 'D063 must consume only successful canonical Verify completion' unless trigger.fetch('workflow_run') == {'workflows'=>['Verify ArtHello v52 release'], 'types'=>['completed']}
env = workflow.fetch('env')
raise 'D063 release identity changed' unless env.fetch('EXPECTED_REPOSITORY') == 'vitaliyozolin-dotcom/ArtHello-OS' && env.fetch('EXPECTED_RELEASE_HEAD') == 'codex/recovery-release-20260908' && env.fetch('EXPECTED_RELEASE_PR').to_s == '354' && env.fetch('PREVIOUS_RELEASE_SHA') == '9e4c49161e643997fe821a91b84c60c6e38ede33'
raise 'Release identity must come from upstream verified head' unless env.fetch('RELEASE_SHA') == '${{ github.event.workflow_run.head_sha }}'
raise 'Current event SHA is not release identity' if source.include?('$GITHUB_SHA') || source.include?('github.sha')
raise 'Release must not send issue comments' if workflow.fetch('permissions').key?('issues') || source.include?('/comments')
job = workflow.fetch('jobs').fetch('deploy')
raise 'Wrong production runner' unless job.fetch('runs-on') == ['self-hosted','linux','x64','arthello-gateway']
raise 'Production Environment missing' unless job.fetch('environment') == 'production-ru'
raise 'Shared production workflow lock missing' unless workflow.fetch('concurrency') == {'group'=>'gateway-38-55-arthello-production','cancel-in-progress'=>false}
raise 'Shared School lock missing' unless job.fetch('concurrency') == {'group'=>'school-1-11-production','cancel-in-progress'=>false}
condition = job.fetch('if')
["github.event_name == 'workflow_run'", "head_branch == 'main'", "conclusion == 'success'", "actor.login == 'vitaliyozolin-dotcom'", "triggering_actor.login == 'vitaliyozolin-dotcom'", "number == fromJSON('354')", "codex/recovery-release-20260908"].each {|token| raise 'Missing D063 trigger condition' unless condition.include?(token)}
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
['school-sso-readonly-diagnostic.sh', 'check-school-live-acceptance.py', 'OBSERVED_LIVE_ARTHELLO_SHA', 'StrictHostKeyChecking=yes', 'SHA256:/kBNohTF+5g8U+jQt+PzOCoWZ9yCSFjBnEP3Oc3MwRI'].each {|token| raise 'Missing diagnostic or real acceptance gate' unless diagnostic.include?(token)}
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
puts 'ARTHELLO_D063_CONTRACT=VERIFIED'
