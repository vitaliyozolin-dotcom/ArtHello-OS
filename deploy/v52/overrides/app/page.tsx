import ArtHelloShell from "./components/ArtHelloShell";
import { ContextualHelpSystem } from "./components/ContextualHelpSystem";
import ProductionAuthGate from "./components/ProductionAuthGate";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <ProductionAuthGate>
      <ArtHelloShell displayName="Виталий Озолин" />
      <ContextualHelpSystem />
    </ProductionAuthGate>
  );
}
