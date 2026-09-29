import { PartnerLoginForm } from "./form";
import { LogoCard } from "@/components/brand";

export const dynamic = "force-dynamic";

export default function PartnerLoginPage() {
  return (
    <main className="min-h-full flex-1 flex items-center justify-center bg-dark p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <LogoCard subtitle="Πίνακας συνεταίρων" />
        </div>
        <PartnerLoginForm />
      </div>
    </main>
  );
}
