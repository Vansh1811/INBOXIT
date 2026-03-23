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

export interface EmailsResponse {
  source: "cache" | "db";
  emails: Email[];
  totalCount: number; 
}

const fetcher = (url: string) => api.get(url).then((res) => res.data);

// 🔴 THE SHIFT: Replaced 'page' with 'offset'
export function useEmails(folder: string, offset: number = 0, search: string = "", limit: number = 50) {
  const params = new URLSearchParams();
  params.set("folder", folder);
  params.set("offset", String(offset)); // Pass offset to the backend
  params.set("limit", String(limit));
  if (search) params.set("search", search);

  const key = `/api/emails?${params.toString()}`;

  const { data, error, isLoading, mutate } = useSWR<EmailsResponse>(key, fetcher, {
    revalidateOnFocus: false,
    keepPreviousData: true, 
  });

  return {
    emails: data?.emails || [],
    totalCount: data?.totalCount || 0,
    isLoading,
    error,
    mutate,
  };
}