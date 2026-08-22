import { listConversations } from "@/lib/dal/messages";
import { requireTeam } from "@/lib/dal/session";
import { AdminInbox } from "@/components/messages/admin-inbox";

export const metadata = { title: "Messages" };

export default async function AdminMessagesPage() {
  await requireTeam();
  const conversations = await listConversations();

  return (
    // -mx-4/-my-8 undoes the shell's mobile page padding, then puts a little
    // back. 64px of vertical gutter is right for a document and wrong for a
    // conversation. Desktop keeps the shell's spacing untouched.
    <div className="-mx-4 -my-8 px-2 py-3 sm:mx-0 sm:my-0 sm:px-0 sm:py-0">
      {/* Compact on purpose: PageHeader's title, description and 2rem margin
          cost ~120px, and on a chat screen every pixel of chrome is a line of
          conversation you have to scroll for. */}
      {/* Gone entirely on a phone. The thread header already names who you are
          talking to, so a second "Messages" heading is a line of chrome that
          says nothing the screen didn't already. */}
      <div className="mb-3 hidden flex-wrap items-baseline gap-x-3 gap-y-1 sm:flex">
        <h1 className="font-heading text-xl font-bold sm:text-2xl">Messages</h1>
        <p className="hidden text-sm text-muted-foreground sm:block">Every client conversation — project threads and general chats.</p>
      </div>
      <AdminInbox conversations={conversations} />
    </div>
  );
}
