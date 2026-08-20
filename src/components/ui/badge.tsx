import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "#/lib/utils";

const badgeVariants = cva(
	"inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
	{
		variants: {
			tone: {
				neutral: "border-transparent bg-muted text-muted-foreground",
				success:
					"border-success/30 bg-success-surface-strong text-success-foreground",
				warning: "border-warning/30 bg-warning-surface text-warning-foreground",
				error:
					"border-destructive/30 bg-destructive-surface text-destructive-foreground",
				info: "border-info/30 bg-info-surface text-info-foreground",
			},
		},
		defaultVariants: {
			tone: "neutral",
		},
	},
);

function Badge({
	className,
	tone,
	...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
	return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export { Badge, badgeVariants };
