import React, { useRef, useEffect } from "react";
import * as Icons from "lucide-react";
import { CATEGORIES, CAT, Category } from "@/lib/utils/email";

interface CategoryMenuProps {
  currentCategory: string;
  onSelect: (category: Category) => void;
  onClose: () => void;
}

export default function CategoryMenu({ currentCategory, onSelect, onClose }: CategoryMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  const availableCategories = CATEGORIES.filter(c => c !== currentCategory);

  return (
    <div 
      ref={menuRef}
      className="absolute bottom-full right-0 mb-2 w-56 max-h-[300px] overflow-y-auto bg-[var(--bg-reading)] border border-[var(--border-subtle)] shadow-xl rounded-md py-1 z-50 flex flex-col"
    >
      <div className="px-3 py-1.5 text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider sticky top-0 bg-[var(--bg-reading)] z-10 border-b border-[var(--border-subtle)]">
        Move to
      </div>
      <div className="flex flex-col pt-1">
        {availableCategories.map((catKey) => {
          const meta = CAT[catKey];
          if (!meta) return null;
          const Icon = (Icons as unknown as Record<string, React.ElementType>)[meta.icon] || Icons.HelpCircle;
          return (
            <button
              key={catKey}
              onClick={() => onSelect(catKey)}
              className="flex items-center gap-3 px-3 py-2 text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover)] border-none bg-transparent cursor-pointer text-left w-full outline-none transition-colors duration-100"
            >
              <Icon className="w-4 h-4 shrink-0" strokeWidth={1.5} />
              <span className="truncate">{meta.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
