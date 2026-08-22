import { listConversations } from "@/lib/dal/messages";
import { requireTeam } from "@/lib/dal/session";
import { AdminInbox } from "@/components/messages/admin-inbox";

export const metadata = { title: "Messages" };

export default async function AdminMessagesPage() {
  await requireTeam();
  const conversations = await listConversations();

  return (
    <div>
      {/* Compact on purpose: PageHeader's title, description and 2rem margin
          cost ~120px, and on a chat screen every pixel of chrome is a line of
          conversation you have to scroll for. */}
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="font-heading text-xl font-bold sm:text-2xl">Messages</h1>
        <p className="hidden text-sm text-muted-foreground sm:block">Every client conversation — project threads and general chats.</p>
      </div>
      <AdminInbox conversations={conversations} />
    </div>
  );
}
