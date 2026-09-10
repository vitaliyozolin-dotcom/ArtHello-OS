require 'digest'
sources = {
  'deploy/v52/recovery-r17/verify-contract.py' => '8fd069b47ee17e8d77e64f7985725979dce9037938c1c879dbbecb758062fa68',
  'deploy/v52/recovery-r17/source-pins.json' => '6f85aeee60209d8f617c9223356139b6bb2356d08257977d13dea1d8992dca7e',
}
sources.each do |path, expected|
  raise 'Unreviewed R17 verification source' unless Digest::SHA256.file(path).hexdigest == expected
end
raise 'R17 source transformation failed' unless system('python3', '-I', '-B', 'deploy/v52/recovery-r17/verify-contract.py')
puts 'ARTHELLO_R17_SOURCE_CONTRACT=VERIFIED'
