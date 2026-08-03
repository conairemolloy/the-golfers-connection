import { EmptyState } from "@/components/ui/empty-state";

export default function LapsedPage() {
  return (
    <main className="flex flex-1 flex-col px-6">
      <EmptyState heading="Membership lapsed">
        Your membership has lapsed. Get in touch to renew your standing in the network.
      </EmptyState>
    </main>
  );
}
