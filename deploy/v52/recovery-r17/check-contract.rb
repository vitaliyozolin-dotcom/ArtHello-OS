require 'digest'
sources = {
  'deploy/v52/recovery-r17/verify-contract.py' => '55b1e91d2fabcc22bdbcc9e5432de32a652e5de1b9ae2dcbd331e32b56d3c929',
  'deploy/v52/recovery-r17/source-pins.json' => '7d31057fb9dc21505e430143a0f50c5e093ca5f6b72c5b8e67d4ae66cbdd1fc1',
}
sources.each do |path, expected|
  raise 'Unreviewed R17 verification source' unless Digest::SHA256.file(path).hexdigest == expected
end
raise 'R17 source transformation failed' unless system('python3', '-I', '-B', 'deploy/v52/recovery-r17/verify-contract.py')
puts 'ARTHELLO_R17_SOURCE_CONTRACT=VERIFIED'
