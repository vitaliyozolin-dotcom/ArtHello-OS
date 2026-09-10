require 'digest'
sources = {
  'deploy/v52/recovery-r17/verify-contract.py' => 'af8872422952909b8f82ae02268e03a1daa0aac31008ab38c197c4361f68a1e7',
  'deploy/v52/recovery-r17/source-pins.json' => '0e80414a6b4c771d14da0bac63aaa8b31bb723d47e684d27884c2ff020245a8e',
}
sources.each do |path, expected|
  raise 'Unreviewed R17 verification source' unless Digest::SHA256.file(path).hexdigest == expected
end
raise 'R17 source transformation failed' unless system('python3', '-I', '-B', 'deploy/v52/recovery-r17/verify-contract.py')
puts 'ARTHELLO_R17_SOURCE_CONTRACT=VERIFIED'
