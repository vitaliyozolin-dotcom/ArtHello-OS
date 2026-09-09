require 'digest'

# The frozen chain remains authoritative for every existing R5-R12 gate.
frozen_contract = 'deploy/v52/recovery-r12/check-contract.rb'
raise 'Frozen R12 contract changed' unless Digest::SHA256.file(frozen_contract).hexdigest == '594e30bc2adfd993e61d87aead3c1564d363c517122b8f70a63b47d276eb4b9b'
load frozen_contract

R13_VERIFICATION_SOURCES = {
  'deploy/v52/recovery-r13/verify-contract.py' => '14b7b3a383483dab655ddb6d62c237182cf590460a5f941007de6a1807996499',
  'deploy/v52/recovery-r13/source-pins.json' => 'f6eee7aa2acae37b8870e038405369522eb0e660148beef29df44e341022a2ec',
}.freeze
R13_VERIFICATION_SOURCES.each do |path, expected|
  raise 'R13 verification pins remain nonpublishable' unless expected.match?(/\A[a-f0-9]{64}\z/)
  raise "Unreviewed R13 verification source: #{path}" unless Digest::SHA256.file(path).hexdigest == expected
end

raise 'R13 exact source transformation failed' unless system('python3', '-I', '-B', 'deploy/v52/recovery-r13/verify-contract.py')
puts 'ARTHELLO_R13_FROZEN_R12_AND_EXACT_CONTINUATION_CONTRACT=VERIFIED'
