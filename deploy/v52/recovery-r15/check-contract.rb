require 'digest'
sources = {
  'deploy/v52/recovery-r15/verify-contract.py' => 'c765982ab723c910c108907996d308c59d04ea752befd6df18a62720d6fc1805',
  'deploy/v52/recovery-r15/source-pins.json' => '6070d6944c441707a862a4ee0827165a5b0f11913e612913ecc98f79d10f2f34',
}
sources.each do |path, expected|
  raise 'Unreviewed R15 verification source' unless Digest::SHA256.file(path).hexdigest == expected
end
raise 'R15 source transformation failed' unless system('python3', '-I', '-B', 'deploy/v52/recovery-r15/verify-contract.py')
puts 'ARTHELLO_R15_SOURCE_CONTRACT=VERIFIED'
