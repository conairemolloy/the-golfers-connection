import { getCurrentMember } from "@/lib/auth";
import { EmptyState } from "@/components/ui/empty-state";

export default async function Home() {
  const current = await getCurrentMember();

  if (!current) {
    return (
      <main className="flex flex-1 flex-col px-6">
        <EmptyState heading="The Golfers’ Connection" action={{ href: "/login", label: "Sign in" }}>
          A private reciprocal access network for members of elite clubs in Ireland and Britain.
        </EmptyState>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col px-6">
      <EmptyState heading="The Book">Requests and offers open with the next milestone.</EmptyState>
    </main>
  );
}
