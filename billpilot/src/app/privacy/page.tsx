import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-14">
      <div className="mx-auto w-full max-w-3xl space-y-6 rounded-3xl border border-black/10 bg-white p-8 shadow-sm md:p-12">
        <div className="space-y-2">
          <Link href="/" className="text-sm text-blue-600 underline">
            Back to home
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
          <p className="text-sm text-zinc-600">
            Last updated: 2026-02-09
          </p>
        </div>

        <section className="space-y-3 text-sm text-zinc-700">
          <p>
            This is a lightweight privacy policy for the BillPilot MVP. It is a template and
            should be reviewed for your business and jurisdiction before production launch.
          </p>

          <h2 className="text-base font-semibold">What we collect</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>Account identifiers (email) for sign-in.</li>
            <li>
              Utility bill inputs you submit (text, extracted PDF text, and/or bill metadata),
              if you choose to persist them to a property.
            </li>
            <li>
              Usage analytics and operational logs (event IDs, timestamps, and minimal diagnostics).
            </li>
            <li>
              Payment status and subscription metadata when billing is enabled (handled by Stripe).
            </li>
          </ul>

          <h2 className="text-base font-semibold">How we use data</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>Provide bill parsing, anomaly insights, and reports.</li>
            <li>Enforce quota limits and prevent abuse.</li>
            <li>Improve reliability and troubleshoot issues.</li>
          </ul>

          <h2 className="text-base font-semibold">Where data is stored</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>Application data is stored in Supabase (Postgres + optional file storage bucket).</li>
            <li>Payments are processed by Stripe; we do not store full card numbers.</li>
            <li>Email delivery (monthly reports) may use Resend when enabled.</li>
            <li>SMS/voice automation may use Twilio when enabled.</li>
          </ul>

          <h2 className="text-base font-semibold">Data retention & deletion</h2>
          <p>
            You can request deletion of your account data. In an MVP, deletion may be manual.
          </p>

          <h2 className="text-base font-semibold">Contact</h2>
          <p>
            For privacy requests, contact us at{" "}
            <a href="mailto:support@billpilot.app" className="text-blue-600 underline">support@billpilot.app</a>.
          </p>
        </section>
      </div>
    </main>
  );
}

