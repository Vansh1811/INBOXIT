// client/lib/hooks/useEmails.ts
import useSWR from "swr";
import api from "@/lib/api";

export interface Email {
  _id: string;
  from: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  isRead: boolean;
  isStarred: boolean;
  category: string;
}

/** Phase 4 keyset-pagination contract. */
export interface PaginationMeta {
  hasMore: boolean;
  nextCursor: string | null;
  /** Present only on first-page responses; callers retain the last known value. */
  total: number | null;
}

interface CursorPageResponse {
  emails: Email[];
  pagination: PaginationMeta;
}

const fetcher = (url: string) => api.get(url).then((res) => res.data);

/**
 * Fetches ONE page for a given keyset cursor ("" = first page).
 *
 * Pure and side-effect free: page navigation state (the cursor stack) is owned
 * by the caller. Each distinct cursor gets its own SWR key, so revisiting a
 * previously visited page is an instant cache hit, and `keepPreviousData`
 * prevents a flash of empty content while a new page loads.
 */
export function useEmails(
  folder: string,
  cursor: string = "",
  search: string = "",
  limit: number = 50
) {
  const params = new URLSearchParams();
  params.set("folder", folder);
  params.set("limit", String(limit));
  if (cursor) params.set("cursor", cursor);
  if (search) params.set("search", search);

  const key = `/api/emails?${params.toString()}`;

  const { data, error, isLoading, mutate } = useSWR<CursorPageResponse>(key, fetcher, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  });

  return {
    emails: data?.emails || [],
    hasMore: data?.pagination?.hasMore ?? false,
    nextCursor: data?.pagination?.nextCursor ?? null,
    /** null when this page's payload carried no total — caller keeps previous. */
    freshTotal: data?.pagination?.total ?? null,
    isLoading,
    error,
    mutate,
    isFirstPage: !cursor,
  };
}
