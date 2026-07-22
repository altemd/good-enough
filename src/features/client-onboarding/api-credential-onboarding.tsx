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
		<section className="mt-5 rounded border border-amber-500 bg-amber-50 p-4">
			<h2 className="font-bold">Copy this key now</h2>
			<p>It cannot be shown again after you dismiss this panel.</p>
			<p className="mt-2 text-sm leading-6 text-amber-950/80">
				Prompts, responses, reasoning, and tool arguments are never persisted.
				Registered users can view private request timing only while their live
				console is connected; it is not replayed after refresh.
			</p>
			<code className="my-3 block break-all">{apiKey}</code>
			<button
				type="button"
				className="underline"
				onClick={() => void copy(apiKey, setKeyCopyState)}
			>
				{copyLabel("Copy key", keyCopyState)}
			</button>
			{keyCopyState === "failed" ? (
				<p role="alert" className="mt-2 text-red-700">
					The key could not be copied. Select it manually.
				</p>
			) : null}

			<div className="mt-6 border-t border-amber-300 pt-5">
				<h3 className="font-bold">OpenCode configuration</h3>
				<p className="mt-1">
					Paste this complete JSON into the global OpenCode configuration at
					<code className="ml-1">~/.config/opencode/opencode.json</code>. Create
					the directory and file if they do not exist. If you already have a
					config, merge the <code>provider.good-enough</code> entry instead of
					replacing the file.
				</p>
				<p className="mt-2">
					For project-only configuration, use <code>opencode.json</code> in the
					project root.
				</p>
				<p className="mt-2 font-medium text-amber-900">
					This JSON contains your plaintext API key. If you use the project
					file, exclude it from version control. Do not commit, share, or
					publish it.
				</p>

				{discovery.status === "loading" ? (
					<p className="mt-4" aria-live="polite">
						Discovering available models…
					</p>
				) : null}
				{discovery.status === "failed" ? (
					<div className="mt-4" role="alert">
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
							className="relative mt-4"
							aria-label="OpenCode configuration"
						>
							<pre className="max-h-96 overflow-auto rounded bg-slate-950 p-4 pr-14 text-sm text-slate-50">
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
			</div>

			<button
				type="button"
				className="mt-6 underline"
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

function copyLabel(label: string, state: CopyState) {
	if (state === "copied") return "Copied";
	if (state === "failed") return "Copy failed";
	return label;
}

function isAbortError(error: unknown) {
	return error instanceof DOMException && error.name === "AbortError";
}
