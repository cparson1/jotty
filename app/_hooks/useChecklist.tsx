"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { Checklist, ChecklistType, Item, RecurrenceRule } from "@/app/_types";
import {
  deleteList,
  convertChecklistType,
  getListById,
} from "@/app/_server/actions/checklist";
import {
  createItem,
  updateItem,
  reorderItems,
  createBulkItems,
  bulkToggleItems,
  bulkDeleteItems,
  createSubItem,
} from "@/app/_server/actions/checklist-item";
import { useRouter } from "next/navigation";
import {
  getCurrentUser,
  getUserByChecklist,
} from "@/app/_server/actions/users";
import { copyTextToClipboard } from "../_utils/global-utils";
import { encodeCategoryPath } from "../_utils/global-utils";
import { areAllItemsCompleted } from "../_utils/checklist-utils";
import { ConfirmModal } from "@/app/_components/GlobalComponents/Modals/ConfirmationModals/ConfirmModal";
import {
  extractHashtagsFromContent,
  extractItemCategoryFromContent,
  setItemCategoryInContent,
  stripItemCategoryFromContent,
} from "../_utils/tag-utils";
import { useToast } from "@/app/_providers/ToastProvider";
import { UNDO_TOAST_DURATION_SECONDS } from "@/app/_consts/checklists";

interface UseChecklistProps {
  list: Checklist;
  onUpdate: (updatedChecklist: Checklist) => void;
  onDelete?: (deletedId: string) => void;
}

export interface ItemCategoryGroup {
  category: string;
  totalCount: number;
  matchedCount: number;
  items: Item[];
}

const groupItemsByCategory = (
  allItems: Item[],
  filteredItems: Item[],
  getItemCategory: (item: Item) => string | null,
): { groups: ItemCategoryGroup[]; uncategorizedItems: Item[] } => {
  const totalsByCategory = new Map<string, number>();
  allItems.forEach((item) => {
    const category = getItemCategory(item);
    if (category) {
      totalsByCategory.set(category, (totalsByCategory.get(category) || 0) + 1);
    }
  });

  const itemsByCategory = new Map<string, Item[]>();
  const uncategorizedItems: Item[] = [];
  filteredItems.forEach((item) => {
    const category = getItemCategory(item);
    if (category) {
      if (!itemsByCategory.has(category)) itemsByCategory.set(category, []);
      itemsByCategory.get(category)!.push(item);
    } else {
      uncategorizedItems.push(item);
    }
  });

  const groups: ItemCategoryGroup[] = Array.from(totalsByCategory.keys())
    .sort()
    .map((category) => ({
      category,
      totalCount: totalsByCategory.get(category) || 0,
      matchedCount: (itemsByCategory.get(category) || []).length,
      items: itemsByCategory.get(category) || [],
    }));

  return { groups, uncategorizedItems };
};

export const useChecklist = ({
  list,
  onUpdate,
  onDelete,
}: UseChecklistProps) => {
  const t = useTranslations();
  const router = useRouter();
  const { showToast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showBulkPasteModal, setShowBulkPasteModal] = useState(false);
  const [showConversionModal, setShowConversionModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [localList, setLocalList] = useState(list);
  const [focusKey, setFocusKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const [itemsToDelete, setItemsToDelete] = useState<string[]>([]);
  const [selectedItemTags, setSelectedItemTags] = useState<string[]>([]);
  const [pendingToggles, setPendingToggles] = useState<Map<string, boolean>>(
    new Map()
  );
  const isInitialMount = useRef(true);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
        delay: 20,
        tolerance: 5,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor)
  );

  useEffect(() => {
    setLocalList(list);
  }, [list]);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    onUpdate(localList);
  }, [localList, onUpdate]);

  useEffect(() => {
    if (itemsToDelete.length === 0) {
      return;
    }

    const timer = setTimeout(async () => {
      const idsToProcess = [...itemsToDelete];

      const formData = new FormData();
      formData.append("listId", localList.id);
      formData.append("itemIds", JSON.stringify(idsToProcess));
      formData.append("category", localList.category || "Uncategorized");

      try {
        const result = await bulkDeleteItems(formData);
        if (!result.success) {
          throw new Error("Server action failed");
        }
      } catch (error) {
        console.error("Failed to bulk delete items:", error);
        router.refresh();
      } finally {
        setItemsToDelete([]);
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [itemsToDelete, localList.id, localList.category, router]);

  useEffect(() => {
    if (pendingToggles.size === 0) {
      return;
    }

    const timer = setTimeout(async () => {
      const togglesToProcess = new Map(pendingToggles);
      setPendingToggles(new Map());

      const syncPromises = Array.from(togglesToProcess.entries()).map(
        async ([itemId, completed]) => {
          try {
            const formData = new FormData();
            formData.append("listId", localList.id);
            formData.append("itemId", itemId);
            formData.append("completed", String(completed));
            formData.append("category", localList.category || "Uncategorized");

            const result = await updateItem(
              localList,
              formData,
              undefined,
              true
            );
            if (!result.success) {
              throw new Error("Server action failed");
            }
          } catch (error) {
            console.error(`Failed to sync toggle for ${itemId}:`, error);
            setPendingToggles((prev) => new Map(prev).set(itemId, completed));
          }
        }
      );

      await Promise.all(syncPromises);

      router.refresh();
    }, 500);

    return () => clearTimeout(timer);
  }, [pendingToggles, localList.id, localList.category, localList]);

  const handleDeleteItem = (itemId: string) => {
    setLocalList((currentList) => {
      const filterNestedItem = (items: any[]): any[] => {
        return items
          .filter((item) => item.id !== itemId)
          .map((item) => {
            const children = item.children
              ? filterNestedItem(item.children)
              : undefined;
            const completed = (
              children && children.length > 0 && areAllItemsCompleted(children)
            ) ? true : item.completed;

            return {...item, completed, children};
          })
          .filter((item) => item.children?.length > 0 || item.id !== undefined);
      };

      return {
        ...currentList,
        items: filterNestedItem(currentList.items),
      };
    });

    setFocusKey((prev) => prev + 1);

    setItemsToDelete((prevItems) => {
      if (prevItems.includes(itemId)) {
        return prevItems;
      }
      return [...prevItems, itemId];
    });
  };

  const confirmDeleteList = async () => {
    const formData = new FormData();
    formData.append("id", localList.id);
    formData.append("category", localList.category || "Uncategorized");
    if (localList.uuid) formData.append("uuid", localList.uuid);
    await deleteList(formData);
    onDelete?.(localList.id);
    setShowDeleteModal(false);
  };

  const findItemById = (items: any[], itemId: string): any | null => {
    for (const item of items) {
      if (item.id === itemId) {
        return item;
      }

      if (item.children && item.children.length > 0) {
        const found = findItemById(item.children, itemId);
        if (found) {
          return found;
        }
      }
    }
    return null;
  };

  const findParentAndSiblings = (
    items: any[],
    itemId: string,
    parent: any = null,
    siblings: any[] = []
  ): { parent: any | null; siblings: any[] } | null => {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      if (item.id === itemId) {
        return { parent, siblings: items };
      }

      if (item.children && item.children.length > 0) {
        const result = findParentAndSiblings(
          item.children,
          itemId,
          item,
          item.children
        );
        if (result) {
          return result;
        }
      }
    }
    return null;
  };

  const updateAllChildren = (items: any[], completed: boolean): any[] => {
    return items.map((item) => ({
      ...item,
      completed,
      children: item.children
        ? updateAllChildren(item.children, completed)
        : undefined,
    }));
  };

  const updateParentBasedOnChildren = (parent: any): any => {
    if (!parent || (parent.children || []).length < 1) {
      return parent;
    }

    return {
      ...parent,
      completed: areAllItemsCompleted(parent.children),
    };
  };

  const handleToggleItem = async (itemId: string, completed: boolean) => {
    const now = new Date().toISOString();
    const currentUser = await getCurrentUser();
    const toggledItem = findItemById(localList.items, itemId);

    setLocalList((currentList) => {
      const findAndUpdateItem = (
        items: any[],
        itemId: string,
        updates: any
      ): any[] => {
        return items.map((item) => {
          if (item.id === itemId) {
            let updatedItem = { ...item, ...updates };

            if (
              updates.completed &&
              item.children &&
              item.children.length > 0
            ) {
              updatedItem.children = updateAllChildren(item.children, true);
            } else if (
              updates.completed === false &&
              item.children &&
              item.children.length > 0
            ) {
              updatedItem.children = updateAllChildren(item.children, false);
            }

            return updatedItem;
          }

          if (item.children && item.children.length > 0) {
            const updatedChildren = findAndUpdateItem(
              item.children,
              itemId,
              updates
            );
            const updatedItem = updateParentBasedOnChildren({
              ...item,
              children: updatedChildren,
            });
            return updatedItem;
          }

          return item;
        });
      };

      const updatedItems = findAndUpdateItem(currentList.items, itemId, {
        completed,
        ...(currentUser && {
          lastModifiedBy: currentUser.username,
          lastModifiedAt: now,
        }),
      });

      return {
        ...currentList,
        items: updatedItems,
        updatedAt: now,
      };
    });

    setPendingToggles((prev) => new Map(prev).set(itemId, completed));

    if (toggledItem) {
      showToast({
        type: "info",
        title: stripItemCategoryFromContent(
          toggledItem.text.split(" | metadata:")[0].trim()
        ),
        duration: UNDO_TOAST_DURATION_SECONDS * 1000,
        action: {
          label: t("common.undo"),
          onClick: () => handleToggleItem(itemId, !completed),
        },
      });
    }
  };

  const handleEditItem = async (itemId: string, text: string) => {
    const formData = new FormData();
    const currentUser = await getCurrentUser();
    formData.append("listId", localList.id);
    formData.append("itemId", itemId);
    formData.append("text", text);
    formData.append("category", localList.category || "Uncategorized");
    formData.append("user", localList.owner || currentUser?.username || "");

    const result = await updateItem(localList, formData);

    if (result.success) {
      if (result.data) {
        setLocalList(result.data as Checklist);
      } else {
        setLocalList((currentList) => {
          const updateNestedItem = (items: any[]): any[] => {
            return items.map((item) => {
              if (item.id === itemId) {
                return { ...item, text };
              }

              if (item.children && item.children.length > 0) {
                return {
                  ...item,
                  children: updateNestedItem(item.children),
                };
              }

              return item;
            });
          };

          return {
            ...currentList,
            items: updateNestedItem(currentList.items),
          };
        });
      }
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeId = active.id.toString();
    const overId = over.id.toString();

    const isDropIntoZone = overId.startsWith("drop-into-item::");
    const isDropIndicator =
      overId.startsWith("drop-before") || overId.startsWith("drop-after");

    const allowDropInto =
      isDropIntoZone && over.data.current?.allowDropInto === true;
    const isDropInto = allowDropInto;

    if (isDropIntoZone && !allowDropInto) {
      return;
    }

    let targetItemId: string;
    if (isDropIntoZone) {
      targetItemId = overId.replace("drop-into-item::", "");
    } else if (isDropIndicator) {
      const data = over.data.current as any;
      targetItemId = data?.targetId;
    } else {
      targetItemId = overId;
    }

    if (!targetItemId) return;

    if (targetItemId === activeId) return;

    const isDescendantOf = (
      ancestorId: string,
      descendantId: string,
      items: Item[]
    ): boolean => {
      const findItem = (items: Item[], id: string): Item | null => {
        for (const item of items) {
          if (item.id === id) return item;
          if (item.children) {
            const found = findItem(item.children, id);
            if (found) return found;
          }
        }
        return null;
      };

      const checkDescendant = (item: Item, targetId: string): boolean => {
        if (!item.children) return false;
        for (const child of item.children) {
          if (child.id === targetId) return true;
          if (checkDescendant(child, targetId)) return true;
        }
        return false;
      };

      const ancestor = findItem(items, ancestorId);
      return ancestor ? checkDescendant(ancestor, descendantId) : false;
    };

    if (isDescendantOf(activeId, targetItemId, localList.items)) {
      return;
    }

    const findItemWithParent = (
      items: Item[],
      targetId: string,
      parent: Item | null = null
    ): {
      item: Item;
      parent: Item | null;
      siblings: Item[];
      index: number;
    } | null => {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.id === targetId) {
          return { item, parent, siblings: items, index: i };
        }
        if (item.children) {
          const found = findItemWithParent(item.children, targetId, item);
          if (found) return found;
        }
      }
      return null;
    };

    const activeInfo = findItemWithParent(localList.items, activeId);
    const overInfo = findItemWithParent(localList.items, targetItemId);

    if (!activeInfo || !overInfo) return;

    let undoTarget:
      | { overItemId: string; isDropInto: boolean; position: "before" | "after" }
      | null = null;
    if (activeInfo.index > 0) {
      undoTarget = {
        overItemId: activeInfo.siblings[activeInfo.index - 1].id,
        isDropInto: false,
        position: "after",
      };
    } else if (activeInfo.siblings.length > 1) {
      undoTarget = {
        overItemId: activeInfo.siblings[1].id,
        isDropInto: false,
        position: "before",
      };
    } else if (activeInfo.parent) {
      undoTarget = {
        overItemId: activeInfo.parent.id,
        isDropInto: true,
        position: "before",
      };
    }
    const draggedItem = activeInfo.item;

    const activeCategory = getItemCategory(activeInfo.item);
    const overCategory = getItemCategory(overInfo.item);
    const shouldRecategorize = !isDropInto && overCategory !== activeCategory;
    const newItemText = shouldRecategorize
      ? setItemCategoryInContent(activeInfo.item.text, overCategory)
      : activeInfo.item.text;

    const cloneItems = (items: Item[]): Item[] => {
      return items.map((item) => ({
        ...item,
        children: item.children ? cloneItems(item.children) : undefined,
      }));
    };

    setLocalList((list) => {
      const newItems = cloneItems(list.items);

      const activeInNew = findItemWithParent(newItems, activeId);
      const overInNew = findItemWithParent(newItems, targetItemId);

      if (!activeInNew || !overInNew) return list;

      if (shouldRecategorize) {
        activeInNew.item.text = newItemText;
      }

      activeInNew.siblings.splice(activeInNew.index, 1);

      if (isDropInto) {
        if (!overInNew.item.children) {
          overInNew.item.children = [];
        }
        overInNew.item.children.push(activeInNew.item);
      } else {
        const targetSiblings = overInNew.siblings;
        const targetParent = overInNew.parent;

        let newIndex = targetSiblings.findIndex(
          (item) => item.id === targetItemId
        );

        const isDraggingDown =
          activeInfo.parent?.id === targetParent?.id &&
          activeInfo.index < overInfo.index;

        const position = isDropIndicator
          ? overId.startsWith("drop-after")
            ? "after"
            : "before"
          : isDraggingDown
          ? "after"
          : "before";

        if (position === "after") {
          newIndex = newIndex + 1;
        }

        targetSiblings.splice(newIndex, 0, activeInNew.item);
      }

      const updateOrder = (items: Item[]) => {
        items.forEach((item, idx) => {
          item.order = idx;
          if (item.children) updateOrder(item.children);
        });
      };
      updateOrder(newItems);

      return { ...list, items: newItems };
    });

    const formData = new FormData();
    const isDraggingDown =
      activeInfo.parent?.id === overInfo.parent?.id &&
      activeInfo.index < overInfo.index;

    const reorderPosition = isDropIndicator
      ? overId.startsWith("drop-after")
        ? "after"
        : "before"
      : isDraggingDown
      ? "after"
      : "before";

    formData.append("listId", localList.id);
    formData.append("activeItemId", activeId);
    formData.append("overItemId", targetItemId);
    formData.append("isDropInto", String(isDropInto));
    formData.append("position", reorderPosition);
    formData.append("category", localList.category || "Uncategorized");

    const result = await reorderItems(formData);
    if (!result.success) {
      setLocalList(list);
      return;
    }

    if (shouldRecategorize) {
      const currentUser = await getCurrentUser();
      const textFormData = new FormData();
      textFormData.append("listId", localList.id);
      textFormData.append("itemId", activeId);
      textFormData.append("text", newItemText);
      textFormData.append("category", localList.category || "Uncategorized");
      textFormData.append(
        "user",
        localList.owner || currentUser?.username || ""
      );
      await updateItem(localList, textFormData);
    }

    if (undoTarget) {
      const target = undoTarget;
      showToast({
        type: "info",
        title: stripItemCategoryFromContent(
          draggedItem.text.split(" | metadata:")[0].trim()
        ),
        duration: UNDO_TOAST_DURATION_SECONDS * 1000,
        action: {
          label: t("common.undo"),
          onClick: () => {
            const syntheticEvent = {
              active: { id: activeId },
              over: target.isDropInto
                ? {
                    id: `drop-into-item::${target.overItemId}`,
                    data: { current: { allowDropInto: true } },
                  }
                : {
                    id: `drop-${target.position}::${target.overItemId}`,
                    data: {
                      current: {
                        type: "drop-indicator",
                        position: target.position,
                        targetId: target.overItemId,
                      },
                    },
                  },
            } as unknown as DragEndEvent;
            handleDragEnd(syntheticEvent);
          },
        },
      });
    }
  };

  const handleBulkPaste = async (itemsText: string) => {
    setIsLoading(true);
    const formData = new FormData();
    formData.append("listId", localList.id);
    formData.append("itemsText", itemsText);
    formData.append("category", localList.category || "Uncategorized");
    const result = await createBulkItems(formData);
    setIsLoading(false);

    if (result.success && result.data) {
      setLocalList(result.data as Checklist);
    }
  };

  const handleConvertType = () => {
    setShowConversionModal(true);
  };

  const getNewType = (currentType: ChecklistType): ChecklistType => {
    return currentType === "simple" ? "kanban" : "simple";
  };

  const handleConfirmConversion = async () => {
    setIsLoading(true);
    const newType = getNewType(localList.type);
    const formData = new FormData();
    formData.append("listId", localList.id);
    formData.append("newType", newType);
    formData.append("category", localList.category || "Uncategorized");
    formData.append("uuid", localList.uuid || "");
    const result = await convertChecklistType(formData);
    setIsLoading(false);

    if (result.success && result.data) {
      setLocalList(result.data as Checklist);
    }
  };

  const handleBulkToggle = async (completed: boolean) => {
    const findTargetItems = (items: any[]): any[] => {
      const targets: any[] = [];

      items.forEach((item) => {
        const shouldToggle = completed ? !item.completed : item.completed;
        if (shouldToggle) {
          targets.push(item);
        }

        if (item.children && item.children.length > 0) {
          targets.push(...findTargetItems(item.children));
        }
      });

      return targets;
    };

    const targetItems = findTargetItems(localList.items);
    if (targetItems.length === 0) return;

    setIsLoading(true);
    const formData = new FormData();
    formData.append("listId", localList.id);
    formData.append("completed", String(completed));
    formData.append(
      "itemIds",
      JSON.stringify(targetItems.map((item) => item.id))
    );
    formData.append("category", localList.category || "Uncategorized");

    const result = await bulkToggleItems(formData);
    setIsLoading(false);

    if (result.success && result.data) {
      setLocalList(result.data as Checklist);
      setFocusKey((prev) => prev + 1);
    }
  };

  const handleClearAll = async (type: "completed" | "incomplete") => {
    setIsLoading(true);
    const formData = new FormData();
    formData.append("id", localList.id);
    formData.append("category", localList.category || "Uncategorized");
    formData.append("type", type);
    if (localList.owner) {
      formData.append("user", localList.owner);
    }

    const { clearAllChecklistItems } = await import(
      "@/app/_server/actions/checklist"
    );

    const result = await clearAllChecklistItems(formData);
    setIsLoading(false);

    if (result.success && result.data) {
      setLocalList(result.data as Checklist);
      setFocusKey((prev) => prev + 1);
      router.refresh();
    }
  };

  const handleCreateItem = async (
    text: string,
    recurrence?: RecurrenceRule
  ) => {
    setIsLoading(true);
    const formData = new FormData();

    formData.append("listId", localList.id);
    formData.append("text", text);
    formData.append("category", localList.category || "Uncategorized");

    const currentUser = await getCurrentUser();
    if (recurrence) {
      formData.append("recurrence", JSON.stringify(recurrence));
    }
    const result = await createItem(localList, formData, currentUser?.username);

    const updatedList = await getListById(
      localList.id,
      localList.owner || currentUser?.username,
      localList.category
    );

    if (updatedList) {
      setLocalList(updatedList);
    }
    setIsLoading(false);

    if (result.success && result.data) {
      router.refresh();
      setFocusKey((prev) => prev + 1);
    } else {
      console.error("Failed to create item:", result.error);
    }
  };

  const handleAddSubItem = async (parentId: string, text: string) => {
    setIsLoading(true);
    const formData = new FormData();
    formData.append("listId", localList.id);
    formData.append("parentId", parentId);
    formData.append("text", text);
    formData.append("category", localList.category || "Uncategorized");
    const result = await createSubItem(formData);
    setIsLoading(false);

    if (result.success) {
      if (result.data && typeof result.data === "object" && result.data.items) {
        setLocalList(result.data as Checklist);
      } else {
        const updateItemWithSubItem = (
          items: any[],
          parentId: string,
          newSubItem: any
        ): any[] => {
          return items.map((item) => {
            if (item.id === parentId) {
              return {
                ...item,
                children: [...(item.children || []), newSubItem],
              };
            }

            if (item.children) {
              return {
                ...item,
                children: updateItemWithSubItem(
                  item.children,
                  parentId,
                  newSubItem
                ),
              };
            }

            return item;
          });
        };

        setLocalList((currentList) => ({
          ...currentList,
          items: updateItemWithSubItem(currentList.items, parentId, {
            id: `${localList.id}-sub-${Date.now()}`,
            text,
            completed: false,
            order: 0,
          }),
        }));
      }
      router.refresh();
    }
  };

  const handleCopyId = async () => {
    const success = await copyTextToClipboard(
      `${
        localList.uuid
          ? localList.uuid
          : `${encodeCategoryPath(localList.category || "Uncategorized")}/${
              localList.id
            }`
      }`
    );
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const isItemFullyCompleted = (item: any): boolean => {
    if (!item.completed) return false;

    if (item.children && item.children.length > 0) {
      return item.children.every(isItemFullyCompleted);
    }

    return true;
  };

  const hasAnyCompletion = (item: any): boolean => {
    if (item.completed) return true;

    if (item.children && item.children.length > 0) {
      return item.children.some(hasAnyCompletion);
    }

    return false;
  };

  const getItemOwnTags = (item: Item): string[] =>
    extractHashtagsFromContent(item.text || "");

  const collectItemTagsDeep = (item: Item): string[] => {
    const tags = getItemOwnTags(item);
    if (item.children && item.children.length > 0) {
      return tags.concat(item.children.flatMap(collectItemTagsDeep));
    }
    return tags;
  };

  const availableItemTags = useMemo(() => {
    const tagSet = new Set<string>();
    localList.items.forEach((item) => {
      collectItemTagsDeep(item).forEach((tag) => tagSet.add(tag));
    });
    return Array.from(tagSet).sort();
  }, [localList.items]);

  const itemMatchesTagFilter = (item: Item): boolean => {
    if (selectedItemTags.length === 0) return true;
    const itemTags = collectItemTagsDeep(item);
    return selectedItemTags.some((tag) => itemTags.includes(tag));
  };

  const toggleItemTagFilter = (tag: string) => {
    setSelectedItemTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const clearItemTagFilters = () => setSelectedItemTags([]);

  const getItemCategory = (item: Item): string | null =>
    extractItemCategoryFromContent(item.text || "");

  const allIncompleteItems = localList.items.filter(
    (item) => !isItemFullyCompleted(item)
  );
  const allCompletedItems = localList.items.filter((item) =>
    isItemFullyCompleted(item)
  );

  const incompleteItems = allIncompleteItems.filter(itemMatchesTagFilter);
  const completedItems = allCompletedItems.filter(itemMatchesTagFilter);

  const {
    groups: incompleteCategoryGroups,
    uncategorizedItems: incompleteUncategorizedItems,
  } = groupItemsByCategory(allIncompleteItems, incompleteItems, getItemCategory);
  const {
    groups: completedCategoryGroups,
    uncategorizedItems: completedUncategorizedItems,
  } = groupItemsByCategory(allCompletedItems, completedItems, getItemCategory);

  return {
    isLoading,
    showShareModal,
    setShowShareModal,
    showBulkPasteModal,
    setShowBulkPasteModal,
    showConversionModal,
    setShowConversionModal,
    localList,
    focusKey,
    setFocusKey,
    copied,
    handleDeleteList: () => setShowDeleteModal(true),
    handleToggleItem,
    handleEditItem,
    handleDeleteItem,
    handleDragEnd,
    handleBulkPaste,
    handleConvertType,
    getNewType,
    handleConfirmConversion,
    handleBulkToggle,
    handleClearAll,
    handleCreateItem,
    handleAddSubItem,
    handleCopyId,
    incompleteItems,
    completedItems,
    incompleteCategoryGroups,
    incompleteUncategorizedItems,
    completedCategoryGroups,
    completedUncategorizedItems,
    availableItemTags,
    selectedItemTags,
    toggleItemTagFilter,
    clearItemTagFilters,
    totalCount: localList.items.length,
    deletingItemsCount: itemsToDelete.length,
    pendingTogglesCount: pendingToggles.size,
    sensors,
    DeleteModal: () => (
      <ConfirmModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={confirmDeleteList}
        title={t("common.delete")}
        message={t("common.confirmDeleteItem", { itemTitle: localList.title })}
        confirmText={t("common.delete")}
        variant="destructive"
      />
    ),
  };
};
