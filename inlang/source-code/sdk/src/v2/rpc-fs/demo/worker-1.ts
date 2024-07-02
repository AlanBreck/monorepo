import { loadProject } from "../../loadProject2.js"
import { getFs } from "../client.js"

const fs = getFs()

const repo = {
	nodeishFs: fs,
	getFirstCommitHash: () => "dummy_first_hash",
} as any

const inlangProject = await loadProject({
	projectPath: "/teroject.inlang",
	repo: repo,
})

// @ts-ignore
inlangProject.settings.subscribe((settings) => console.info("worker settings", settings))
inlangProject.messageBundleCollection
	.find()
	.$.subscribe((msg) => console.info("worker messages", msg))
