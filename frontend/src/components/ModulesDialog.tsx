import { sections, ACTIVE_MODULE_STORAGE_KEY } from "@/lib/navigation";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ModulesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// One cohesive, professional look for every module card — the card sits on a
// subtle neutral surface with the brand-blue heading, rather than a different
// colour per section (which read as busy / childish).
const cardColors = { bg: "bg-muted/40", icon: "text-primary" };

export function ModulesDialog({ open, onOpenChange }: ModulesDialogProps) {
  const navigate = useNavigate();

  const handleItemClick = (url: string, sectionLabel: string) => {
    localStorage.setItem(ACTIVE_MODULE_STORAGE_KEY, sectionLabel);
    navigate(url);
    onOpenChange(false);
  };

  // Skip Overview section in the dialog grid
  const displaySections = sections.filter((s) => s.label !== "Overview");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Select a module</DialogTitle>
          <DialogDescription>Choose an area to load in the sidebar</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 py-4">
          {displaySections.map((section) => {
            return (
              <div
                key={section.label}
                className={`${cardColors.bg} border rounded-lg p-4 space-y-3`}
              >
                <h3 className={`text-sm font-semibold ${cardColors.icon}`}>
                  {section.label}
                </h3>
                <div className="space-y-1.5">
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.url}
                        onClick={() => handleItemClick(item.url, section.label)}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors text-left"
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span>{item.title}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
