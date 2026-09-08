import { NextResponse } from "next/server";

/**
 * Public agreement collection remains disabled until a secure signing flow
 * can authenticate the signer and bind the submitted agreement to that proof.
 */
export async function POST() {
  return NextResponse.json(
    { error: "Public agreement signing is unavailable" },
    { status: 503 }
  );
}
