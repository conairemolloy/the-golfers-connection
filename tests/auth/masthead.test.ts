import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MastheadView } from "@/components/masthead";
import { fixtureCurrentMember } from "./harness";

// MastheadView is the pure half of src/components/masthead.tsx (see its
// file comment) — no cookies(), no DB, so it renders straight from a
// fixture CurrentMember the same way requireMember's own tests do,
// without needing a real Next.js request or a signed-in session.
describe("MastheadView", () => {
  it("renders the signed-in member's name and verified status", () => {
    const html = renderToStaticMarkup(
      createElement(MastheadView, { current: fixtureCurrentMember("member"), homeClubName: null }),
    );
    expect(html).toContain("Fixture Member");
    expect(html).toContain("Verified");
  });

  it("renders an applicant's status as applicant, not verified", () => {
    const html = renderToStaticMarkup(
      createElement(MastheadView, { current: fixtureCurrentMember("applicant"), homeClubName: null }),
    );
    expect(html).toContain("Applicant");
    expect(html).not.toContain("Verified");
  });

  it("shows nothing identifying when signed out", () => {
    const html = renderToStaticMarkup(createElement(MastheadView, { current: null, homeClubName: null }));
    expect(html).not.toContain("Verified");
    expect(html).not.toContain("Applicant");
  });
});
