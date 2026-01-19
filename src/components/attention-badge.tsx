import { cn } from "@/lib/utils"

interface AttentionBadgeProps {
  count: number
  className?: string
  size?: "sm" | "md"
}

/**
 * Orange pulsing badge that shows the count of terminals with unseen output.
 * Displayed when terminals have new output that the user hasn't viewed yet.
 */
export function AttentionBadge({ count, className, size = "sm" }: AttentionBadgeProps) {
  if (count === 0) return null

  const sizeClasses = size === "sm"
    ? "h-4 min-w-4 text-[10px]"
    : "h-5 min-w-5 text-xs"

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full px-1 font-medium",
        "bg-orange-500 text-white",
        "animate-pulse shadow-[0_0_8px_rgba(249,115,22,0.6)]",
        sizeClasses,
        className
      )}
    >
      {count}
    </span>
  )
}
