import Image from "next/image";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const year = new Date().getFullYear();

  return (
    // Full-bleed: the split fills the entire viewport (100vw × 100vh).
    <div className="relative min-h-screen w-full overflow-hidden bg-[#f4f1ee] dark:bg-background">
      {/* Warm ambient glows on the light side */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 right-0 size-[560px] rounded-full bg-brand-tint/70 blur-3xl dark:bg-primary/10"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-40 right-1/4 size-[520px] rounded-full bg-brand-tint/60 blur-3xl dark:bg-primary/10"
      />

      {/* Dark brand panel — flush to the top/left/bottom edges, rounded on the
          inner side so the shape still reads as a soft card. */}
      <div className="absolute inset-y-0 left-0 hidden w-[58%] overflow-hidden rounded-r-[40px] bg-sidebar lg:block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=1400&q=70"
          alt=""
          aria-hidden
          className="absolute inset-0 size-full object-cover opacity-[0.12]"
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-br from-sidebar/85 via-sidebar/90 to-sidebar"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-24 size-[420px] rounded-full bg-primary/20 blur-3xl"
        />
        {/* Concentric rings */}
        <div
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-[38%] size-[680px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.06]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-[38%] size-[460px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.06]"
        />

        {/* Panel content */}
        <div className="relative flex h-full flex-col justify-between p-12 xl:p-16">
          <Image
            src="/avix-logo.png"
            alt="Avix Digital"
            width={160}
            height={40}
            priority
            className="brightness-0 invert"
          />

          <div className="max-w-md">
            <h1 className="font-heading text-5xl leading-[1.03] font-bold text-white xl:text-6xl">
              Manage
              <br />
              every project
            </h1>
            <p className="mt-6 max-w-sm text-sm leading-relaxed text-white/70">
              Track milestones in real time, review invoices, and request new
              work — your whole engagement with Avix Digital, in one place.
            </p>
          </div>

          <p className="text-xs text-white/45">
            © {year} Avix Digital · avixdigital.com
          </p>
        </div>
      </div>

      {/* Floating form card — overlaps the dark panel's edge and hovers above
          the page with a deep shadow. */}
      <div className="relative flex min-h-screen items-center justify-center px-4 py-8 sm:px-6 lg:justify-end lg:px-[6vw]">
        <div className="flex w-full max-w-[520px] flex-col rounded-[32px] bg-card px-7 py-9 shadow-[0_30px_80px_-20px_rgba(15,23,42,0.35)] ring-1 ring-black/[0.06] sm:px-11 lg:min-h-[82vh] lg:py-11 dark:ring-white/10">
          {/* Top bar: mobile logo (dark panel hidden) + access link */}
          <div className="flex items-center justify-between">
            <div className="lg:hidden">
              <div className="rounded-xl bg-sidebar px-4 py-2.5">
                <Image
                  src="/avix-logo.png"
                  alt="Avix Digital"
                  width={104}
                  height={26}
                  priority
                  className="brightness-0 invert"
                />
              </div>
            </div>
            <a
              href="mailto:avixdigitalagency@gmail.com"
              className="ml-auto text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Need access?
            </a>
          </div>

          {/* Form, centered in the remaining height */}
          <div className="flex flex-1 flex-col justify-center py-10">
            <div className="mx-auto w-full max-w-sm">{children}</div>
          </div>

          <p className="text-xs text-muted-foreground">
            © {year} Avix Digital
          </p>
        </div>
      </div>
    </div>
  );
}
