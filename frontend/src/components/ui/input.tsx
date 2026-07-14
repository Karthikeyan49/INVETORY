import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, onChange, ...props }, ref) => {
    // For number fields, strip a stray leading zero as you type ("05" -> "5")
    // so a preceding zero never sticks in front of an entered value. "0", "0.5"
    // and "" are preserved. Applies site-wide since every field uses this Input.
    const handleChange =
      type === "number" && onChange
        ? (e: React.ChangeEvent<HTMLInputElement>) => {
            const v = e.target.value;
            if (/^0\d/.test(v)) {
              e.target.value = v.replace(/^0+(?=\d)/, "");
            }
            onChange(e);
          }
        : onChange;
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        onChange={handleChange}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
