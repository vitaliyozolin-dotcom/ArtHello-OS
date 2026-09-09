require 'yaml'
require 'digest'

# D093 has separate inputs. None of the established D076/recovery bytes move.
{
  '.github/workflows/check-arthello-server-browser.yml' => '8a6e43bc0881d6c9756c476ec92713cddcfc281d769caa75233161343df77fd9',
  'deploy/browser/flow.mjs' => '0c81b139bece2693775654441d4e0b9a879f4b5e03d936785de59c6b90dc60b2',
  'deploy/browser/smoke.mjs' => '613b4b05e0d10c83d6d79aad26972766968ad8f899ac3d6b2dbcca185e933e3e',
  'scripts/test/server-browser.test.mjs' => '373e7c2e7f6c522fd16eda4a36eea94aad8de82a93f4aa04e2adcf69f3440a05',
  'deploy/browser/Dockerfile' => 'cb87599df8abafbc96a205a7d5f32d87c3316cc7c8b752f997b5dfb451a0346a'
}.each {|path, sha| raise "Canonical browser changed: #{path}" unless Digest::SHA256.hexdigest(File.binread(path)) == sha }

def workflow(path)
  value = YAML.safe_load(File.read(path), aliases: true)
  if value.key?(true)
    raise 'Ambiguous workflow trigger key' if value.key?('on')
    value['on'] = value.delete(true)
  end
  raise 'Missing workflow triggers' unless value['on'].is_a?(Hash)
  value
end
canonical = workflow('.github/workflows/check-arthello-server-browser.yml')
actual = workflow('.github/workflows/check-arthello-employee-controls.yml')
expected = Marshal.load(Marshal.dump(canonical))
expected['name'] = 'Verify and run ArtHello employee controls'
expected['on'].delete('workflow_dispatch')
expected['on']['pull_request']['paths'] = [
  'deploy/browser/**', 'scripts/run-server-browser.sh', 'scripts/test/employee-controls.test.mjs',
  'scripts/test/browser-proxy.test.mjs', 'scripts/test/retire-r12-browser.test.mjs',
  '.github/scripts/check-employee-controls-contract.rb', '.github/workflows/check-arthello-employee-controls.yml'
]
expected['concurrency']['group'] = "${{ github.event_name == 'pull_request' && format('employee-controls-pr-{0}', github.event.pull_request.number) || 'gateway-38-55-arthello-production' }}"
expected['env'] = {'CHECKED_SOURCE_SHA' => '${{ github.event.pull_request.head.sha || github.event.workflow_run.head_sha }}'}

bundle = expected['jobs']['bundle']
bundle['if'] = <<~CONDITION.split.join(' ')
  github.event_name == 'pull_request' || (
    github.repository == 'vitaliyozolin-dotcom/ArtHello-OS' &&
    github.actor == 'vitaliyozolin-dotcom' &&
    github.triggering_actor == 'vitaliyozolin-dotcom' && (
      (github.event_name == 'workflow_run' &&
       github.event.workflow_run.name == 'Quality gates' &&
       github.event.workflow_run.path == '.github/workflows/quality.yml' &&
       github.event.workflow_run.event == 'push' &&
       github.event.workflow_run.head_branch == 'main' &&
       github.event.workflow_run.conclusion == 'success' &&
       github.event.workflow_run.run_attempt == 1 &&
       github.event.workflow_run.repository.id == github.event.repository.id &&
       github.event.workflow_run.head_repository.id == github.event.repository.id &&
       startsWith(github.event.workflow_run.head_commit.message, 'D093: employee controls'))
    )
  )
CONDITION
actual['jobs']['bundle']['if'] = actual['jobs']['bundle']['if'].split.join(' ')
policy = bundle['steps'].find {|step| step['name'] == 'Test browser policy and install locked package off the VPS'}
policy['run'] = policy['run'].sub('node --test scripts/test/server-browser.test.mjs scripts/test/browser-proxy.test.mjs',
  "ruby .github/scripts/check-employee-controls-contract.rb\nnode --test scripts/test/employee-controls.test.mjs scripts/test/browser-proxy.test.mjs scripts/test/retire-r12-browser.test.mjs")
build = bundle['steps'].find {|step| step['id'] == 'bundle'}
build['run'] = build['run'].sub('-t "$tag" deploy/browser', '-f deploy/browser/Dockerfile.employee-controls -t "$tag" deploy/browser')

natural = expected['jobs']['natural-browser']
natural['if'] = natural['if'].sub("(github.event_name == 'workflow_run' || github.event_name == 'workflow_dispatch')", "github.event_name == 'workflow_run'")
steps = natural['steps']
steps.reject! {|step| step['name'] == 'Retire only the exact unused R8 browser image under D079'}
position = steps.index {|step| step['name'] == 'Measure import capacity before downloading the verified archive'}
steps.insert(position, {
  'name' => 'Retire only the exact unused accepted R12 browser image',
  'env' => {'GH_TOKEN' => '${{ github.token }}', 'ARCHIVE_BYTES' => '${{ needs.bundle.outputs.archive_bytes }}',
            'EXPANDED_BYTES' => '${{ needs.bundle.outputs.expanded_bytes }}'},
  'shell' => 'bash',
  'run' => "set -Eeuo pipefail\ntest \"$(git rev-parse HEAD)\" = \"$CHECKED_SOURCE_SHA\"\n\"$PRECHECK_NODE\" deploy/browser/retire-r12-browser.mjs\n"
})
run = steps.find {|step| step['name'] == 'Run dedicated employee natural login and diary navigation'}
run['name'] = 'Run employee feedback and backup-denial controls with natural School navigation'
run['run'] = run['run'].sub('scripts/test/server-browser.test.mjs', 'scripts/test/employee-controls.test.mjs')
raise 'D093 standalone authority, provenance or steps changed' unless actual == expected

dockerfile = File.read('deploy/browser/Dockerfile').sub(
  'COPY package.json pnpm-lock.yaml run.mjs flow.mjs smoke.mjs proxy.mjs ./',
  "COPY package.json pnpm-lock.yaml run.mjs proxy.mjs ./\nCOPY flow-employee-controls.mjs ./flow.mjs\nCOPY smoke-employee-controls.mjs ./smoke.mjs")
raise 'D093 browser image inputs widened' unless File.read('deploy/browser/Dockerfile.employee-controls') == dockerfile
ignore = "*\n!package.json\n!pnpm-lock.yaml\n!run.mjs\n!flow-employee-controls.mjs\n!smoke-employee-controls.mjs\n!proxy.mjs\n!node_modules\n!node_modules/**\n"
raise 'D093 build context inputs changed' unless File.read('deploy/browser/Dockerfile.employee-controls.dockerignore') == ignore
puts 'ARTHELLO_D093_STANDALONE_EMPLOYEE_CONTROLS_CONTRACT=VERIFIED'
