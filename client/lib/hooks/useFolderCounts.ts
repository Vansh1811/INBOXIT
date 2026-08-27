import useSWR from "swr";
import api from "@/lib/api";

const fetcher = (url: string) => api.get(url).then((res) => res.data);

export function useFolderCounts() {
  const { data, error, isLoading, mutate } = useSWR<Record<string, number>>(
    "/api/emails/counts/unread",
    fetcher,
    {
      revalidateOnFocus: false,
    }
  );

  return {
    counts: data || {},
    isLoading,
    error,
    mutate,
  };
}
