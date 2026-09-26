from pathlib import Path,PurePosixPath
import hashlib,zipfile,shutil,json
p=Path('input/school111-ios-keychain-fixed-source.zip')
assert hashlib.sha256(p.read_bytes()).hexdigest()=='db9adca2f847ac23dcef4ed2b4d31bdf46025adc55aba6332654a643fc4978bf'
with zipfile.ZipFile(p) as z:
 assert all(not PurePosixPath(n).is_absolute() and '..' not in PurePosixPath(n).parts for n in z.namelist())
 z.extractall('work')
shutil.move('work/school111-native','native-app');r=Path('native-app')
shutil.move(r/'proof',r/'prior-proof');(r/'proof').mkdir()
for n in ['check-build.mjs','check-build.test.mjs']:
 shutil.copy(Path('mobile/school111/build-stages')/n,r/'scripts'/n)
p=r/'package.json';d=json.loads(p.read_text());d['scripts']['eas-build-post-install']='npm run typecheck && npm test && node scripts/check-build.mjs';d['scripts']['check:build']='node scripts/check-build.mjs';d['scripts']['test:build']='node --test scripts/check-build.test.mjs';p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
p=r/'eas.json';d=json.loads(p.read_text());d['build']['testflight']={'extends':'production','distribution':'store'};d['submit']['testflight']={'ios':{}};p.write_text(json.dumps(d,indent=2)+'\n')
p=r/'app.config.js';s=p.read_text();old='const isStore = process.env.EAS_BUILD_PROFILE === "production";';assert s.count(old)==1;s=s.replace(old,'const isStore = ["production", "testflight"].includes(process.env.EAS_BUILD_PROFILE);');p.write_text(s)
# Runtime UI, authentication, server API and Keychain code remain unchanged.
(r/'proof/source-provenance.json').write_text(json.dumps({'baseRun':36268330034,'baseCommit':'2d18f6d8cb42c44a72f36f24880225ea5444625d','runtimeCodeChanged':False,'changes':'Separate signing preflight from public-release acceptance; add TestFlight store-distribution profile','target':'iPhoneOS unsigned archive','productionChanged':False},indent=2))
print('Verified source restored. Apple credentials are not requested by this archive job.')
