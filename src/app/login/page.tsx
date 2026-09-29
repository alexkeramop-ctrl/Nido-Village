import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="min-h-full flex-1 flex items-center justify-center bg-dark p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-brand flex items-center justify-center text-white text-2xl font-bold">N</div>
          <h1 className="text-white text-2xl font-bold mt-3">Nido Village</h1>
          <p className="text-slate-400 text-sm">Πληκτρολόγησε το PIN σου</p>
        </div>
        <LoginForm next={next} />
      </div>
    </main>
  );
}
