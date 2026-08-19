import { listTasks, listTaskTargets } from "@/lib/dal/tasks";
import { requireTeam } from "@/lib/dal/session";
import { serverNow } from "@/lib/server-now";
import { PageHeader } from "@/components/page-header";
import { TaskList } from "@/components/tasks/task-list";

export const metadata = { title: "Tasks" };

/**
 * The team's internal to-do list. Never rendered in the portal — Task exists
 * precisely to hold the work that isn't a client-facing milestone.
 */
export default async function TasksPage() {
  await requireTeam();
  const [tasks, targets] = await Promise.all([listTasks(), listTaskTargets()]);

  return (
    <div>
      <PageHeader
        title="Tasks"
        description="Everything that isn't a client milestone — yours to run the business from."
      />
      <TaskList tasks={tasks} targets={targets} now={serverNow()} />
    </div>
  );
}
