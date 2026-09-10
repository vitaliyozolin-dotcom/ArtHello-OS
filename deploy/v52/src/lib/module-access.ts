export {
  API_ROLES,
  accessibleModules,
  canAccessModule,
  isKnownApiRole,
  registryCapabilities,
  resolveModuleRoute,
} from "./access-policy.ts";

export type {
  AccessPolicyContext as ModuleAccessContext,
  ApiRole,
  RegistryAction,
  RegistryCapabilities,
} from "./access-policy.ts";
