import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { healthCheck } from "@/db/schema";

export async function GET() {
  try {
    await db.insert(healthCheck).values({});
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(healthCheck);

    return NextResponse.json({ ok: true, db: "connected", rows: count });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
