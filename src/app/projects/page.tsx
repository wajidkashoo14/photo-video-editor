"use client";

import { Clapperboard, Image as ImageIcon } from "lucide-react";
import { useState } from "react";
import { Page } from "@/components/AppShell";
import { ProjectGrid, useNewProject } from "@/components/ProjectGrid";
import { Button, Tabs } from "@/components/ui";

type Filter = "all" | "photo" | "video" | "trash";

export default function ProjectsPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const create = useNewProject();
  return (
    <Page
      title="My Projects"
      subtitle="Projects are saved in this browser and reopen exactly where you left off."
      actions={
        <>
          <Button onClick={() => create("photo", "Untitled photo", 1920, 1080)}><ImageIcon size={14} /> New photo</Button>
          <Button variant="primary" onClick={() => create("video", "Untitled video", 1920, 1080, 30)}><Clapperboard size={14} /> New video</Button>
        </>
      }
    >
      <div className="mb-5 max-w-md">
        <Tabs<Filter> value={filter} onChange={setFilter} tabs={[{ value: "all", label: "All" }, { value: "photo", label: "Photos" }, { value: "video", label: "Videos" }, { value: "trash", label: "Trash" }]} />
      </div>
      <ProjectGrid key={filter} trashed={filter === "trash"} kind={filter === "photo" || filter === "video" ? filter : undefined} />
    </Page>
  );
}
