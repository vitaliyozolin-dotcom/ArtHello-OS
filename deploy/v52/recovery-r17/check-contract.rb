require 'digest'
sources = {
  'deploy/v52/recovery-r17/verify-contract.py' => '1956a7379380bda6de2635cd634de936d1bf3ff1b960901421c77ac4df995a58',
  'deploy/v52/recovery-r17/source-pins.json' => 'de0a752ece4dd4464b321ed042b288437f23e1c3d91ace9b9a5b50e69eead905',
}
sources.each do |path, expected|
  raise 'Unreviewed R17 verification source' unless Digest::SHA256.file(path).hexdigest == expected
end
raise 'R17 source transformation failed' unless system('python3', '-I', '-B', 'deploy/v52/recovery-r17/verify-contract.py')
puts 'ARTHELLO_R17_SOURCE_CONTRACT=VERIFIED'
