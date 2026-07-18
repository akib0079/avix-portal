import { listConversations } from "@/lib/dal/messages";
import { requireTeam } from "@/lib/dal/session";
import { PageHeader } from "@/components/page-header";
import { AdminInbox } from "@/components/messages/admin-inbox";

export const metadata = { title: "Messages" };

export default async function AdminMessagesPage() {
  await requireTeam();
  const conversations = await listConversations();

  return (
    <div>
      <PageHeader
        title="Messages"
        description="Every client conversation — project threads and general chats."
      />
      <AdminInbox conversations={conversations} />
    </div>
  );
}
