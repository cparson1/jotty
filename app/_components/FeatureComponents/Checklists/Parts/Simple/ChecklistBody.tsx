import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  DragOverEvent,
  closestCenter,
} from "@dnd-kit/core";
import { ChecklistProgress } from "./ChecklistProgress";
import { ChecklistItemsWrapper } from "./ChecklistItemsWrapper";
import { NestedChecklistItem } from "@/app/_components/FeatureComponents/Checklists/Parts/Simple/NestedChecklistItem";
import VirtualizedChecklistItems from "./VirtualizedChecklistItems";
import { Checklist, Item } from "@/app/_types";
import { DropIndicator } from "./DropIndicator";
import { ItemTypes, TaskStatusLabels } from "@/app/_types/enums";
import { useMemo, useState } from "react";
import { getReferences } from "@/app/_utils/indexes-utils";
import { useAppMode } from "@/app/_providers/AppModeProvider";
import { ReferencedBySection } from "@/app/_components/FeatureComponents/Notes/Parts/ReferencedBySection";
import { useTranslations } from "next-intl";
import { useUIStore } from "@/app/_utils/ui-store";
import { Tag01Icon, Cancel01Icon } from "hugeicons-react";
import { cn } from "@/app/_utils/global-utils";

interface ChecklistBodyProps {
  localList: Checklist;
  incompleteItems: Item[];
  completedItems: Item[];
  handleToggleItem: (itemId: string, completed: boolean) => void;
  handleDeleteItem: (itemId: string) => void;
  handleEditItem: (itemId: string, text: string) => void;
  handleAddSubItem: (parentId: string, text: string) => void;
  handleBulkToggle: (completed: boolean) => void;
  handleClearAll: (type: "completed" | "incomplete") => void;
  handleDragEnd: (event: DragEndEvent) => void;
  sensors: any;
  isLoading: boolean;
  isDeletingItem: boolean;
  availableItemTags?: string[];
  selectedItemTags?: string[];
  toggleItemTagFilter?: (tag: string) => void;
  clearItemTagFilters?: () => void;
}

export const ChecklistBody = ({
  localList,
  incompleteItems,
  completedItems,
  handleToggleItem,
  handleDeleteItem,
  handleEditItem,
  handleAddSubItem,
  handleBulkToggle,
  handleClearAll,
  handleDragEnd,
  sensors,
  isLoading,
  isDeletingItem,
  availableItemTags = [],
  selectedItemTags = [],
  toggleItemTagFilter,
  clearItemTagFilters,
}: ChecklistBodyProps) => {
  const t = useTranslations();
  const { linkIndex, notes, checklists, appSettings } = useAppMode();
  const { isDragging, setIsDragging } = useUIStore();
  const [activeItem, setActiveItem] = useState<Item | null>(null);
  const [overItem, setOverItem] = useState<{
    id: string;
    position: "before" | "after";
  } | null>(null);

  const referencingItems = useMemo(() => {
    return getReferences(
      linkIndex,
      localList.uuid,
      localList.category,
      ItemTypes.CHECKLIST,
      notes,
      checklists
    );
  }, [linkIndex, localList.uuid, localList.category, notes, checklists]);

  const onDragStart = (event: DragStartEvent) => {
    const findItem = (items: Item[], id: string): Item | undefined => {
      for (const item of items) {
        if (item.id === id) return item;
        if (item.children) {
          const found = findItem(item.children, id);
          if (found) return found;
        }
      }
      return undefined;
    };

    const item = findItem(localList.items, event.active.id.toString());
    setActiveItem(item || null);
    setIsDragging(true);
  };

  const onDragEnd = (event: DragEndEvent) => {
    handleDragEnd(event);
    setActiveItem(null);
    setOverItem(null);
    setIsDragging(false);
  };

  const onDragCancel = () => {
    setActiveItem(null);
    setOverItem(null);
    setIsDragging(false);
  };

  const onDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      setOverItem(null);
      return;
    }

    const overId = over.id;
    const isDraggingUp = event.delta.y < 0;

    setOverItem({
      id: overId.toString(),
      position: isDraggingUp ? "before" : "after",
    });
  };

  if (localList.items.length === 0) {
    return (
      <>
        <div className="bg-card rounded-jotty border border-border m-4 p-8 text-center">
          <h3 className="text-xl font-semibold text-foreground mb-2">
            {t("checklists.noItemsYet")}
          </h3>
          <p className="text-muted-foreground">
            {t("checklists.addFirstItem")}
          </p>
        </div>

        {referencingItems.length > 0 &&
          appSettings?.editor?.enableBilateralLinks && (
            <div className="p-4">
              <ReferencedBySection referencingItems={referencingItems} />
            </div>
          )}
      </>
    );
  }

  return (
    <>
      {localList.items.length > 0 && (
        <ChecklistProgress checklist={localList} />
      )}
      {availableItemTags.length > 0 && toggleItemTagFilter && (
        <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
          <Tag01Icon className="h-4 w-4 text-muted-foreground shrink-0" />
          {availableItemTags.map((tag) => {
            const isSelected = selectedItemTags.includes(tag);
            return (
              <button
                key={tag}
                onClick={() => toggleItemTagFilter(tag)}
                className={cn(
                  "px-2.5 py-1 text-xs font-medium rounded-jotty border transition-colors",
                  isSelected
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"
                )}
              >
                #{tag}
              </button>
            );
          })}
          {selectedItemTags.length > 0 && clearItemTagFilters && (
            <button
              onClick={clearItemTagFilters}
              className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Cancel01Icon className="h-3.5 w-3.5" />
              {t("checklists.clearTagFilters")}
            </button>
          )}
        </div>
      )}
      <div className="flex-1 overflow-y-auto jotty-scrollable-content p-4">
        {selectedItemTags.length > 0 &&
          incompleteItems.length === 0 &&
          completedItems.length === 0 && (
            <div className="bg-card rounded-jotty border border-border p-8 text-center mb-4">
              <p className="text-muted-foreground">
                {t("checklists.noItemsMatchTags")}
              </p>
            </div>
          )}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
          onDragOver={onDragOver}
        >
          <div className="w-full min-h-[200px] space-y-4 overflow-hidden checklist-todo-container">
            {incompleteItems.length > 0 && (
              <ChecklistItemsWrapper
                title={TaskStatusLabels.TODO}
                count={incompleteItems.length}
                onBulkToggle={() => handleBulkToggle(true)}
                onClearAll={() => handleClearAll("incomplete")}
                isLoading={isLoading}
              >
                {incompleteItems.length >= 50 ? (
                  <VirtualizedChecklistItems
                    items={incompleteItems}
                    onToggle={handleToggleItem}
                    onDelete={handleDeleteItem}
                    onEdit={handleEditItem}
                    onAddSubItem={handleAddSubItem}
                    isDeletingItem={isDeletingItem}
                    checklist={localList}
                    isAnyItemDragging={isDragging}
                    overItem={overItem}
                  />
                ) : (
                  <>
                    <DropIndicator
                      id={`drop-before::${incompleteItems[0]?.id || "start"}`}
                      data={{
                        type: "drop-indicator",
                        position: "before",
                        targetId: incompleteItems[0]?.id,
                      }}
                    />
                    {incompleteItems.map((item, index) => (
                      <div key={item.id}>
                        <NestedChecklistItem
                          item={item}
                          index={index.toString()}
                          level={0}
                          onToggle={handleToggleItem}
                          onDelete={handleDeleteItem}
                          onEdit={handleEditItem}
                          onAddSubItem={handleAddSubItem}
                          isDeletingItem={isDeletingItem}
                          isDragDisabled={false}
                          checklist={localList}
                          isOver={overItem?.id === item.id}
                          overPosition={
                            overItem?.id === item.id
                              ? overItem.position
                              : undefined
                          }
                          isAnyItemDragging={isDragging}
                          overItem={overItem}
                          draggedItemId={activeItem?.id}
                        />
                        <DropIndicator
                          id={`drop-after::${item.id}`}
                          data={{
                            type: "drop-indicator",
                            position: "after",
                            targetId: item.id,
                          }}
                        />
                      </div>
                    ))}
                  </>
                )}
              </ChecklistItemsWrapper>
            )}
            {completedItems.length > 0 && (
              <ChecklistItemsWrapper
                title={TaskStatusLabels.COMPLETED}
                count={completedItems.length}
                onBulkToggle={() => handleBulkToggle(false)}
                onClearAll={() => handleClearAll("completed")}
                isLoading={isLoading}
                isCompleted
              >
                {completedItems.length >= 50 ? (
                  <VirtualizedChecklistItems
                    items={completedItems}
                    onToggle={handleToggleItem}
                    onDelete={handleDeleteItem}
                    onEdit={handleEditItem}
                    onAddSubItem={handleAddSubItem}
                    isDeletingItem={isDeletingItem}
                    checklist={localList}
                    isAnyItemDragging={isDragging}
                    overItem={overItem}
                  />
                ) : (
                  <>
                    <DropIndicator
                      id={`drop-before::${
                        completedItems[0]?.id || "start-completed"
                      }`}
                      data={{
                        type: "drop-indicator",
                        position: "before",
                        targetId: completedItems[0]?.id,
                      }}
                    />
                    {completedItems.map((item, index) => (
                      <div key={item.id}>
                        <NestedChecklistItem
                          item={item}
                          index={(incompleteItems.length + index).toString()}
                          level={0}
                          onToggle={handleToggleItem}
                          onDelete={handleDeleteItem}
                          onEdit={handleEditItem}
                          onAddSubItem={handleAddSubItem}
                          completed
                          isDeletingItem={isDeletingItem}
                          isDragDisabled={false}
                          checklist={localList}
                          isOver={overItem?.id === item.id}
                          overPosition={
                            overItem?.id === item.id
                              ? overItem.position
                              : undefined
                          }
                          isAnyItemDragging={isDragging}
                          overItem={overItem}
                          draggedItemId={activeItem?.id}
                        />
                        <DropIndicator
                          id={`drop-after::${item.id}`}
                          data={{
                            type: "drop-indicator",
                            position: "after",
                            targetId: item.id,
                          }}
                        />
                      </div>
                    ))}
                  </>
                )}
              </ChecklistItemsWrapper>
            )}
          </div>
        </DndContext>

        {referencingItems.length > 0 &&
          appSettings?.editor?.enableBilateralLinks && (
            <ReferencedBySection referencingItems={referencingItems} />
          )}
      </div>
    </>
  );
};
