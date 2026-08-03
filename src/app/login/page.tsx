import { sendMagicLinkAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { PaperCard } from "@/components/ui/paper-card";

const ERROR_MESSAGES: Record<string, string> = {
  validation_failed: "Enter a valid email address.",
  rate_limited: "Too many requests. Try again in a few minutes.",
  send_failed: "Something went wrong sending the link. Try again.",
  no_profile: "We couldn't find your account.",
  removed: "This account is no longer active.",
  auth_failed: "That link didn't work. Request a new one below.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const params = await searchParams;
  const sent = params.sent === "1";
  const errorMessage = params.error ? (ERROR_MESSAGES[params.error] ?? "Something went wrong. Try again.") : null;

  return (
    <main className="flex flex-1 flex-col justify-center px-6 py-12">
      <PaperCard>
        <h1 className="font-serif text-3xl font-medium text-ink">Sign in</h1>
        {sent ? (
          <p className="mt-4 font-sans text-sm text-ink/70">Check your email for a link to sign in.</p>
        ) : (
          <form action={sendMagicLinkAction} className="mt-6 flex flex-col gap-6">
            {errorMessage && (
              <p role="alert" className="font-sans text-sm text-debit">
                {errorMessage}
              </p>
            )}
            <Field label="Email" tone="paper" type="email" name="email" required autoComplete="email" />
            <Button type="submit">Send magic link</Button>
          </form>
        )}
      </PaperCard>
    </main>
  );
}
