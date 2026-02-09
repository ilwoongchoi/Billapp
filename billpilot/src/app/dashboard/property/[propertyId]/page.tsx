import Link from "next/link";
import { Suspense } from "react";

import { PropertyDetailWorkspace } from "@/components/dashboard/property-detail-workspace";

interface PropertyPageProps {
  params: Promise<{
    propertyId: string;
  }>;
}

export default async function PropertyPage({ params }: PropertyPageProps) {
  const { propertyId } = await params;

  return (
    <main className="min-h-screen bg-zinc-50 p-6 md:p-10">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <div className="space-y-2">
          <Link href="/dashboard" className="text-sm text-blue-600 underline">
            Back to dashboard
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">Property analytics</h1>
          <p className="text-zinc-700">
            Trend view, chart diagnostics, and export tools for one property.
          </p>
        </div>

        <Suspense fallback={<p className="text-sm text-zinc-600">Loading analytics...</p>}>
          <PropertyDetailWorkspace propertyId={propertyId} />
        </Suspense>
      </div>
    </main>
  );
}

