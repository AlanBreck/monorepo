import * as Comlink from "comlink"
import type { createLinter as createLinterType } from "./worker.js"
import type { NodeishFilesystemSubset } from "@inlang/plugin"
import { WorkerPrototype as Worker, adapter } from "@inlang/sdk/internal/isomorphic-comlink"
import type { ProjectSettings2 } from "../types/project-settings.js"

import _debug from "debug"
const debug = _debug("sdk-v2:lintReports")

export async function createLintWorker(
	projectPath: string,
	modules: string[],
	fs: Pick<NodeishFilesystemSubset, "readFile" | "readdir" | "mkdir">
) {
	const createLinter = Comlink.wrap<typeof createLinterType>(
		adapter(new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }))
	)

	debug("started lint-worker")

	const fsProxy = Comlink.proxy(fs)
	const linter = await createLinter(projectPath, modules, fsProxy)

	debug("created linter in lint-worker")

	return {
		lint: (settings: ProjectSettings2) => linter.lint(settings),
	}
}
