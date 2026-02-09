import Link from "next/link";
import { Suspense } from "react";

import { ReceptionWorkspace } from "@/components/dashboard/reception-workspace";

export default function ReceptionDashboardPage() {
  return (
    <main className="min-h-screen bg-zinc-50 p-6 md:p-10">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <div className="space-y-2">
          <Link href="/dashboard" className="text-sm text-blue-600 underline">
            Back to dashboard
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">AI Receptionist Console</h1>
          <p className="text-zinc-700">
            Lead pipeline, upcoming bookings, and drift metrics for your SMS/voice
            receptionist workflow.
          </p>
        </div>

        <Suspense fallback={<p className="text-sm text-zinc-600">Loading console...</p>}>
          <ReceptionWorkspace />
        </Suspense>
      </div>
    </main>
  );
}
