import { NextResponse } from "next/server";
import { getSession } from "@/lib/dal/session";
import { prisma } from "@/lib/prisma";
import { getProjectMessages } from "@/lib/dal/messages";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session || session.user.status === "INACTIVE") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
  }

  const user = session.user;
  // Authorize: admins see any project; clients only their own.
  const project = await prisma.project.findFirst({
    where:
      user.role === "ADMIN" ? { id: projectId } : { id: projectId, clientId: user.id },
    select: { id: true },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const messages = await getProjectMessages(projectId);

  // Mark the incoming side as read for this viewer.
  const field = user.role === "ADMIN" ? "readByAdminAt" : "readByClientAt";
  await prisma.message.updateMany({
    where: { projectId, [field]: null },
    data: { [field]: new Date() },
  });

  return NextResponse.json({ messages });
}
