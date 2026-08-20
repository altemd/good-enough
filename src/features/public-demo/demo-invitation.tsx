import { KeyRound } from "lucide-react";

export function DemoInvitation() {
	return (
		<aside className="rounded-3xl border bg-card p-6 text-card-foreground shadow-xl shadow-black/5 sm:p-8">
			<div className="flex items-start gap-3">
				<span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-muted">
					<KeyRound className="size-5" />
				</span>
				<div>
					<h2 className="font-semibold">What the button does</h2>
					<p className="mt-2 text-sm leading-6 text-muted-foreground">
						It creates an API key and shows it once in this browser tab. The key
						can call the OpenAI- and Anthropic-compatible endpoints, and the
						built-in chat uses the same API.
					</p>
				</div>
			</div>
			<p className="mt-7 rounded-2xl bg-muted/60 p-4 text-sm leading-6 text-muted-foreground">
				The key is free, requires no account, and expires one hour after it is
				created. Requests go to llama.cpp on this machine rather than to OpenAI
				or Anthropic; compatibility refers to the API format.
			</p>
		</aside>
	);
}
