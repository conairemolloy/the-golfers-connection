"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { getCurrentMember, requireMember } from "@/lib/auth";
import { createRequest, RequestError } from "@/lib/requests";

export async function createRequestAction(formData: FormData): Promise<void> {
  const member = requireMember(await getCurrentMember());
  const partySize = Number(formData.get("partySize"));
  const optional = (name: string): string | undefined => {
    const value = String(formData.get(name) ?? "").trim();
    return value || undefined;
  };

  try {
    await db.transaction((tx) =>
      createRequest(tx, member.userId, {
        region: String(formData.get("region") ?? "").trim(),
        dateFrom: String(formData.get("dateFrom") ?? ""),
        dateTo: String(formData.get("dateTo") ?? ""),
        partySize,
        handicaps: optional("handicaps"),
        flexibility: optional("flexibility"),
        note: optional("note"),
        pacePreference: optional("pacePreference") as "brisk" | "steady" | "no_preference" | undefined,
        targetClubIds: formData.getAll("targetClubId").map(String),
      }),
    );
  } catch (error) {
    if (error instanceof RequestError) {
      redirect(`/?requestError=${encodeURIComponent(error.code)}`);
    }
    throw error;
  }

  revalidatePath("/");
  redirect("/?requestCreated=1");
}
