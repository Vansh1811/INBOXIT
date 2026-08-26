/**
 * CANONICAL CATEGORY CONTRACT (frontend mirror of
 * server/src/services/categories.js — keep both in sync).
 *
 * Every email has exactly ONE primary `category` from this vocabulary.
 */

export const CATEGORIES = [
  "uncategorized",
  "jobs",
  "social",
  "finance",
  "travel",
  "food",
  "shopping",
  "health",
  "education",
  "newsletters",
  "personal",
  "promotions",
  "updates",
] as const;

export type Category = (typeof CATEGORIES)[number];

export interface CategoryMeta {
  label: string;
  icon: string;
}

export const CAT: Record<string, CategoryMeta> = {
  uncategorized: { label: "Inbox",       icon: "Inbox" },
  jobs:          { label: "Jobs",        icon: "Briefcase" },
  social:        { label: "Social",      icon: "Bell" },
  finance:       { label: "Finance",     icon: "CreditCard" },
  travel:        { label: "Travel",      icon: "Plane" },
  food:          { label: "Food",        icon: "Pizza" },
  shopping:      { label: "Shopping",    icon: "ShoppingBag" },
  health:        { label: "Health",      icon: "Pill" },
  education:     { label: "Education",   icon: "GraduationCap" },
  newsletters:   { label: "Newsletters", icon: "Newspaper" },
  personal:      { label: "Personal",    icon: "User" },
  promotions:    { label: "Promotions",  icon: "Tag" },
  updates:       { label: "Updates",     icon: "Activity" },
};

/** Pseudo-folders that are state queries rather than categories. */
export const SPECIAL_FOLDERS: Record<string, CategoryMeta> = {
  inbox:   { label: "Inbox",   icon: "Inbox" },
  pinned:  { label: "Pinned",  icon: "Pin" },
  unread:  { label: "Unread",  icon: "Mail" },
  archive: { label: "Archive", icon: "Archive" },
  trash:   { label: "Trash",   icon: "Trash2" },
};

/** Icon name for any folder slug (special folders take precedence). */
export function folderIcon(slug: string): string {
  return SPECIAL_FOLDERS[slug]?.icon ?? CAT[slug]?.icon ?? "Inbox";
}

export function formatTime(dateStr: string | Date): string {
  const date = new Date(dateStr);
  const now   = new Date();
  const diff  = Math.floor((now.getTime() - date.getTime()) / 86400000);
  if (diff < 1) return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function senderName(from: string) {
  return from.split("<")[0].replace(/"/g, "").trim();
}

export function senderInitial(from: string) {
  return (senderName(from)[0] ?? "?").toUpperCase();
}

export function senderEmail(from: string) {
  return from.match(/<(.+)>/)?.[1] ?? from;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
