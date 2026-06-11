import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { and, eq, isNull, sql } from "drizzle-orm";
import { dbAs } from "@/db/client";
import {
  credentialDocuments,
  portfolioItems,
  profileAccessGrants,
  providerCredentials,
} from "@/db/schema";
import { getAuthUser } from "@/lib/auth/session";

/**
 * The logged signing path for OTHER PEOPLE'S private files (storage policies
 * only ever let owners through directly — see drizzle/supabase/0001_storage):
 *
 *   1. The caller's RLS view answers "may you see this document at all?" —
 *      credential docs and portfolio items are only selectable by the owner,
 *      an admin, or a member of an org holding an unrevoked grant.
 *   2. record_document_access() writes the audit row (definer fn, the only
 *      write path to document_access_logs).
 *   3. The service-role storage client issues a 5-minute signed URL.
 *
 * Providers viewing their OWN files keep using PrivateFileLink (their JWT
 * signs it; no third-party access, no log).
 */
export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  let body: { kind?: string; id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const kind = body.kind === "credential" || body.kind === "portfolio" ? body.kind : null;
  const id = typeof body.id === "string" && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : null;
  if (!kind || !id) return NextResponse.json({ error: "Bad request." }, { status: 400 });

  const file = await dbAs(user, async (tx) => {
    // RLS does the authorization: if the row comes back, the caller may see it.
    let providerProfileId: string;
    let storagePath: string;
    if (kind === "credential") {
      const [doc] = await tx
        .select({
          storagePath: credentialDocuments.storagePath,
          providerProfileId: providerCredentials.providerProfileId,
        })
        .from(credentialDocuments)
        .innerJoin(
          providerCredentials,
          eq(providerCredentials.id, credentialDocuments.providerCredentialId),
        )
        .where(eq(credentialDocuments.id, id));
      if (!doc) return null;
      providerProfileId = doc.providerProfileId;
      storagePath = doc.storagePath;
    } else {
      const [item] = await tx
        .select({
          storagePath: portfolioItems.storagePath,
          providerProfileId: portfolioItems.providerProfileId,
        })
        .from(portfolioItems)
        .where(eq(portfolioItems.id, id));
      if (!item) return null;
      providerProfileId = item.providerProfileId;
      storagePath = item.storagePath;
    }

    // Which of the caller's orgs holds the grant (for the log row). RLS
    // already scopes grants to the caller's own orgs + the provider's own.
    const [grant] = await tx
      .select({ organizationId: profileAccessGrants.organizationId })
      .from(profileAccessGrants)
      .where(
        and(
          eq(profileAccessGrants.providerProfileId, providerProfileId),
          isNull(profileAccessGrants.revokedAt),
        ),
      )
      .limit(1);

    await tx.execute(sql`
      select public.record_document_access(
        ${providerProfileId}::uuid, ${kind}, ${id}::uuid, 'signed_url_issued',
        ${grant?.organizationId ?? null}::uuid
      )
    `);
    return { storagePath };
  });
  if (!file) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json(
      { error: "Document viewing isn't configured on this server yet." },
      { status: 503 },
    );
  }
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const bucket = kind === "credential" ? "credentials" : "portfolios";
  const { data, error } = await admin.storage.from(bucket).createSignedUrl(file.storagePath, 300);
  if (error || !data?.signedUrl) {
    console.error("[files/sign]", error);
    return NextResponse.json({ error: "Couldn't open the file — try again." }, { status: 500 });
  }
  return NextResponse.json({ url: data.signedUrl });
}
