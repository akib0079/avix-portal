"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Priority, ProjectStatus } from "@prisma/client";
import { ProjectRowActions } from "@/components/projects/project-row-actions";
import { ProjectStatusBadge, PriorityBadge } from "@/components/status-badges";
import { ShowMore, useProgressive } from "@/components/ui/progressive";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Search } from "lucide-react";

export type ProjectListRow = {
  id: string;
  projectName: string;
  sourceLabel: string;
  typeLabel: string;
  milestoneCount: number;
  clientName: string | null;
  priority: Priority;
  status: ProjectStatus;
};

const FILTERS = [
  { value: "all", label: "All" },
  { value: "live", label: "Live" },
  { value: "REVIEW", label: "In review" },
  { value: "COMPLETED", label: "Completed" },
] as const;

/**
 * The projects list. It had no search or filter, so finding one project meant
 * scrolling the whole agency history — and every row rendered up front. Now
 * both are instant over the loaded rows, and the DOM is paged.
 */
export function ProjectTable({
  projects,
  canDelete,
}: {
  projects: ProjectListRow[];
  canDelete: boolean;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["value"]>("all");

  const counts = useMemo(
    () => ({
      all: projects.length,
      live: projects.filter((p) => p.status !== "COMPLETED").length,
      REVIEW: projects.filter((p) => p.status === "REVIEW").length,
      COMPLETED: projects.filter((p) => p.status === "COMPLETED").length,
    }),
    [projects],
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return projects.filter((p) => {
      if (filter === "live" && p.status === "COMPLETED") return false;
      if ((filter === "REVIEW" || filter === "COMPLETED") && p.status !== filter) return false;
      if (!needle) return true;
      return `${p.projectName} ${p.clientName ?? ""} ${p.typeLabel}`
        .toLowerCase()
        .includes(needle);
    });
  }, [projects, search, filter]);

  const page = useProgressive(visible, `${filter}|${search}`);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search project, client or type"
            className="h-9 pl-8 text-sm"
          />
        </div>
        <div className="inline-flex rounded-lg border bg-card p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                filter === f.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
              <span className="ml-1 opacity-60 tabular-nums">{counts[f.value]}</span>
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Nothing matches those filters.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Project</TableHead>
              <TableHead className="hidden md:table-cell">Client</TableHead>
              <TableHead className="hidden sm:table-cell">Type</TableHead>
              <TableHead className="hidden lg:table-cell">Priority</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.shown.map((project) => (
              <TableRow key={project.id}>
                <TableCell>
                  <Link
                    href={`/admin/projects/${project.id}`}
                    className="font-medium hover:text-primary"
                  >
                    {project.projectName}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {project.sourceLabel} · {project.milestoneCount} milestones
                  </p>
                </TableCell>
                <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                  {project.clientName ?? "—"}
                </TableCell>
                <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                  {project.typeLabel}
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  <PriorityBadge priority={project.priority} />
                </TableCell>
                <TableCell>
                  <ProjectStatusBadge status={project.status} />
                </TableCell>
                <TableCell>
                  <ProjectRowActions
                    project={{ id: project.id, projectName: project.projectName }}
                    canDelete={canDelete}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <ShowMore remaining={page.remaining} step={page.step} onShowMore={page.showMore} />
    </div>
  );
}
