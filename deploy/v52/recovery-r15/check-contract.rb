require 'digest'
sources = {
  'deploy/v52/recovery-r15/verify-contract.py' => '332c34ef0c4ddbcc56f1af75257e3d3b3b0942d8bfc91f90f3ad01507ffee751',
  'deploy/v52/recovery-r15/source-pins.json' => 'c1b0a8fdfd4ea1c295983c9412759f4b09317c33181e3ac2ea08d30d86d071b7',
}
sources.each do |path, expected|
  raise 'Unreviewed R15 verification source' unless Digest::SHA256.file(path).hexdigest == expected
end
raise 'R15 source transformation failed' unless system('python3', '-I', '-B', 'deploy/v52/recovery-r15/verify-contract.py')
puts 'ARTHELLO_R15_SOURCE_CONTRACT=VERIFIED'
