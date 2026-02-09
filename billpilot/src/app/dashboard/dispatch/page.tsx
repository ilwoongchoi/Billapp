import Link from "next/link";
import { Suspense } from "react";

import { DispatchWorkspace } from "@/components/dashboard/dispatch-workspace";

export default function DispatchDashboardPage() {
  return (
    <main className="min-h-screen bg-zinc-50 p-6 md:p-10">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <div className="space-y-2">
          <Link href="/dashboard" className="text-sm text-blue-600 underline">
            Back to dashboard
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">Dispatch Optimizer Console</h1>
          <p className="text-zinc-700">
            Route + margin optimizer with κ-band drift checks, residual budgets, and
            falsifier logging.
          </p>
        </div>

        <Suspense fallback={<p className="text-sm text-zinc-600">Loading optimizer...</p>}>
          <DispatchWorkspace />
        </Suspense>
      </div>
    </main>
  );
}
