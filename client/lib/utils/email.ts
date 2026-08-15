export const CAT: Record<string, { label: string; icon: string }> = {
  uncategorized: { label: "Inbox",       icon: "Inbox" },
  jobs:          { label: "Jobs",        icon: "Briefcase" },
  social:        { label: "Social",      icon: "Bell" },
  finance:       { label: "Finance",     icon: "CreditCard" },
  cabs:          { label: "Cabs",        icon: "Car" },
  travel:        { label: "Travel",      icon: "Plane" },
  food:          { label: "Food",        icon: "Pizza" },
  shopping:      { label: "Shopping",    icon: "ShoppingBag" },
  health:        { label: "Health",      icon: "Pill" },
  education:     { label: "Education",   icon: "GraduationCap" },
  newsletters:   { label: "Newsletters", icon: "Newspaper" },
  personal:      { label: "Personal",    icon: "User" },
  promotions:    { label: "Promotions",  icon: "Tag" },
};

export const FOLDER_ICONS: Record<string, string> = {
  inbox:       "Inbox",
  jobs:        "Briefcase",
  social:      "Bell",
  finance:     "CreditCard",
  cabs:        "Car",
  travel:      "Plane",
  food:        "Pizza",
  shopping:    "ShoppingBag",
  health:      "Pill",
  education:   "GraduationCap",
  newsletters: "Newspaper",
  personal:    "User",
  promotions:  "Tag",
};

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
