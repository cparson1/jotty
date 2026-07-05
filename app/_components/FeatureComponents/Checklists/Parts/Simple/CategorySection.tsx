"use client";

import { useState } from "react";
import { ArrowDown01Icon, ArrowRight01Icon } from "hugeicons-react";

interface CategorySectionProps {
  category: string;
  matchedCount: number;
  totalCount: number;
  children: React.ReactNode;
}

export const CategorySection = ({
  category,
  matchedCount,
  totalCount,
  children,
}: CategorySectionProps) => {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className="flex items-center gap-1.5 text-md lg:text-sm font-medium text-muted-foreground hover:text-foreground transition-colors mb-1.5"
      >
        {isExpanded ? (
          <ArrowDown01Icon className="h-3.5 w-3.5" />
        ) : (
          <ArrowRight01Icon className="h-3.5 w-3.5" />
        )}
        @{category} ({matchedCount}/{totalCount})
      </button>
      {isExpanded && <div className="space-y-1 pl-1">{children}</div>}
    </div>
  );
};
