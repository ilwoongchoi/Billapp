import Link from "next/link";

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-14">
      <div className="mx-auto w-full max-w-3xl space-y-6 rounded-3xl border border-black/10 bg-white p-8 shadow-sm md:p-12">
        <div className="space-y-2">
          <Link href="/" className="text-sm text-blue-600 underline">
            Back to home
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">Terms of Service (MVP)</h1>
          <p className="text-sm text-zinc-600">
            Last updated: {new Date().toISOString().slice(0, 10)}
          </p>
        </div>

        <section className="space-y-3 text-sm text-zinc-700">
          <p>
            These terms are a lightweight MVP template. Review and customize for your business
            before broad production use.
          </p>

          <h2 className="text-base font-semibold">1) Service</h2>
          <p>
            BillPilot provides utility bill parsing, analytics, and reporting features. Outputs
            may contain errors and should be validated before making financial decisions.
          </p>

          <h2 className="text-base font-semibold">2) No warranties</h2>
          <p>
            The service is provided “as is” without warranties of any kind. You assume all risk
            from using the service.
          </p>

          <h2 className="text-base font-semibold">3) Limits of liability</h2>
          <p>
            To the maximum extent permitted by law, the operator is not liable for indirect,
            incidental, or consequential damages arising from use of the service.
          </p>

          <h2 className="text-base font-semibold">4) Acceptable use</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>No abuse, scraping, or denial-of-service behavior.</li>
            <li>No uploading content you don’t have the right to use.</li>
            <li>No attempts to bypass quota or billing controls.</li>
          </ul>

          <h2 className="text-base font-semibold">5) Billing</h2>
          <p>
            If billing is enabled, subscriptions are handled via Stripe. You can cancel anytime.
          </p>

          <h2 className="text-base font-semibold">6) Contact</h2>
          <p>
            For support, contact the site operator listed on the deployment landing page.
          </p>
        </section>
      </div>
    </main>
  );
}

