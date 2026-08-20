import { useState } from "react";

import { Button } from "#/components/ui/button";

type CopyState = "idle" | "copied" | "failed";

export function DisplayOnceSecret({
	title,
	description,
	secret,
	onDismiss,
}: {
	title: string;
	description: string;
	secret: string;
	onDismiss: () => void;
}) {
	const [copyState, setCopyState] = useState<CopyState>("idle");

	async function copySecret() {
		try {
			await navigator.clipboard.writeText(secret);
			setCopyState("copied");
		} catch {
			setCopyState("failed");
		}
	}

	return (
		<section className="mt-5 rounded border border-warning bg-warning-surface p-4">
			<h2 className="font-bold">{title}</h2>
			<p>{description}</p>
			<code className="my-3 block break-all">{secret}</code>
			<Button
				variant="link"
				className="underline"
				type="button"
				onClick={() => void copySecret()}
			>
				{copyState === "copied" ? "Copied" : "Copy"}
			</Button>
			<Button
				variant="link"
				className="ml-5 underline"
				type="button"
				onClick={onDismiss}
			>
				Dismiss
			</Button>
			{copyState === "failed" ? (
				<p role="alert" className="mt-3 text-sm text-destructive">
					The secret could not be copied. Select it manually.
				</p>
			) : null}
		</section>
	);
}
