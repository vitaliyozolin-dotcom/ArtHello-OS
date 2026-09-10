require 'digest'
sources = {
  'deploy/v52/recovery-r17/verify-contract.py' => '51c57117161533a8f7ba85247f43dd706fd7ece17987946958e50688a4d13e01',
  'deploy/v52/recovery-r17/source-pins.json' => '5ab3fae130f72b3ff9350973658887bff956cbca74c9241e5c9b75c3f0da9fb2',
}
sources.each do |path, expected|
  raise 'Unreviewed R17 verification source' unless Digest::SHA256.file(path).hexdigest == expected
end
raise 'R17 source transformation failed' unless system('python3', '-I', '-B', 'deploy/v52/recovery-r17/verify-contract.py')
puts 'ARTHELLO_R17_SOURCE_CONTRACT=VERIFIED'
