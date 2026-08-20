import { KeyRound } from "lucide-react";

import { Button } from "#/components/ui/button";

interface LandingHeroProps {
	isSubmitting: boolean;
	error: string | null;
	onStartDemo: () => void;
}

export function LandingHero({
	isSubmitting,
	error,
	onStartDemo,
}: LandingHeroProps) {
	return (
		<section className="lg:sticky lg:top-10">
			<h1 className="max-w-2xl text-4xl leading-[1.05] font-semibold tracking-tight sm:text-6xl">
				Are local models good enough?
			</h1>
			<p className="mt-5 max-w-lg text-lg leading-8 text-muted-foreground">
				Good Enough is a personal project built to help you find out. It runs
				local models on a 128 GB AMD Ryzen AI Max+ 395 (Strix Halo) and exposes
				them through OpenAI- and Anthropic-compatible APIs.
			</p>
			<p className="mt-4 max-w-lg leading-7 text-muted-foreground">
				The button generates a free temporary API key that works for one hour.
				You can use it in the chat here or copy it into your own client. No
				account or payment is required.
			</p>
			<Button
				className="mt-7"
				size="lg"
				type="button"
				disabled={isSubmitting}
				onClick={onStartDemo}
			>
				<KeyRound data-icon="inline-start" />
				{isSubmitting ? "Generating API key…" : "Get a free one-hour API key"}
			</Button>
			{error ? (
				<p
					className="mt-5 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive"
					role="alert"
				>
					{error}
				</p>
			) : null}
		</section>
	);
}
