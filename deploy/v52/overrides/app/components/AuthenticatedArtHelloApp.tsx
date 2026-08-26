"use client";

import ArtHelloShell from "./ArtHelloShell";
import { ContextualHelpSystem } from "./ContextualHelpSystem";
import { useProductionAuthUser } from "./ProductionAuthGate";

export default function AuthenticatedArtHelloApp() {
  const user = useProductionAuthUser();
  const displayName = user?.name?.trim() || "Пользователь";

  return (
    <>
      <ArtHelloShell displayName={displayName} />
      <ContextualHelpSystem />
    </>
  );
}
