import { requireClient } from "@/lib/dal/session";
import { listMyThreads, getThreadMessages } from "@/lib/dal/messages";
import { PageHeader } from "@/components/page-header";
import { ThreadSwitcher } from "@/components/messages/thread-switcher";

export const metadata = { title: "Messages" };

export default async function PortalMessagesPage() {
  const user = await requireClient();
  const [threads, generalMessages] = await Promise.all([
    listMyThreads(user.id),
    getThreadMessages({ clientId: user.id, projectId: null }),
  ]);

  return (
    <div>
      <PageHeader
        title="Messages"
        description="Chat directly with the Avix Digital team — about a project, or anything else."
      />
      <ThreadSwitcher
        generalUnread={threads.generalUnread}
        projects={threads.projects}
        initialMessages={generalMessages}
        initialProjectId={null}
      />
    </div>
  );
}
