require 'digest'
sources = {
  'deploy/v52/recovery-r17/verify-contract.py' => '5c6b7a99d24035ed085186197426d1cf749e13e5547a0232041b85ffa1bd407d',
  'deploy/v52/recovery-r17/source-pins.json' => 'a52d975309737cf90e278198568f026e0e4eef066984e4426bcd9cf83bb669ac',
}
sources.each do |path, expected|
  raise 'Unreviewed R17 verification source' unless Digest::SHA256.file(path).hexdigest == expected
end
raise 'R17 source transformation failed' unless system('python3', '-I', '-B', 'deploy/v52/recovery-r17/verify-contract.py')
puts 'ARTHELLO_R17_SOURCE_CONTRACT=VERIFIED'
