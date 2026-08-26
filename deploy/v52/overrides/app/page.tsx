import AuthenticatedArtHelloApp from "./components/AuthenticatedArtHelloApp";
import ProductionAuthGate from "./components/ProductionAuthGate";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <ProductionAuthGate>
      <AuthenticatedArtHelloApp />
    </ProductionAuthGate>
  );
}
