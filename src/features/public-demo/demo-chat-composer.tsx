import { Send, Square } from "lucide-react";
import type { SubmitEventHandler } from "react";

import { Button } from "#/components/ui/button";
import { Textarea } from "#/components/ui/textarea";

const MAX_PROMPT_CHARACTERS = 4_000;

export function DemoChatComposer({
	prompt,
	modelReady,
	isStreaming,
	error,
	onPromptChange,
	onSubmit,
	onStop,
}: {
	prompt: string;
	modelReady: boolean;
	isStreaming: boolean;
	error: string | null;
	onPromptChange: (value: string) => void;
	onSubmit: SubmitEventHandler<HTMLFormElement>;
	onStop: () => void;
}) {
	return (
		<form className="border-t p-4 sm:p-5" onSubmit={onSubmit}>
			<label className="sr-only" htmlFor="demo-prompt">
				Message the local model
			</label>
			<div className="rounded-2xl border bg-background p-3 shadow-xs focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20">
				{/* The wrapper owns the input-group chrome, so the Textarea's own
				    border/background/focus ring is neutralized at the call site. */}
				<Textarea
					id="demo-prompt"
					className="max-h-48 min-h-20 rounded-none border-0 bg-transparent px-1 py-0 leading-6 focus-visible:border-transparent focus-visible:ring-0"
					placeholder="Message the local model…"
					value={prompt}
					maxLength={MAX_PROMPT_CHARACTERS}
					disabled={!modelReady || isStreaming}
					onChange={(event) => onPromptChange(event.currentTarget.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							event.currentTarget.form?.requestSubmit();
						}
					}}
				/>
				<div className="mt-2 flex items-center gap-3">
					<span className="text-xs text-muted-foreground">
						{prompt.length.toLocaleString()} /{" "}
						{MAX_PROMPT_CHARACTERS.toLocaleString()}
					</span>
					{isStreaming ? (
						<Button
							className="ml-auto"
							type="button"
							variant="outline"
							onClick={onStop}
						>
							<Square data-icon="inline-start" />
							Stop
						</Button>
					) : (
						<Button
							className="ml-auto"
							type="submit"
							disabled={!modelReady || prompt.trim().length === 0}
						>
							<Send data-icon="inline-start" />
							Send
						</Button>
					)}
				</div>
			</div>
			{error ? (
				<p className="mt-3 text-sm text-destructive" role="alert">
					{error}
				</p>
			) : null}
		</form>
	);
}
