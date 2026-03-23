"use client";

import { useParams } from "next/navigation";
import EmailList from "@/components/EmailList";

export default function FolderPage() {
  const params = useParams();
  const raw = params.folder as string | undefined;

  // default to inbox if nothing / weird slug
  const folder = raw && typeof raw === "string" ? raw : "inbox";

  return <EmailList folder={folder} />;
}
