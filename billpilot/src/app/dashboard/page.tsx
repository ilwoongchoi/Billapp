import Link from "next/link";
import { Suspense } from "react";

import { DashboardWorkspace } from "@/components/dashboard/dashboard-workspace";

export default function DashboardPage() {
  return (
    <main className="min-h-screen bg-zinc-50 p-6 md:p-10">
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <div className="space-y-2">
          <Link href="/" className="text-sm text-blue-600 underline">
            Back to home
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">BillPilot Dashboard</h1>
          <p className="text-zinc-700">
            Upload and analyze utility bills, track costs, and manage your subscription.
          </p>
        </div>

        <Suspense fallback={<p className="text-sm text-zinc-600">Loading dashboard...</p>}>
          <DashboardWorkspace />
        </Suspense>

        <footer className="flex flex-wrap gap-4 border-t border-zinc-200 pt-6 text-xs text-zinc-500">
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
