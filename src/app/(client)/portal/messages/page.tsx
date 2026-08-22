import { requireClient } from "@/lib/dal/session";
import { listMyThreads, getThreadMessages } from "@/lib/dal/messages";
import { ThreadSwitcher } from "@/components/messages/thread-switcher";

export const metadata = { title: "Messages" };

export default async function PortalMessagesPage() {
  const user = await requireClient();
  const [threads, generalPage] = await Promise.all([
    listMyThreads(user.id),
    getThreadMessages({ clientId: user.id, projectId: null }),
  ]);

  return (
    <div>
      {/* Compact on purpose: PageHeader's title, description and 2rem margin
          cost ~120px, and on a chat screen every pixel of chrome is a line of
          conversation you have to scroll for. */}
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="font-heading text-xl font-bold sm:text-2xl">Messages</h1>
        <p className="hidden text-sm text-muted-foreground sm:block">Chat directly with the Avix Digital team — about a project, or anything else.</p>
      </div>
      <ThreadSwitcher
        generalUnread={threads.generalUnread}
        projects={threads.projects}
        initialMessages={generalPage.messages}
        initialHasMore={generalPage.hasMore}
        initialProjectId={null}
      />
    </div>
  );
}
