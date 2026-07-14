import { cn } from "@/lib/utils";
import { forwardRef, type ButtonHTMLAttributes } from "react";

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "ghost" | "default" }>(
  function Button({ className, variant = "default", ...props }, ref) {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors disabled:opacity-50",
          variant === "ghost"
            ? "hover:bg-bg text-muted hover:text-ink"
            : "bg-brand text-white hover:opacity-95",
          className,
        )}
        {...props}
      />
    );
  },
);
