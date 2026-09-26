import path from "node:path";
import { fileURLToPath } from "node:url";
/** Signing prerequisites only. Real-device acceptance follows a signed build. */
export function checkBuild(env, profile = env.EAS_BUILD_PROFILE || "testflight") {
  if (["ios-simulator", "development"].includes(profile)) return {readyForSignedBuild:false,allowedToBuild:true,publicReleaseReady:false,profile,issues:[]};
  const issues=[];
  if (!["production","testflight"].includes(profile)) issues.push("UNKNOWN_BUILD_PROFILE");
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(env.EXPO_PROJECT_ID||"")) issues.push("EXPO_PROJECT_ID_UNVERIFIED");
  if (!env.EXPO_OWNER?.trim()) issues.push("EXPO_OWNER_UNVERIFIED");
  if (env.IOS_IDENTITY_VERIFIED!=="true"||!/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+){2,}$/.test(env.IOS_BUNDLE_IDENTIFIER||"")) issues.push("APPLE_BUNDLE_ID_UNVERIFIED");
  try {
    const u=new URL(env.EXPO_PUBLIC_API_ORIGIN||"");
    if(u.protocol!=="https:"||u.username||u.password||u.pathname!=="/"||u.search||u.hash||["localhost","127.0.0.1","[::1]","0.0.0.0"].includes(u.hostname)||u.hostname.endsWith(".invalid")||u.hostname.endsWith(".local"))throw new Error();
  } catch {issues.push("DISTRIBUTION_API_ORIGIN_UNVERIFIED");}
  return {readyForSignedBuild:issues.length===0,allowedToBuild:issues.length===0,publicReleaseReady:false,profile,issues};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const result=checkBuild(process.env,process.argv[2]||process.env.EAS_BUILD_PROFILE||"testflight");
 console.log(JSON.stringify(result,null,2));process.exitCode=result.allowedToBuild?0:2;
}
