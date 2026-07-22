import "@tanstack/react-start/server-only";

import type { GatewayLifecycleEvent } from "#/features/inference-gateway/lifecycle-events";

export type GatewayLifecycleEventListener = (
	event: GatewayLifecycleEvent,
) => void;

export interface PrincipalLifecycleEventSource {
	publishToPrincipal(principalId: string, event: GatewayLifecycleEvent): void;
	subscribe(
		principalId: string,
		listener: GatewayLifecycleEventListener,
	): () => void;
}

export function createLiveInferenceEventSource(): PrincipalLifecycleEventSource {
	const listenersByPrincipal = new Map<
		string,
		Set<GatewayLifecycleEventListener>
	>();

	return {
		publishToPrincipal(principalId, event) {
			for (const listener of listenersByPrincipal.get(principalId) ?? []) {
				try {
					listener(event);
				} catch {
					// Observers are isolated from inference and from one another.
				}
			}
		},
		subscribe(principalId, listener) {
			const listeners =
				listenersByPrincipal.get(principalId) ??
				new Set<GatewayLifecycleEventListener>();
			listeners.add(listener);
			listenersByPrincipal.set(principalId, listeners);
			let subscribed = true;

			return () => {
				if (!subscribed) {
					return;
				}
				subscribed = false;
				listeners.delete(listener);
				if (listeners.size === 0) {
					listenersByPrincipal.delete(principalId);
				}
			};
		},
	};
}

export const liveInferenceEventSource = createLiveInferenceEventSource();
