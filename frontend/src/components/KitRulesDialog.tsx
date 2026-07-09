import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

import {
  type KitRule,
  type KitProductAdd,
  type KitComponentAdd,
  loadKitRules,
  saveKitRules,
  resetKitRules,
} from "@/lib/quotationKit";

function newId(): string {
  return crypto.randomUUID?.() ?? String(Date.now());
}

function blankRule(): KitRule {
  return {
    id: newId(),
    name: "New rule",
    enabled: true,
    whenNameIncludes: "",
    whenCategoryIncludes: "",
    productAdds: [],
    componentAdds: [],
  };
}

function blankProductAdd(): KitProductAdd {
  return { query: "", qty: 1, perUnit: false };
}

function blankComponentAdd(): KitComponentAdd {
  return { name: "", make: "", qty: 1, perUnit: false };
}

export function KitRulesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}): JSX.Element {
  const [rules, setRules] = useState<KitRule[]>([]);

  useEffect(() => {
    if (open) setRules(loadKitRules());
  }, [open]);

  // ── immutable updaters ──────────────────────────────────────────────────
  const patchRule = (idx: number, patch: Partial<KitRule>) =>
    setRules((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    );

  const removeRule = (idx: number) =>
    setRules((prev) => prev.filter((_, i) => i !== idx));

  const addRule = () => setRules((prev) => [...prev, blankRule()]);

  const patchProductAdd = (
    ruleIdx: number,
    rowIdx: number,
    patch: Partial<KitProductAdd>,
  ) =>
    setRules((prev) =>
      prev.map((r, i) => {
        if (i !== ruleIdx) return r;
        const productAdds = (r.productAdds ?? []).map((row, j) =>
          j === rowIdx ? { ...row, ...patch } : row,
        );
        return { ...r, productAdds };
      }),
    );

  const addProductAdd = (ruleIdx: number) =>
    setRules((prev) =>
      prev.map((r, i) =>
        i === ruleIdx
          ? { ...r, productAdds: [...(r.productAdds ?? []), blankProductAdd()] }
          : r,
      ),
    );

  const removeProductAdd = (ruleIdx: number, rowIdx: number) =>
    setRules((prev) =>
      prev.map((r, i) =>
        i === ruleIdx
          ? {
              ...r,
              productAdds: (r.productAdds ?? []).filter((_, j) => j !== rowIdx),
            }
          : r,
      ),
    );

  const patchComponentAdd = (
    ruleIdx: number,
    rowIdx: number,
    patch: Partial<KitComponentAdd>,
  ) =>
    setRules((prev) =>
      prev.map((r, i) => {
        if (i !== ruleIdx) return r;
        const componentAdds = (r.componentAdds ?? []).map((row, j) =>
          j === rowIdx ? { ...row, ...patch } : row,
        );
        return { ...r, componentAdds };
      }),
    );

  const addComponentAdd = (ruleIdx: number) =>
    setRules((prev) =>
      prev.map((r, i) =>
        i === ruleIdx
          ? {
              ...r,
              componentAdds: [...(r.componentAdds ?? []), blankComponentAdd()],
            }
          : r,
      ),
    );

  const removeComponentAdd = (ruleIdx: number, rowIdx: number) =>
    setRules((prev) =>
      prev.map((r, i) =>
        i === ruleIdx
          ? {
              ...r,
              componentAdds: (r.componentAdds ?? []).filter(
                (_, j) => j !== rowIdx,
              ),
            }
          : r,
      ),
    );

  const handleReset = () => {
    setRules(resetKitRules());
    toast.success("Kit rules reset to defaults");
  };

  const handleSave = () => {
    saveKitRules(rules);
    toast.success("Kit rules saved");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Kit prerequisite rules</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {rules.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No rules yet. Add one to drive the Quotation Builder's auto-add
              reasoning.
            </p>
          )}

          {rules.map((rule, ruleIdx) => (
            <div
              key={rule.id}
              className="rounded-lg border p-4 space-y-4 bg-card"
            >
              {/* header: name + enabled + delete */}
              <div className="flex items-center gap-3">
                <Input
                  value={rule.name}
                  onChange={(e) => patchRule(ruleIdx, { name: e.target.value })}
                  placeholder="Rule name"
                  className="font-medium"
                />
                <div className="flex items-center gap-2 shrink-0">
                  <Switch
                    id={`enabled-${rule.id}`}
                    checked={rule.enabled !== false}
                    onCheckedChange={(v) =>
                      patchRule(ruleIdx, { enabled: v })
                    }
                  />
                  <Label htmlFor={`enabled-${rule.id}`}>Enabled</Label>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-destructive"
                  onClick={() => removeRule(ruleIdx)}
                  aria-label="Delete rule"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              {/* match conditions */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor={`name-${rule.id}`}>
                    When product name contains
                  </Label>
                  <Input
                    id={`name-${rule.id}`}
                    value={rule.whenNameIncludes ?? ""}
                    onChange={(e) =>
                      patchRule(ruleIdx, { whenNameIncludes: e.target.value })
                    }
                    placeholder="e.g. panel"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`cat-${rule.id}`}>
                    …category contains
                  </Label>
                  <Input
                    id={`cat-${rule.id}`}
                    value={rule.whenCategoryIncludes ?? ""}
                    onChange={(e) =>
                      patchRule(ruleIdx, {
                        whenCategoryIncludes: e.target.value,
                      })
                    }
                    placeholder="e.g. panel"
                  />
                </div>
              </div>

              {/* companion products */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Companion products</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addProductAdd(ruleIdx)}
                  >
                    <Plus className="h-4 w-4 mr-1" /> Add product
                  </Button>
                </div>
                {(rule.productAdds ?? []).length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No companion products.
                  </p>
                )}
                {(rule.productAdds ?? []).map((row, rowIdx) => (
                  <div
                    key={rowIdx}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <Input
                      value={row.query}
                      onChange={(e) =>
                        patchProductAdd(ruleIdx, rowIdx, {
                          query: e.target.value,
                        })
                      }
                      placeholder="product to add (e.g. inverter)"
                      className="flex-1 min-w-[10rem]"
                    />
                    <Input
                      type="number"
                      value={row.qty}
                      onChange={(e) =>
                        patchProductAdd(ruleIdx, rowIdx, {
                          qty: Number(e.target.value),
                        })
                      }
                      placeholder="qty"
                      className="w-20"
                    />
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Switch
                        id={`p-perunit-${rule.id}-${rowIdx}`}
                        checked={row.perUnit ?? false}
                        onCheckedChange={(v) =>
                          patchProductAdd(ruleIdx, rowIdx, { perUnit: v })
                        }
                      />
                      <Label htmlFor={`p-perunit-${rule.id}-${rowIdx}`}>
                        × qty
                      </Label>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-destructive"
                      onClick={() => removeProductAdd(ruleIdx, rowIdx)}
                      aria-label="Delete companion product"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>

              {/* companion components */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Companion components</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addComponentAdd(ruleIdx)}
                  >
                    <Plus className="h-4 w-4 mr-1" /> Add component
                  </Button>
                </div>
                {(rule.componentAdds ?? []).length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No companion components.
                  </p>
                )}
                {(rule.componentAdds ?? []).map((row, rowIdx) => (
                  <div
                    key={rowIdx}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <Input
                      value={row.name}
                      onChange={(e) =>
                        patchComponentAdd(ruleIdx, rowIdx, {
                          name: e.target.value,
                        })
                      }
                      placeholder="component name (e.g. ACDB)"
                      className="flex-1 min-w-[10rem]"
                    />
                    <Input
                      value={row.make ?? ""}
                      onChange={(e) =>
                        patchComponentAdd(ruleIdx, rowIdx, {
                          make: e.target.value,
                        })
                      }
                      placeholder="make"
                      className="w-28"
                    />
                    <Input
                      type="number"
                      value={row.qty}
                      onChange={(e) =>
                        patchComponentAdd(ruleIdx, rowIdx, {
                          qty: Number(e.target.value),
                        })
                      }
                      placeholder="qty"
                      className="w-20"
                    />
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Switch
                        id={`c-perunit-${rule.id}-${rowIdx}`}
                        checked={row.perUnit ?? false}
                        onCheckedChange={(v) =>
                          patchComponentAdd(ruleIdx, rowIdx, { perUnit: v })
                        }
                      />
                      <Label htmlFor={`c-perunit-${rule.id}-${rowIdx}`}>
                        × qty
                      </Label>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-destructive"
                      onClick={() => removeComponentAdd(ruleIdx, rowIdx)}
                      aria-label="Delete companion component"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <Button type="button" variant="outline" onClick={addRule}>
            <Plus className="h-4 w-4 mr-1" /> Add rule
          </Button>
        </div>

        <div className="flex items-center justify-between pt-4 border-t mt-2">
          <Button type="button" variant="ghost" onClick={handleReset}>
            Reset to defaults
          </Button>
          <Button type="button" onClick={handleSave}>
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
