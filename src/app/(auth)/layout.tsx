import Image from "next/image";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen w-full">
      {/* Brand panel */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-sidebar p-10 lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-40 -right-40 size-[480px] rounded-full bg-primary/15 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-52 -left-24 size-[420px] rounded-full bg-primary/10 blur-3xl"
        />
        <Image
          src="/avix-logo.png"
          alt="Avix Digital"
          width={160}
          height={40}
          priority
          className="relative brightness-0 invert"
        />
        <div className="relative max-w-md">
          <h1 className="font-heading text-4xl leading-tight font-bold text-white">
            Every project.
            <br />
            Every milestone.
            <br />
            <span className="text-primary">One portal.</span>
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-slate-400">
            Follow your project&apos;s progress in real time, review invoices,
            and request new work — all in one place.
          </p>
        </div>
        <p className="relative text-xs text-slate-500">
          © {new Date().getFullYear()} Avix Digital · avixdigital.com
        </p>
      </div>

      {/* Form panel */}
      <div className="flex w-full flex-col items-center justify-center bg-background px-6 py-12 lg:w-1/2">
        <div className="mb-8 flex w-full max-w-sm justify-center lg:hidden">
          <div className="rounded-xl bg-sidebar px-5 py-3">
            <Image
              src="/avix-logo.png"
              alt="Avix Digital"
              width={120}
              height={30}
              priority
              className="brightness-0 invert"
            />
          </div>
        </div>
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
