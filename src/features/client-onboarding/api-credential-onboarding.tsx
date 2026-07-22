import { Check, Copy } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { discoverOpenAiModelIds } from "#/features/inference-gateway/openai-model-discovery";

import { buildOpenCodeConfigJson } from "./opencode-config";

type DiscoveryState =
	| { status: "loading" }
	| { status: "failed" }
	| { status: "ready"; modelIds: string[] };

type CopyState = "idle" | "copied" | "failed";

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
	const [keyCopyState, setKeyCopyState] = useState<CopyState>("idle");
	const [configCopyState, setConfigCopyState] = useState<CopyState>("idle");
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

	async function copy(value: string, setState: (state: CopyState) => void) {
		try {
			await navigator.clipboard.writeText(value);
			setState("copied");
		} catch {
			setState("failed");
		}
	}

	return (
		<section className="rounded-3xl border border-amber-200 bg-amber-50/80 p-5 shadow-xl shadow-black/5 sm:p-6">
			<h2 className="font-semibold">Temporary API key</h2>
			<p className="mt-1 text-sm leading-6 text-amber-950/80">
				Copy it before dismissing this panel. It cannot be shown again.
			</p>
			<div className="relative my-3">
				<code className="block break-all rounded-xl border border-amber-200 bg-white/80 p-3 pr-14 text-sm">
					{apiKey}
				</code>
				<button
					type="button"
					className="absolute top-2 right-2 flex size-9 items-center justify-center rounded-lg border border-amber-200 bg-white text-amber-950/70 shadow-sm transition-colors hover:bg-amber-100 hover:text-amber-950 focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:outline-none"
					aria-label={
						keyCopyState === "copied"
							? "Temporary API key copied"
							: "Copy temporary API key"
					}
					title={keyCopyState === "copied" ? "Copied" : "Copy"}
					onClick={() => void copy(apiKey, setKeyCopyState)}
				>
					{keyCopyState === "copied" ? (
						<Check className="size-4" />
					) : (
						<Copy className="size-4" />
					)}
				</button>
			</div>
			{keyCopyState === "failed" ? (
				<p role="alert" className="mt-2 text-red-700">
					The key could not be copied. Select it manually.
				</p>
			) : null}

			<div className="mt-5 border-t border-amber-200 pt-5">
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
							className="mt-2 underline"
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
							<pre className="max-h-72 overflow-auto rounded-xl bg-slate-950 p-4 pr-14 text-xs text-slate-50">
								<code>{configJson}</code>
							</pre>
							<button
								type="button"
								className="absolute top-2 right-2 flex size-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-300 shadow-sm transition-colors hover:bg-slate-800 hover:text-white focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:outline-none"
								aria-label={
									configCopyState === "copied"
										? "OpenCode configuration copied"
										: "Copy OpenCode configuration"
								}
								title={configCopyState === "copied" ? "Copied" : "Copy"}
								onClick={() => void copy(configJson, setConfigCopyState)}
							>
								{configCopyState === "copied" ? (
									<Check className="size-4" />
								) : (
									<Copy className="size-4" />
								)}
							</button>
						</section>
						{configCopyState === "failed" ? (
							<p role="alert" className="mt-2 text-red-700">
								The JSON could not be copied. Select it manually.
							</p>
						) : null}
					</>
				) : null}

				<p className="mt-4 text-xs leading-5 text-amber-950/80">
					Save the complete JSON as
					<code className="ml-1">~/.config/opencode/opencode.json</code>, or as
					<code className="ml-1">opencode.json</code> in a project. If a config
					already exists, merge its <code>provider.good-enough</code> entry.
				</p>
				<p className="mt-2 text-xs leading-5 font-medium text-amber-900">
					The JSON contains the plaintext API key. Do not commit, share, or
					publish it.
				</p>
			</div>

			<p className="mt-5 border-t border-amber-200 pt-4 text-xs leading-5 text-amber-950/75">
				Inference content is not persisted. Live request timing is not replayed
				after refresh.
			</p>

			<button
				type="button"
				className="mt-4 text-sm underline"
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

function isAbortError(error: unknown) {
	return error instanceof DOMException && error.name === "AbortError";
}
