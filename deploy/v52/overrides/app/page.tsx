import ArtHelloShell from "./components/ArtHelloShell";
import ProductionAuthGate from "./components/ProductionAuthGate";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <ProductionAuthGate>
      <ArtHelloShell displayName="Виталий Озолин" />
    </ProductionAuthGate>
  );
}
