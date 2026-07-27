import Image from "next/image";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-screen w-full lg:grid-cols-2">
      {/* Brand panel — full height */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-10 lg:flex xl:p-14">
        {/* Stock backdrop image (decorative), very subtle behind a layered wash. */}
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
        {/* Warm brand glow */}
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-28 -left-20 size-96 rounded-full bg-primary/20 blur-3xl"
        />
        {/* Concentric rings */}
        <div
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-1/2 size-[620px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.07]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-1/2 size-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.07]"
        />

        <div className="relative">
          <Image
            src="/avix-logo.png"
            alt="Avix Digital"
            width={160}
            height={40}
            priority
            className="brightness-0 invert"
          />
        </div>

        <div className="relative max-w-md">
          <h1 className="font-heading text-5xl leading-[1.05] font-bold text-white xl:text-6xl">
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

      {/* Form panel — full height */}
      <div className="relative flex min-h-screen flex-col justify-center bg-card px-6 py-12 sm:px-10 lg:min-h-0 lg:px-16 xl:px-24">
        {/* Mobile logo (brand panel is hidden on small screens) */}
        <div className="mb-10 flex justify-center lg:hidden">
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
  );
}
