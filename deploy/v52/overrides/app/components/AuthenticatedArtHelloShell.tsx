"use client";

import ArtHelloShell from "./ArtHelloShell";
import { useProductionAuthUser } from "./ProductionAuthGate";

export default function AuthenticatedArtHelloShell() {
  const user = useProductionAuthUser();
  const displayName = user?.name?.trim() || "Пользователь";

  return <ArtHelloShell displayName={displayName} />;
}
