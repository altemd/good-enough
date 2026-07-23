import { Button } from "#/components/ui/button";

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
	return (
		<section className="mt-5 rounded border border-amber-500 bg-amber-50 p-4">
			<h2 className="font-bold">{title}</h2>
			<p>{description}</p>
			<code className="my-3 block break-all">{secret}</code>
			<Button
				variant="link"
				className="underline"
				type="button"
				onClick={() => navigator.clipboard.writeText(secret)}
			>
				Copy
			</Button>
			<Button
				variant="link"
				className="ml-5 underline"
				type="button"
				onClick={onDismiss}
			>
				Dismiss
			</Button>
		</section>
	);
}
