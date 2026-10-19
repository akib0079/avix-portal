"use client";

import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { ProjectStatus } from "@prisma/client";
import { setProjectStatus } from "@/lib/actions/projects";
import { projectStatusLabels } from "@/lib/format";
import { projectStatusColor } from "@/lib/status-colors";
import { useLocalSet } from "@/lib/use-local-pref";
import { Lane, LaneCard, LaneEmpty, LaneScroller } from "@/components/ui/lanes";
import { PersonAvatar, PriorityFlag, DueChip } from "@/components/board/board-bits";
import { ShowMore, useProgressive } from "@/components/ui/progressive";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Building2, KanbanSquare, LifeBuoy } from "lucide-react";
import type { ProjectListRow } from "./project-table";

const LANES: { status: ProjectStatus; hint: string }[] = [
  { status: "PLANNING", hint: "Scoped, not started" },
  { status: "IN_PROGRESS", hint: "Being built" },
  { status: "REVIEW", hint: "With the client" },
  { status: "COMPLETED", hint: "Delivered" },
];

/**
 * Projects by status, as the project board shows tasks: the same lanes, the
 * same cards, and for admins the same drag — drop a project on a lane and
 * that is its new status. Completed starts folded: it only ever grows, and
 * the live work is what this view is for.
 */
export function ProjectLanes({
  projects,
  canMove,
  today,
}: {
  projects: ProjectListRow[];
  /** Admins move projects; staff get a read-only board. */
  canMove: boolean;
  /** "YYYY-MM-DD" in the viewer's calendar, for the due chips. */
  today: string;
}) {
  const router = useRouter();
  const [folded, toggleFold] = useLocalSet("avix.projects.folded", ["COMPLETED"]);
  // Optimistic status overrides, keyed by project. Cleared when fresh rows arrive.
  const [moved, setMoved] = useState<Record<string, ProjectStatus>>({});
  const [prevProjects, setPrevProjects] = useState(projects);
  if (projects !== prevProjects) {
    setPrevProjects(projects);
    setMoved({});
  }
  const [activeId, setActiveId] = useState<string | null>(null);

  // Distance for the mouse, a long-press for touch: a swipe across the board
  // on a phone must scroll it, not pick a card up.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  const rows = projects.map((p) => (moved[p.id] ? { ...p, status: moved[p.id]! } : p));
  const active = rows.find((p) => p.id === activeId) ?? null;

  function onDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  async function onDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const target = event.over?.id as ProjectStatus | undefined;
    const project = rows.find((p) => p.id === event.active.id);
    if (!project || !target || project.status === target) return;
    if (!LANES.some((l) => l.status === target)) return;

    setMoved((m) => ({ ...m, [project.id]: target }));
    const result = await setProjectStatus(project.id, target);
    if (!result.ok) {
      setMoved((m) => {
        const next = { ...m };
        delete next[project.id];
        return next;
      });
      toast.error(result.error);
      return;
    }
    toast.success(`${project.projectName} → ${projectStatusLabels[target]}`);
    router.refresh();
  }

  const board = (
    <LaneScroller>
      {LANES.map((lane) => (
        <ProjectLane
          key={lane.status}
          status={lane.status}
          hint={lane.hint}
          projects={rows.filter((p) => p.status === lane.status)}
          folded={folded.has(lane.status)}
          onToggle={() => toggleFold(lane.status)}
          draggable={canMove}
          highlightSource={active?.status === lane.status}
          today={today}
        />
      ))}
    </LaneScroller>
  );

  if (!canMove) return board;

  return (
    <DndContext id="projects-board" sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
      {board}
      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" }}>
        {active ? <ProjectCardFace project={active} today={today} overlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function ProjectLane({
  status,
  hint,
  projects,
  folded,
  onToggle,
  draggable,
  highlightSource,
  today,
}: {
  status: ProjectStatus;
  hint: string;
  projects: ProjectListRow[];
  folded: boolean;
  onToggle: () => void;
  draggable: boolean;
  highlightSource: boolean;
  today: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status, disabled: !draggable });
  const page = useProgressive(projects, status, 24);

  return (
    <Lane
      color={projectStatusColor[status]}
      title={projectStatusLabels[status]}
      count={projects.length}
      hint={hint}
      collapsed={folded}
      onToggle={onToggle}
      bodyRef={setNodeRef}
      highlight={isOver || highlightSource}
      empty={
        projects.length === 0 ? (
          <LaneEmpty>{draggable ? "Drop a project here" : "Nothing here"}</LaneEmpty>
        ) : undefined
      }
    >
      {page.shown.map((p) =>
        draggable ? (
          <DraggableProject key={p.id} project={p} today={today} />
        ) : (
          <ProjectCardFace key={p.id} project={p} today={today} />
        ),
      )}
      <ShowMore remaining={page.remaining} step={page.step} onShowMore={page.showMore} />
    </Lane>
  );
}

function DraggableProject({ project, today }: { project: ProjectListRow; today: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: project.id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      // The card is a link; a long-press on iOS would otherwise open the
      // link preview instead of picking the card up.
      className="touch-manipulation rounded-xl outline-none [-webkit-touch-callout:none] focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      <ProjectCardFace project={project} today={today} ghost={isDragging} />
    </div>
  );
}

function ProjectCardFace({
  project,
  today,
  overlay,
  ghost,
}: {
  project: ProjectListRow;
  today: string;
  overlay?: boolean;
  ghost?: boolean;
}) {
  const percent =
    project.milestoneCount === 0
      ? 0
      : Math.round((project.milestonesDone / project.milestoneCount) * 100);
  const done = project.status === "COMPLETED";

  return (
    <div style={{ "--col": projectStatusColor[project.status] } as CSSProperties}>
      <LaneCard
        href={overlay ? undefined : `/admin/projects/${project.id}`}
        overlay={overlay}
        ghost={ghost}
      >
        {project.openHelp > 0 && (
          <span className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-red-500/12 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-red-600 uppercase dark:text-red-400">
            <LifeBuoy className="size-3" /> Client needs help
          </span>
        )}
        <p className="line-clamp-2 text-[13px] leading-snug font-semibold text-foreground [overflow-wrap:anywhere]">
          {project.projectName}
        </p>
        <p className="mt-1 flex items-center gap-1 truncate text-xs text-muted-foreground">
          <Building2 className="size-3 shrink-0" />
          <span className="truncate">{project.clientName ?? "No client"}</span>
          <span className="shrink-0 opacity-60">· {project.typeLabel}</span>
        </p>

        {/* Milestone progress */}
        <div className="mt-2.5 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-[var(--col)] transition-[width] duration-500"
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="text-[11px] font-medium text-muted-foreground tabular-nums">
            {project.milestonesDone}/{project.milestoneCount}
          </span>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <PriorityFlag priority={project.priority} withLabel />
          <DueChip day={project.dueDay} done={done} today={today} />
          {project.openTasks > 0 && (
            <span
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums"
              title={`${project.openTasks} open task${project.openTasks === 1 ? "" : "s"} on the board`}
            >
              <KanbanSquare className="size-3" />
              {project.openTasks}
            </span>
          )}
          <span className={cn("ml-auto", !project.owner && "opacity-70")}>
            <PersonAvatar
              person={project.owner ? { ...project.owner, role: "ADMIN" } : null}
              size={22}
            />
          </span>
        </div>
      </LaneCard>
    </div>
  );
}
