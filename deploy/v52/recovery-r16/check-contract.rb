require 'digest'
sources = {
  'deploy/v52/recovery-r16/verify-contract.py' => '029e08d750800734ee32ec022b4284aad62a8371b6011c9855aad51aeac27fc1',
  'deploy/v52/recovery-r16/source-pins.json' => 'd6f6b71b0cf5e8c64e43e3978d3cdba7b90528ab44b729a7f484d63f599e5448',
}
sources.each do |path, expected|
  raise 'Unreviewed R16 verification source' unless Digest::SHA256.file(path).hexdigest == expected
end
raise 'R16 source transformation failed' unless system('python3', '-I', '-B', 'deploy/v52/recovery-r16/verify-contract.py')
puts 'ARTHELLO_R16_SOURCE_CONTRACT=VERIFIED'
