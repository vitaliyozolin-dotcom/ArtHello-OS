require 'digest'
sources = {
  'deploy/v52/recovery-r17/verify-contract.py' => 'f0cf6be9ffc83a4ceb25dd494aac68879e3fec4ab0a48d8a5a7e9b0e716ab4a6',
  'deploy/v52/recovery-r17/source-pins.json' => '5620dc4ab67fe3422e92a31fdf9cc7d7ecaef5ef5ba3ac9a3447a620c1e56545',
}
sources.each do |path, expected|
  raise 'Unreviewed R17 verification source' unless Digest::SHA256.file(path).hexdigest == expected
end
raise 'R17 source transformation failed' unless system('python3', '-I', '-B', 'deploy/v52/recovery-r17/verify-contract.py')
puts 'ARTHELLO_R17_SOURCE_CONTRACT=VERIFIED'
