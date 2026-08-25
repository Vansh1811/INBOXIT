import SearchBar from "@/components/SearchBar";
import {
  ChevronLeft, ChevronRight
} from "lucide-react";

interface EmailListHeaderProps {
  folder: string;
  safeTotalCount: number;
  startCount: number;
  endCount: number;
  isSyncingMore: boolean;
  isLoading: boolean;
  offset: number;
  setSearchQuery: (query: string) => void;
  handlePrevPage: () => void;
  handleNextPage: () => void;
}

export default function EmailListHeader({
  folder,
  safeTotalCount,
  startCount,
  endCount,
  isSyncingMore,
  isLoading,
  offset,
  setSearchQuery,
  handlePrevPage,
  handleNextPage,
}: EmailListHeaderProps) {
  return (
    <div className="flex items-center justify-between px-6 h-14 shrink-0 gap-4 bg-[var(--bg-inbox)] border-b border-[var(--border-subtle)]">
      
      {/* Folder title */}
      <div className="flex items-center gap-3 shrink-0">
        <span className="text-[16px] font-medium tracking-tight text-[var(--text-primary)] capitalize">
          {folder}
        </span>

        {safeTotalCount > 0 && (
          <span className="font-mono text-[11px] text-[var(--text-muted)]">
            {safeTotalCount}
          </span>
        )}
      </div>

      {/* Search */}
      <div className="flex-1 max-w-[320px]">
        <SearchBar onSearch={setSearchQuery} placeholder="Search people, receipts, flights..." />
      </div>

      {/* Pagination */}
      <div className="flex items-center gap-3 shrink-0">
        <span className="font-mono text-[11px] text-[var(--text-muted)]">
          {isSyncingMore ? "fetching…" : `${startCount}–${endCount} of ${safeTotalCount}`}
        </span>
        <div className="flex gap-1">
          <button
            className="flex items-center justify-center w-7 h-7 rounded text-[var(--text-secondary)] cursor-pointer transition-colors duration-100 outline-none hover:not:disabled:bg-[var(--hover)] hover:not:disabled:text-[var(--text-primary)] disabled:opacity-30 disabled:cursor-not-allowed"
            onClick={handlePrevPage}
            disabled={offset === 0 || isLoading || isSyncingMore}
          >
            <ChevronLeft className="w-4 h-4" strokeWidth={1.5} />
          </button>
          <button
            className="flex items-center justify-center w-7 h-7 rounded text-[var(--text-secondary)] cursor-pointer transition-colors duration-100 outline-none hover:not:disabled:bg-[var(--hover)] hover:not:disabled:text-[var(--text-primary)] disabled:opacity-30 disabled:cursor-not-allowed"
            onClick={handleNextPage}
            disabled={isLoading || isSyncingMore}
          >
            <ChevronRight className="w-4 h-4" strokeWidth={1.5} />
          </button>
        </div>
      </div>
    </div>
  );
}
