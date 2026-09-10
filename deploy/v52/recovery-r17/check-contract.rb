require 'digest'
sources = {
  'deploy/v52/recovery-r17/verify-contract.py' => '2823a108065a4ae2ccd6c1a5db2fb628369b13cbf4de84a20e1c0df45d793d2c',
  'deploy/v52/recovery-r17/source-pins.json' => 'c51cf6bb2415ad1dbd17816ec13c7b4c55ae8a005b6ac57fa53a4da8e283f96e',
}
sources.each do |path, expected|
  raise 'Unreviewed R17 verification source' unless Digest::SHA256.file(path).hexdigest == expected
end
raise 'R17 source transformation failed' unless system('python3', '-I', '-B', 'deploy/v52/recovery-r17/verify-contract.py')
puts 'ARTHELLO_R17_SOURCE_CONTRACT=VERIFIED'
