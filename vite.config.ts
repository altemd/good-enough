import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, loadEnv } from "vite";

const additionalAllowedHostsKey = "__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS";

const config = defineConfig(({ mode }) => {
	const environment = loadEnv(mode, process.cwd(), additionalAllowedHostsKey);
	const allowedHosts = (environment[additionalAllowedHostsKey] ?? "")
		.split(",")
		.map((host) => host.trim())
		.filter(Boolean);

	return {
		resolve: { tsconfigPaths: true },
		server: { allowedHosts },
		plugins: [
			devtools(),
			nitro({ rollupConfig: { external: [/^@sentry\//] } }),
			tailwindcss(),
			tanstackStart(),
			viteReact(),
		],
	};
});

export default config;
