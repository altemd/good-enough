import { useState } from "react";

import { Button } from "#/components/ui/button";
import { CopyButton } from "#/components/ui/copy-button";

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
	const [copyFailed, setCopyFailed] = useState(false);

	return (
		<section className="mt-5 rounded border border-warning bg-warning-surface p-4">
			<h2 className="font-bold">{title}</h2>
			<p>{description}</p>
			<code className="my-3 block break-all">{secret}</code>
			<CopyButton
				value={secret}
				label="Copy"
				copiedLabel="Copied"
				onCopyError={() => setCopyFailed(true)}
				className="size-8 hover:bg-warning-surface-strong"
			/>
			<Button
				variant="link"
				className="ml-5 underline"
				type="button"
				onClick={onDismiss}
			>
				Dismiss
			</Button>
			{copyFailed ? (
				<p role="alert" className="mt-3 text-sm text-destructive">
					The secret could not be copied. Select it manually.
				</p>
			) : null}
		</section>
	);
}
