import { createRuntimeOrchestrator } from "./inference-gateway-smoke/orchestration.mjs";
import { runGatewayScenarios } from "./inference-gateway-smoke/scenarios.mjs";

const runtime = createRuntimeOrchestrator();

for (const signal of ["SIGINT", "SIGTERM"]) {
	process.once(signal, () => {
		void runtime.stop().finally(() => {
			process.exit(signal === "SIGINT" ? 130 : 143);
		});
	});
}

try {
	await runGatewayScenarios(await runtime.start());
} catch (error) {
	const applicationStdout = runtime.readApplicationStdout();
	const applicationStderr = runtime.readApplicationStderr();
	if (applicationStdout) {
		console.error("Built server stdout:\n", applicationStdout);
	}
	if (applicationStderr) {
		console.error("Built server stderr:\n", applicationStderr);
	}
	throw error;
} finally {
	await runtime.stop();
}
