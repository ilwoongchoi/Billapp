import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-zinc-100 to-zinc-50 px-6 py-14">
      <div className="mx-auto max-w-4xl space-y-10">
        <nav className="flex items-center justify-between">
          <span className="text-lg font-bold tracking-tight">BillPilot</span>
          <Link
            href="/dashboard"
            className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white"
          >
            Sign in
          </Link>
        </nav>

        <section className="space-y-6 pt-8 text-center">
          <h1 className="text-4xl font-bold tracking-tight md:text-5xl">
            Stop overpaying on utility bills
          </h1>
          <p className="mx-auto max-w-2xl text-lg text-zinc-700">
            Upload your electricity, gas, or water bill and get an instant
            analysis. BillPilot detects overcharges, tracks your costs over
            time, and sends you monthly reports so nothing slips through.
          </p>
          <div className="flex justify-center gap-3">
            <Link
              href="/dashboard"
              className="rounded-lg bg-black px-6 py-3 text-sm font-semibold text-white"
            >
              Get started free
            </Link>
          </div>
          <p className="text-sm text-zinc-500">
            Free tier: 2 bill analyses per month. No credit card required.
          </p>
        </section>

        <section className="grid gap-4 pt-4 md:grid-cols-3">
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="mb-3 text-2xl">1</div>
            <p className="font-semibold">Upload your bill</p>
            <p className="mt-2 text-sm text-zinc-600">
              Paste bill text or upload a PDF. BillPilot reads the provider,
              billing period, usage, and total cost automatically.
            </p>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="mb-3 text-2xl">2</div>
            <p className="font-semibold">Get instant insights</p>
            <p className="mt-2 text-sm text-zinc-600">
              See anomalies, cost spikes, and savings opportunities highlighted
              with confidence scores you can trust.
            </p>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="mb-3 text-2xl">3</div>
            <p className="font-semibold">Track and save</p>
            <p className="mt-2 text-sm text-zinc-600">
              Monitor costs across properties over time. Get automated monthly
              reports delivered to your inbox.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-md rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Starter plan
          </p>
          <p className="mt-2 text-4xl font-bold">
            $9<span className="text-lg font-normal text-zinc-500">/month</span>
          </p>
          <ul className="mt-4 space-y-2 text-left text-sm text-zinc-700">
            <li className="flex items-start gap-2">
              <span className="mt-0.5 text-emerald-600">&#10003;</span>
              Unlimited bill analyses
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 text-emerald-600">&#10003;</span>
              Unlimited properties
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 text-emerald-600">&#10003;</span>
              Monthly PDF/CSV reports
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 text-emerald-600">&#10003;</span>
              Cost forecasting and trend analysis
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 text-emerald-600">&#10003;</span>
              Anomaly and overcharge detection
            </li>
          </ul>
          <Link
            href="/dashboard"
            className="mt-6 inline-block rounded-lg bg-black px-6 py-3 text-sm font-semibold text-white"
          >
            Start free, upgrade anytime
          </Link>
        </section>

        <footer className="flex flex-wrap justify-center gap-4 border-t border-zinc-200 pt-6 text-xs text-zinc-500">
          <Link href="/terms" className="underline">
            Terms
          </Link>
          <Link href="/privacy" className="underline">
            Privacy
          </Link>
        </footer>
      </div>
    </main>
  );
}
