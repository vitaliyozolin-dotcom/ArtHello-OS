require 'yaml'
require 'digest'

base_source = File.read('.github/workflows/deploy-arthello-recovery-r6-20260908.yml')
raise 'Spent R6 source changed' unless Digest::SHA256.hexdigest(base_source) == 'fba1b0dbefa5fba7916f47525b73021dda86ec5e465b169c3f32e64c05d20806'
base = YAML.safe_load(base_source, aliases: true)
source = File.read('.github/workflows/deploy-arthello-recovery-r7-20260908.yml')
document = YAML.safe_load(source, aliases: true)
%w[on permissions concurrency].each {|key| raise 'Platform trigger/authority changed' unless document.fetch(key) == base.fetch(key)}
job, old_job = document.fetch('jobs').fetch('deploy'), base.fetch('jobs').fetch('deploy')
%w[runs-on timeout-minutes environment concurrency].each {|key| raise 'Protected runtime boundary changed' unless job.fetch(key) == old_job.fetch(key)}
raise 'R7 identity wrong' unless document.fetch('env') == base.fetch('env').merge('EXPECTED_RELEASE_HEAD'=>'codex/school-arthello-recovery-r7-20260908','EXPECTED_RELEASE_PR'=>'362','PREVIOUS_RELEASE_SHA'=>'eb47c1360fbd701876a3c49efe029194707304db')
raise 'Exact owner/canonical workflow gate changed' unless job.fetch('if') == old_job.fetch('if').gsub('recovery-r6-20260908','recovery-r7-20260908').gsub("'361'","'362'")
steps, old_steps = job.fetch('steps'), old_job.fetch('steps')
raise 'Unexpected extra production steps' unless steps.length == old_steps.length
changed_names = ['Verify D068 R6 identity and safe verified-School resume','Check existing gateway backup installation capability',
 'Read-only School diagnostic and real browser acceptance','Clone preflight and guarded production cutover','Production summary']
old_steps.each do |old|
  next if changed_names.include?(old['name'])
  raise 'Unrelated capability step changed' unless steps.find {|step| step['name'] == old['name']} == old
end
replay = File.read('.github/scripts/d069-replay-guard.py')
raise 'Inline replay does not match reviewed standalone' unless steps.first.fetch('run').include?("python3 -I - <<'D069_REPLAY'\n" + replay + 'D069_REPLAY')
['validate_installation(', 'validate_r6_abort(', '34208952716', '102005327418', '34221458013', '102045375780',
 "identities.count(current_run) == 1", 'len(set(identities)) == len(identities)', "cutovers[0].get('conclusion') == 'skipped'"].each {|token| raise 'Replay or preserved installation guard missing' unless replay.include?(token)}
checkout = steps.index {|step| step['uses'].to_s.start_with?('actions/checkout@')}
raise 'Capability used before exact gates' if steps.take(checkout).map {|step| step['run'].to_s}.join("\n").match?(/(^|\s)(docker|ssh|sudo)(\s|$)/)
early = steps.find {|step| step['name'] == 'Check existing gateway Docker authority'}.fetch('run')
['docker version --format', 'docker volume inspect "$DATA_VOLUME"', 'ARTHELLO_OBSERVED_LIVE_RELEASE_SHA', '"backupWorkerReady":false'].each {|token| raise 'Honest existing Docker read-only capability check missing' unless early.include?(token)}
['docker exec --user 1000:1000 -i', 'fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK', 'fs.fstatSync(fd)', 'info.uid !== 1000 || info.gid !== 1000', 'sourceOwnershipVerified'].each {|token| raise 'Ordinary UID read-only source prerequisite missing' unless early.include?(token)}
raise 'Early capability check mutates authority/resources' if early.match?(/sudo|chown|chmod|systemctl|docker\s+(run|create|start|restart|update|rm)/)
diagnostic = steps.find {|step| step['name'] == 'Read-only School diagnostic and real browser acceptance'}
old_diagnostic = Marshal.load(Marshal.dump(old_steps.find {|step| step['name'] == diagnostic['name']}))
old_diagnostic['run'] = old_diagnostic['run'].gsub('check-school-live-acceptance-r6.py','check-school-live-acceptance-r7.py')
raise 'Natural SSO diagnostic changed' unless diagnostic == old_diagnostic
raise 'Natural SSO constraints weakened' unless File.read('.github/scripts/check-school-live-acceptance-r7.py') == File.read('.github/scripts/check-school-live-acceptance-r6.py').gsub('2026-09-08-school-live-acceptance-r6.json','2026-09-08-school-live-acceptance-r7.json')
cutover = steps.find {|step| step['id'] == 'cutover'}.fetch('run')
old_cutover = old_steps.find {|step| step['id'] == 'cutover'}.fetch('run')
def functions(source)
  source.scan(/^([a-z_]+)\(\) \{\n.*?^\}/m).flatten.to_h {|name| [name, source.match(/^#{Regexp.escape(name)}\(\) \{\n.*?^\}/m)[0]]}
end
old_functions, new_functions = functions(old_cutover), functions(cutover)
old_functions.each do |name, body|
  next if %w[cleanup_transient rollback].include?(name)
  raise 'Existing data, secret, inventory or source gate changed' unless new_functions[name] == body
end
raise 'Unexpected runtime helper' unless (new_functions.keys - old_functions.keys).sort == %w[backup_runtime cleanup_backup_runtime initialize_backup_runtime_state]
raise 'Denied host installer remains' if cutover.match?(/root_command|sudo\s|systemctl|getent group|host_active_d1|data_mountpoint|backup\/install(?:-bridge)?\.sh|enable-autosync/)
clone = cutover.index("printf 'ARTHELLO_CLONE_PREFLIGHT=VERIFIED")
prepare = cutover.index('backup_runtime prepare | tee')
live_stop = cutover.index('docker stop --time 30 "$live_id"')
raise 'First verified ordinary backup must follow clone and precede live mutation' unless clone < prepare && prepare < live_stop && cutover.index(".schemaVersion == 1 and .state == \"verified\"", prepare) < live_stop
['--state-file "$backup_runtime_state"', '--source-relative "$active_d1_relative_path"',
 'backup_runtime_state_dir="$secret_dir/release-state/backup-runtime-$run_key"', 'backup_runtime_state="$backup_runtime_state_dir/backup-runtime-state.json"',
 'dst=/var/lib/arthello-v52-backup-control,readonly,volume-nocopy', 'dst=/var/lib/arthello-v52-tochka-activation,readonly,volume-nocopy',
 'all($mounts[]; .Type == "volume" and .RW == false)', 'TOCHKA_AUTOSYNC_ENABLED=0', 'TOCHKA_AUTOSYNC_ENABLED=1',
 'secrets.token_hex(32)', '"$autosync_activation_id" =~ ^[a-f0-9]{64}$'].each {|token| raise 'Ordinary isolated runtime contract missing' unless cutover.include?(token)}
local_check = cutover.index('verify_public "$run_key-internal" http://127.0.0.1:8081')
durable = cutover.index('d063-activation-state.py activation-start')
boundary = cutover.index('public_commit_started=1')
route_move = cutover.index('mv "$CANDIDATE_ROUTE" /data/external-routes.caddy')
public_check = cutover.index('verify_public "$run_key"', route_move)
hmac = cutover.index('verify_school_sync_secret after-route-activation', public_check)
current = cutover.index('require_current_main_release', hmac)
writer = cutover.index('--name "arthello-v52-activation-writer-$run_key"')
raise 'Durable write boundary or bank activation ordering changed' unless local_check < durable && durable < boundary && boundary < route_move && route_move < public_check && public_check < hmac && hmac < current && current < writer
['--user 1002:1000 --network none --read-only --cap-drop ALL', '--security-opt no-new-privileges:true',
 'activation-volume.py write', '--nonce "$autosync_activation_id"', '.protocol == "ARTHELLO_TOCHKA_AUTOSYNC_V2"',
 '.executionUid == 1002 and .executionGid == 1000', '.markerMode == "0640" and .mode == "created"'].each {|token| raise 'Deployment-only V2 marker authority missing' unless cutover.include?(token)}
rollback = new_functions.fetch('rollback')
guard = rollback.index('if [ "$public_commit_started" -eq 1 ]; then')
preserve_exit = rollback.index('exit "$original_rc"', guard)
cleanup = rollback.index('cleanup_backup_runtime')
restore = rollback.index('copy_volume "$rollback_volume" "$DATA_VOLUME"')
raise 'After-public resources/writes must survive; before-public worker must stop before restore' unless guard < preserve_exit && preserve_exit < cleanup && cleanup < restore
raise 'Unknown worker containment may not restore DB' unless rollback.include?("if ! cleanup_backup_runtime; then\n      candidate_contained=0\n      rollback_failed=1")
raise 'Transient cleanup behavior must remain unchanged' unless new_functions.fetch('cleanup_transient') == old_functions.fetch('cleanup_transient')
raise 'Persistent backup ownership state must be created before resource mutation' unless cutover.index("\ninitialize_backup_runtime_state\n") < cutover.index('backup_runtime_started=1')
['os.O_NOFOLLOW', 'info.st_uid != uid or stat.S_IMODE(info.st_mode) != 0o700', 'os.mkdir(name, 0o700, dir_fd=release)', 'os.fsync(release)', 'os.fsync(state)'].each {|token| raise 'Persistent state ownership, no-adoption or durability gate missing' unless new_functions.fetch('initialize_backup_runtime_state').include?(token)}
raise 'Transient cleanup may not delete persistent ownership state' if new_functions.fetch('cleanup_transient').include?('backup_runtime_state') || new_functions.fetch('cleanup_backup_runtime').match?(/rm\s|unlink|rmdir/)
verify_source = File.read('.github/workflows/verify-arthello-v52.yml')
['ruby .github/scripts/check-recovery-r7-contract.rb','python3 -I .github/scripts/test-recovery-r7-gates.py','python3 -I .github/scripts/test-r7-backup-runtime.py'].each {|token| raise 'Hosted R7 guard test missing' unless verify_source.include?(token)}
verify_document = YAML.safe_load(verify_source, aliases: true)
verify_steps = verify_document.fetch('jobs').fetch('verify-v52').fetch('steps')
image_index = verify_steps.index {|step| step['id'] == 'image'}
fixture_index = verify_steps.index {|step| step['name'] == 'Verify isolated backup and activation volumes on the exact image'}
evidence_index = verify_steps.index {|step| step['name'] == 'Build immutable verification evidence'}
raise 'Real ordinary-UID Docker proof must precede immutable evidence' unless image_index && fixture_index && evidence_index && image_index < fixture_index && fixture_index < evidence_index
fixture = verify_steps.fetch(fixture_index)
raise 'Docker fixture must test exact candidate image' unless fixture.fetch('env').fetch('IMMUTABLE_IMAGE_ID') == '${{ steps.image.outputs.image_id }}'
raise 'Real worker/activation/controller Docker and writer UID proof missing' unless fixture.fetch('run').include?('scripts/test/arthello-backup-container-docker-smoke.sh "$IMMUTABLE_IMAGE_ID"') && fixture.fetch('run').include?('scripts/test/arthello-backup-runtime-docker-smoke.sh "$IMMUTABLE_IMAGE_ID"') && fixture.fetch('run').include?('/opt/arthello-backup/test_activation_volume.py')
puts 'ARTHELLO_D069_ORDINARY_BACKUP_CONTINUATION_CONTRACT=VERIFIED'
