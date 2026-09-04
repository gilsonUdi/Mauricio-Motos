import { NextResponse } from "next/server";
import { authEnabled, getSessionUser } from "@/lib/auth";
export async function GET() { if (!authEnabled()) return NextResponse.json({ enabled: false }); const user = await getSessionUser(); return user ? NextResponse.json({ enabled: true, user }) : NextResponse.json({ enabled: true, user: null }, { status: 401 }); }
