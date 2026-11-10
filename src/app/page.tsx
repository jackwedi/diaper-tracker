import ClientOnly from "@/components/ClientOnly";
import Tracker from "@/components/Tracker";
import { authEnabled } from "@/lib/auth";

export default function Home() {
  return (
    <ClientOnly fallback={<p className="muted" style={{ padding: 16 }}>Chargement…</p>}>
      <Tracker canLogout={authEnabled()} />
    </ClientOnly>
  );
}
