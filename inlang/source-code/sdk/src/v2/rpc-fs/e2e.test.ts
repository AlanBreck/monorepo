import { describe, it, expect } from "vitest"
import { makeFsAvailableTo } from "./index.js"
import { getFs } from "./index.js"
import { createNodeishMemoryFs } from "@lix-js/fs"

describe("rpc-fs", () => {
	it("can expose a filesystem over rpc", async () => {
		const fs = createNodeishMemoryFs()
		const { port1, port2 } = new MessageChannel()

		makeFsAvailableTo(fs, port1)
		const _fs = getFs(port2)

		_fs.writeFile("/test.txt", "hello")
		const content = await _fs.readFile("/test.txt", { encoding: "utf-8" })
		expect(content).toBe("hello")
	})

	it("can watch over rpc", async () => {
		const fs = createNodeishMemoryFs()
		const { port1, port2 } = new MessageChannel()

		makeFsAvailableTo(fs, port1)
		const _fs = getFs(port2)

		async function startWatching(path: string, signal: AbortSignal) {
			const updates = []
			const watcher = _fs.watch(path, { signal })
			try {
				// eslint-disable-next-line @typescript-eslint/no-unused-vars
				for await (const ev of watcher) {
					const newContent = await _fs.readFile("/test.txt", { encoding: "utf-8" })
					console.info("file changed", newContent)
					updates.push(newContent)
				}

				return updates
			} catch (err: unknown) {
				console.info("done", err)
				return updates
			}
		}

		const ac = new AbortController()

		const watcherPromise = startWatching("/test.txt", ac.signal)
		await new Promise((resolve) => setTimeout(resolve, 300))

		await fs.writeFile("/test.txt", "update 1")
		await new Promise((resolve) => setTimeout(resolve, 300))
		await fs.writeFile("/test.txt", "update 2")

		await new Promise((resolve) => setTimeout(resolve, 300))

		ac.abort()
		const updates = await watcherPromise
		expect(updates).toEqual(["update 1", "update 2"])
	})
})
