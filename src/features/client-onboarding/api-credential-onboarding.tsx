import { useEffect, useMemo, useRef, useState } from "react";

import { CopyButton } from "#/components/ui/copy-button";
import { discoverOpenAiModelIds } from "#/features/inference-gateway/openai-model-discovery";
import { isAbortError } from "#/lib/errors";

import { buildOpenCodeConfigJson } from "./opencode-config";

type DiscoveryState =
	| { status: "loading" }
	| { status: "failed" }
	| { status: "ready"; modelIds: string[] };

export function ApiCredentialOnboarding({
	apiKey,
	onModelsDiscovered,
	onDismiss,
}: {
	apiKey: string;
	onModelsDiscovered?: (modelIds: string[]) => void;
	onDismiss: () => void;
}) {
	const [discovery, setDiscovery] = useState<DiscoveryState>({
		status: "loading",
	});
	const [discoveryAttempt, setDiscoveryAttempt] = useState(0);
	const [keyCopyFailed, setKeyCopyFailed] = useState(false);
	const [configCopyFailed, setConfigCopyFailed] = useState(false);
	const discoveryController = useRef<AbortController | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: the counter intentionally restarts discovery after an explicit retry.
	useEffect(() => {
		const controller = new AbortController();
		discoveryController.current = controller;
		setDiscovery({ status: "loading" });
		void discoverOpenAiModelIds(apiKey, { signal: controller.signal })
			.then((modelIds) => {
				if (!controller.signal.aborted) {
					setDiscovery({ status: "ready", modelIds });
					onModelsDiscovered?.(modelIds);
				}
			})
			.catch((error: unknown) => {
				if (!isAbortError(error) && !controller.signal.aborted) {
					setDiscovery({ status: "failed" });
				}
			});

		return () => controller.abort();
	}, [apiKey, discoveryAttempt, onModelsDiscovered]);

	const configJson = useMemo(
		() =>
			discovery.status === "ready"
				? buildOpenCodeConfigJson({
						apiKey,
						applicationOrigin: window.location.origin,
						modelIds: discovery.modelIds,
					})
				: null,
		[apiKey, discovery],
	);

	return (
		<section className="rounded-3xl border border-warning/30 bg-warning-surface/80 p-5 shadow-xl shadow-black/5 sm:p-6">
			<h2 className="font-semibold">Temporary API key</h2>
			<p className="mt-1 text-sm leading-6 text-warning-foreground/80">
				Copy it before dismissing this panel. It cannot be shown again.
			</p>
			<div className="relative my-3">
				<code className="block break-all rounded-xl border border-warning/30 bg-background/80 p-3 pr-14 text-sm">
					{apiKey}
				</code>
				<CopyButton
					value={apiKey}
					label="Copy temporary API key"
					copiedLabel="Temporary API key copied"
					onCopyError={() => setKeyCopyFailed(true)}
					className="absolute top-2 right-2 size-9 rounded-lg border border-warning/30 bg-background text-warning-foreground/70 shadow-sm hover:bg-warning-surface-strong hover:text-warning-foreground focus-visible:ring-warning"
				/>
			</div>
			{keyCopyFailed ? (
				<p role="alert" className="mt-2 text-destructive">
					The key could not be copied. Select it manually.
				</p>
			) : null}

			<div className="mt-5 border-t border-warning/30 pt-5">
				<h3 className="font-semibold">OpenCode configuration</h3>
				{discovery.status === "loading" ? (
					<p className="mt-3 text-sm" aria-live="polite">
						Discovering available models…
					</p>
				) : null}
				{discovery.status === "failed" ? (
					<div className="mt-3 text-sm" role="alert">
						<p>
							The OpenCode configuration could not be generated. Your key is
							still valid. Make sure a model is available and try again.
						</p>
						<button
							type="button"
							className="mt-2 rounded underline focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none"
							onClick={() => setDiscoveryAttempt((attempt) => attempt + 1)}
						>
							Retry model discovery
						</button>
					</div>
				) : null}
				{configJson ? (
					<>
						<section
							className="relative mt-3"
							aria-label="OpenCode configuration"
						>
							<pre className="max-h-72 overflow-auto rounded-xl bg-terminal p-4 pr-14 text-xs text-terminal-fg">
								<code>{configJson}</code>
							</pre>
							<CopyButton
								value={configJson}
								label="Copy OpenCode configuration"
								copiedLabel="OpenCode configuration copied"
								onCopyError={() => setConfigCopyFailed(true)}
								className="absolute top-2 right-2 size-9 rounded-lg border border-terminal-raised-border bg-terminal-raised text-terminal-muted shadow-sm hover:bg-terminal-border hover:text-terminal-fg focus-visible:ring-terminal-info"
							/>
						</section>
						{configCopyFailed ? (
							<p role="alert" className="mt-2 text-destructive">
								The JSON could not be copied. Select it manually.
							</p>
						) : null}
					</>
				) : null}

				<p className="mt-4 text-xs leading-5 text-warning-foreground/80">
					Save the complete JSON as
					<code className="ml-1">~/.config/opencode/opencode.json</code>, or as
					<code className="ml-1">opencode.json</code> in a project. If a config
					already exists, merge its <code>provider.good-enough</code> entry.
				</p>
				<p className="mt-2 text-xs leading-5 font-medium text-warning-foreground">
					The JSON contains the plaintext API key. Do not commit, share, or
					publish it.
				</p>
			</div>

			<p className="mt-5 border-t border-warning/30 pt-4 text-xs leading-5 text-warning-foreground/75">
				Inference content is not persisted. Live request timing is not replayed
				after refresh.
			</p>

			<button
				type="button"
				className="mt-4 rounded text-sm underline focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none"
				onClick={() => {
					discoveryController.current?.abort();
					onDismiss();
				}}
			>
				Dismiss
			</button>
		</section>
	);
}
