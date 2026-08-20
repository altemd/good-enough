import type * as React from "react";

import { cn } from "#/lib/utils";

function Table({ className, ...props }: React.ComponentProps<"table">) {
	return (
		<div className="relative w-full overflow-x-auto">
			<table className={cn("w-full text-left", className)} {...props} />
		</div>
	);
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
	return <thead className={cn(className)} {...props} />;
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
	return <tbody className={cn(className)} {...props} />;
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
	return <tr className={cn("border-b", className)} {...props} />;
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
	return <th className={cn("px-3 py-3", className)} scope="col" {...props} />;
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
	return <td className={cn("px-3 py-3", className)} {...props} />;
}

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell };
