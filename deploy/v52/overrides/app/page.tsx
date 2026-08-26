import AuthenticatedArtHelloShell from "./components/AuthenticatedArtHelloShell";
import { ContextualHelpSystem } from "./components/ContextualHelpSystem";
import ProductionAuthGate from "./components/ProductionAuthGate";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <ProductionAuthGate>
      <AuthenticatedArtHelloShell />
      <ContextualHelpSystem />
    </ProductionAuthGate>
  );
}
