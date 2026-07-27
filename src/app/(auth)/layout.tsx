import Image from "next/image";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-muted p-4 sm:p-6 lg:p-8">
      {/* Soft warm backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -left-24 size-[520px] rounded-full bg-brand-tint blur-3xl dark:bg-primary/10"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -bottom-32 size-[520px] rounded-full bg-brand-tint blur-3xl dark:bg-primary/10"
      />

      {/* Floating split card */}
      <div className="relative grid w-full max-w-5xl overflow-hidden rounded-[28px] bg-card shadow-2xl ring-1 ring-black/5 lg:grid-cols-2 dark:ring-white/10">
        {/* Brand panel */}
        <div className="relative hidden min-h-[620px] flex-col justify-between overflow-hidden bg-sidebar p-10 lg:flex">
          {/* Stock backdrop image (decorative) with dark wash for legibility */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=1200&q=70"
            alt=""
            aria-hidden
            className="absolute inset-0 size-full object-cover opacity-25"
          />
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-b from-sidebar/70 via-sidebar/80 to-sidebar"
          />
          {/* Concentric rings */}
          <div
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-1/2 size-[440px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-1/2 size-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10"
          />

          <div className="relative flex items-center justify-between">
            <Image
              src="/avix-logo.png"
              alt="Avix Digital"
              width={150}
              height={38}
              priority
              className="brightness-0 invert"
            />
          </div>

          <div className="relative max-w-md">
            <h1 className="font-heading text-5xl leading-[1.05] font-bold text-white">
              Manage every
              <br />
              project.
            </h1>
            <p className="mt-5 max-w-sm text-sm leading-relaxed text-white/70">
              Track milestones in real time, review invoices, and request new
              work — your whole engagement with Avix Digital, in one place.
            </p>
          </div>

          <p className="relative text-xs text-white/50">
            © {new Date().getFullYear()} Avix Digital · avixdigital.com
          </p>
        </div>

        {/* Form panel */}
        <div className="flex flex-col justify-center bg-card px-6 py-12 sm:px-12">
          {/* Mobile logo (brand panel is hidden on small screens) */}
          <div className="mb-8 flex justify-center lg:hidden">
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
          <div className="mx-auto w-full max-w-sm">{children}</div>
        </div>
      </div>
    </div>
  );
}
