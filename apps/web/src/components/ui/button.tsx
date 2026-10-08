import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
export function Button({
  asChild = false,
  variant = "default",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?: boolean;
  variant?: "default" | "secondary" | "destructive";
}) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={twMerge(
        clsx(
          "button",
          variant === "secondary" && "secondary",
          variant === "destructive" && "destructive",
          className,
        ),
      )}
      {...props}
    />
  );
}
