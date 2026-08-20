import type { ReactNode } from "react";

import { cn } from "#/lib/utils";

interface PageLayoutProps {
	title: string;
	width?: "narrow" | "wide";
	children: ReactNode;
}

function PageLayout({ title, width = "wide", children }: PageLayoutProps) {
	return (
		<main
			className={cn(
				"mx-auto p-8",
				width === "narrow" ? "max-w-3xl" : "max-w-5xl",
			)}
		>
			<h1 className="text-3xl font-bold">{title}</h1>
			{children}
		</main>
	);
}

export { PageLayout };
