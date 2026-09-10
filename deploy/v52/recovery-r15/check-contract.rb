require 'digest'
sources = {
  'deploy/v52/recovery-r15/verify-contract.py' => '73e36904faf861c2ed2909e300b3a0c1af7844bc9d55c7534c73211c8606ab93',
  'deploy/v52/recovery-r15/source-pins.json' => '4564708ee3990f1d206b6a1646a89f4157dd1167e0de67928167815b7edce8c2',
}
sources.each do |path, expected|
  raise 'Unreviewed R15 verification source' unless Digest::SHA256.file(path).hexdigest == expected
end
raise 'R15 source transformation failed' unless system('python3', '-I', '-B', 'deploy/v52/recovery-r15/verify-contract.py')
puts 'ARTHELLO_R15_SOURCE_CONTRACT=VERIFIED'
