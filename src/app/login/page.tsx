import { sendMagicLinkAction } from "./actions";

// Plumbing, not the design pass — real styling comes with the first
// proper routes (CLAUDE.md's Design Tokens are for then).
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
    <main>
      <h1>Sign in</h1>
      {sent ? (
        <p>Check your email for a link to sign in.</p>
      ) : (
        <form action={sendMagicLinkAction}>
          {errorMessage && <p role="alert">{errorMessage}</p>}
          <label>
            Email
            <input type="email" name="email" required autoComplete="email" />
          </label>
          <button type="submit">Send magic link</button>
        </form>
      )}
    </main>
  );
}
