import type { ReactNode } from "react";

export function AccountPageLayout({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}) {
	return (
		<main className="mx-auto max-w-5xl p-8">
			<h1 className="text-3xl font-bold">{title}</h1>
			{children}
		</main>
	);
}
