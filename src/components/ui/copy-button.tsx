import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { cn } from "#/lib/utils";

interface CopyButtonProps extends React.ComponentProps<"button"> {
	value: string;
	label: string;
	copiedLabel: string;
	onCopyError?: () => void;
}

function CopyButton({
	value,
	label,
	copiedLabel,
	onCopyError,
	className,
	...props
}: CopyButtonProps) {
	const [copied, setCopied] = useState(false);

	async function handleCopy() {
		try {
			await navigator.clipboard.writeText(value);
			setCopied(true);
		} catch {
			setCopied(false);
			onCopyError?.();
		}
	}

	return (
		<button
			type="button"
			aria-label={copied ? copiedLabel : label}
			title={copied ? "Copied" : "Copy"}
			className={cn(
				"inline-flex items-center justify-center rounded-lg transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
				className,
			)}
			onClick={() => void handleCopy()}
			{...props}
		>
			{copied ? <Check className="size-4" /> : <Copy className="size-4" />}
		</button>
	);
}

export { CopyButton };
