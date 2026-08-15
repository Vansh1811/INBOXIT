import { Archive, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface BulkToolbarProps {
  selectedCount: number;
  onArchive: () => void;
  onDelete: () => void;
  onCancel: () => void;
}

export default function BulkToolbar({ selectedCount, onArchive, onDelete, onCancel }: BulkToolbarProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] animate-slide-up">
      <div className="bg-[var(--bg-base)] border border-[var(--border-subtle)] shadow-xl rounded-full px-4 py-2 flex items-center gap-6 text-[var(--text-primary)]">
        
        {/* Count Label */}
        <span className="text-[13px] font-medium min-w-[80px]">
          {selectedCount} selected
        </span>

        {/* Divider */}
        <div className="w-[1px] h-4 bg-[var(--border-subtle)]" />

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={onArchive}
            className="flex items-center gap-2 px-3 py-1.5 rounded-full hover:bg-[var(--hover)] transition-colors text-[13px] font-medium cursor-pointer border-none bg-transparent outline-none"
          >
            <Archive className="w-4 h-4" strokeWidth={1.5} />
            Archive
          </button>
          
          <button
            onClick={onDelete}
            className="flex items-center gap-2 px-3 py-1.5 rounded-full hover:bg-[var(--hover)] transition-colors text-[13px] font-medium cursor-pointer border-none bg-transparent outline-none"
          >
            <Trash2 className="w-4 h-4" strokeWidth={1.5} />
            Delete
          </button>
        </div>

        {/* Divider */}
        <div className="w-[1px] h-4 bg-[var(--border-subtle)]" />

        {/* Cancel */}
        <button
          onClick={onCancel}
          className="p-1.5 rounded-full hover:bg-[var(--hover)] transition-colors cursor-pointer border-none bg-transparent outline-none text-[var(--text-muted)]"
          aria-label="Cancel selection"
        >
          <X className="w-4 h-4" strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}
