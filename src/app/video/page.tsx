import type { Metadata } from "next";
import { Suspense } from "react";
import { VideoEditor } from "@/components/video/VideoEditor";

export const metadata: Metadata = { title: "Video Editor" };

export default function VideoPage() {
  return (
    <Suspense>
      <VideoEditor />
    </Suspense>
  );
}
