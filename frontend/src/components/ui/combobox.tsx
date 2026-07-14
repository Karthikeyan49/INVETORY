import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

interface ComboboxProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  className?: string;
}

// Free-text combobox: type anything (like a native <input list>), or pick a suggestion —
// but themed to match the site instead of the browser's native datalist popup.
export function Combobox({ value, onChange, options, placeholder, className }: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const filtered = React.useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>{value || placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={placeholder}
            value={value}
            onValueChange={onChange}
            onKeyDown={(e) => {
              // No matching suggestion to select — Enter should close the dropdown
              // (like Escape / clicking outside already do) instead of doing nothing.
              if (e.key === "Enter" && filtered.length === 0) {
                e.preventDefault();
                setOpen(false);
              }
            }}
          />
          <CommandList>
            <CommandEmpty>
              <div className="px-4 py-3 text-sm text-muted-foreground">No matches — your typed value will be used.</div>
            </CommandEmpty>
            <CommandGroup>
              {filtered.map((o) => (
                <CommandItem
                  key={o}
                  value={o}
                  onSelect={() => { onChange(o); setOpen(false); }}
                  className="flex items-center gap-2"
                >
                  <Check className={cn("h-4 w-4 shrink-0", value === o ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{o}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
