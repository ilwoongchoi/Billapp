import Link from "next/link";

export default function HomePage() {
  const peakguardUrl = process.env.NEXT_PUBLIC_PEAKGUARD_URL?.trim() || "";
  return (
    <main className="min-h-screen bg-gradient-to-b from-zinc-100 to-zinc-50 px-6 py-14">
      <div className="mx-auto max-w-4xl space-y-8 rounded-3xl border border-black/10 bg-white p-8 shadow-sm md:p-12">
        <span className="inline-flex rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide">
          BillPilot MVP
        </span>

        <h1 className="text-4xl font-bold tracking-tight">
          Utility bill analyzer with confidence checks and quota gates
        </h1>

        <p className="max-w-2xl text-zinc-700">
          Parse PDF/text bills, detect anomalies with residual metrics, and enforce a
          free-tier cap (2 analyses/month) for non-paying users.
        </p>

        <div className="grid gap-3 text-sm text-zinc-700 md:grid-cols-3">
          <div className="rounded-xl border border-zinc-200 p-4">
            <p className="font-semibold">Upload + Parse</p>
            <p className="mt-1">`/api/bills/upload`, `/api/bills/parse`</p>
          </div>
          <div className="rounded-xl border border-zinc-200 p-4">
            <p className="font-semibold">Insight Engine</p>
            <p className="mt-1">Anomaly + savings actions + residuals</p>
          </div>
          <div className="rounded-xl border border-zinc-200 p-4">
            <p className="font-semibold">Billing Gate</p>
            <p className="mt-1">Free plan limited to 2 analyses / month</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            href="/dashboard"
            className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white"
          >
            Open dashboard
          </Link>
          {peakguardUrl ? (
            <a
              href={peakguardUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
            >
              Open PeakGuard trial
            </a>
          ) : null}
          <a
            href="/api/health"
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold"
          >
            Health check
          </a>
        </div>

        <div className="flex flex-wrap gap-4 border-t border-zinc-200 pt-6 text-xs text-zinc-600">
          <Link href="/terms" className="underline">
            Terms
          </Link>
          <Link href="/privacy" className="underline">
            Privacy
          </Link>
        </div>
      </div>
    </main>
  );
}
