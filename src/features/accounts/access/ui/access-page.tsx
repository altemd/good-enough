import type { ReactNode } from "react";

export interface AccountEntryState {
	setupRequired: boolean;
	registrationEnabled: boolean;
	configurationValid: boolean;
}

export function AccessPage({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}) {
	return (
		<main className="mx-auto max-w-3xl p-8">
			<h1 className="mb-4 text-3xl font-bold">{title}</h1>
			{children}
		</main>
	);
}
