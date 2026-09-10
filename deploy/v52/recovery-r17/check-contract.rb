require 'digest'
sources = {
  'deploy/v52/recovery-r17/verify-contract.py' => 'e135538864e9b96a35e25f9524e7b31160d83b60109e4013a3ce2f560cab6c87',
  'deploy/v52/recovery-r17/source-pins.json' => '6a6ef6fccafe4dd124d98b9c922a710949a3748e174d9a8fae88739b168a85a0',
}
sources.each do |path, expected|
  raise 'Unreviewed R17 verification source' unless Digest::SHA256.file(path).hexdigest == expected
end
raise 'R17 source transformation failed' unless system('python3', '-I', '-B', 'deploy/v52/recovery-r17/verify-contract.py')
puts 'ARTHELLO_R17_SOURCE_CONTRACT=VERIFIED'
