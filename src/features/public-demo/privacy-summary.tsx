import { ShieldCheck } from "lucide-react";

export function PrivacySummary() {
	return (
		<section
			className="rounded-2xl border border-success/30 bg-success-surface/80 p-5 text-success-foreground shadow-xs"
			aria-labelledby="privacy-title"
		>
			<div className="flex items-center gap-2">
				<ShieldCheck className="size-5 text-success" />
				<h2 id="privacy-title" className="font-semibold">
					What gets stored?
				</h2>
			</div>
			<p className="mt-3 text-sm leading-6">
				Good Enough does not persist inference content: your prompts, responses,
				reasoning, and tool arguments are not saved.
			</p>
			<ul className="mt-3 grid gap-2 text-xs leading-5 text-success-foreground/80 xl:grid-cols-2 xl:gap-x-6">
				<li>
					The temporary key and chat history exist only in this browser tab;
					refreshing the page or dismissing the key clears them.
				</li>
				<li>
					If you create an account, the server stores only the records needed
					for the account, session, and API keys.
				</li>
				<li>
					Anonymous hourly counts of rendered landing views, demo keys, and demo
					request outcomes are retained as aggregate metrics. They contain no
					identifiers or inference content.
				</li>
			</ul>
		</section>
	);
}
