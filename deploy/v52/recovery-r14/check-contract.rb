require 'digest'

# R12 and R13 contract suites are mandatory separate jobs in this exact hosted gate.
R14_VERIFICATION_SOURCES = {
  'deploy/v52/recovery-r14/verify-contract.py' => '39a1870f76923860495f1f41d7b48e49ade42a55d7b12b79d1f866c592a9a688',
  'deploy/v52/recovery-r14/source-pins.json' => '6101c7ed105a02e6a91bd1e646da715dbff1217a1cd4585cceea9f2ec1f212cb',
}.freeze
R14_VERIFICATION_SOURCES.each do |path, expected|
  raise "Unreviewed R14 verification source: #{path}" unless Digest::SHA256.file(path).hexdigest == expected
end
raise 'R14 exact source transformation failed' unless system('python3', '-I', '-B', 'deploy/v52/recovery-r14/verify-contract.py')
puts 'ARTHELLO_R14_EXACT_CONTINUATION_CONTRACT=VERIFIED'
