require 'digest'
sources = {
  'deploy/v52/recovery-r17/verify-contract.py' => '2823a108065a4ae2ccd6c1a5db2fb628369b13cbf4de84a20e1c0df45d793d2c',
  'deploy/v52/recovery-r17/source-pins.json' => 'b23c6d45eeb3e84a964375980288f65d00d91b9a41cc6db9c43e7529e6580d68',
}
sources.each do |path, expected|
  raise 'Unreviewed R17 verification source' unless Digest::SHA256.file(path).hexdigest == expected
end
raise 'R17 source transformation failed' unless system('python3', '-I', '-B', 'deploy/v52/recovery-r17/verify-contract.py')
puts 'ARTHELLO_R17_SOURCE_CONTRACT=VERIFIED'
