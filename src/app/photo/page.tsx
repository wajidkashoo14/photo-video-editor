import type { Metadata } from "next";
import { Suspense } from "react";
import { PhotoEditor } from "@/components/photo/PhotoEditor";

export const metadata: Metadata = { title: "Photo Editor" };

export default function PhotoPage() {
  return (
    <Suspense>
      <PhotoEditor />
    </Suspense>
  );
}
