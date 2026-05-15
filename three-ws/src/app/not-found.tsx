import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <p className="font-display text-3xl tracking-widest text-neon">404</p>
      <h1 className="mt-2 font-display text-5xl">nothing here.</h1>
      <Link href="/" className="btn-ghost mt-8">
        ← BACK HOME
      </Link>
    </main>
  );
}
