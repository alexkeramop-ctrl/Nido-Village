import { LoginForm } from "./login-form";
import { LogoCard } from "@/components/brand";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="min-h-full flex-1 flex items-center justify-center bg-dark p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <LogoCard />
          <p className="text-slate-300 text-sm mt-4">Πληκτρολόγησε το PIN σου</p>
        </div>
        <LoginForm next={next} />
      </div>
    </main>
  );
}
