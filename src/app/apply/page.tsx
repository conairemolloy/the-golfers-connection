import { EmptyState } from "@/components/ui/empty-state";

export default function ApplyPage() {
  return (
    <main className="flex flex-1 flex-col px-6">
      <EmptyState heading="Application in progress">
        Your endorsements are being gathered. We&rsquo;ll be in touch once a decision is made.
      </EmptyState>
    </main>
  );
}
