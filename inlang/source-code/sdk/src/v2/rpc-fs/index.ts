import { asyncIterableTransferHandler } from "./transfer/asyncIterable.js"
import * as Comlink from "comlink"
import { watchOptionsTransferHandler } from "./transfer/watchOptions.js"
import { adapter } from "comlink-node"
import type { NodeishFilesystem } from "@lix-js/fs"
import { nodeishStatsTransferHandler } from "./transfer/nodeishStats.js"

Comlink.transferHandlers.set("asyncIterable", asyncIterableTransferHandler)
Comlink.transferHandlers.set("watchOptions", watchOptionsTransferHandler)
Comlink.transferHandlers.set("NodeishStats", nodeishStatsTransferHandler)

export function makeFsAvailableTo(fs: NodeishFilesystem, ep: Comlink.Endpoint) {
	Comlink.expose(fs, adapter(ep))
}

type FileChangeInfo = { eventType: "rename" | "change"; filename: string | null }

export function getFs(ep: Comlink.Endpoint): NodeishFilesystem {
	const _fs = Comlink.wrap<NodeishFilesystem>(ep)

	return {
		_createPlaceholder: _fs._createPlaceholder,
		_isPlaceholder: _fs._isPlaceholder,
		readlink: _fs.readlink,
		stat: _fs.stat,
		lstat: _fs.lstat,
		rm: _fs.rm,
		rmdir: _fs.rmdir,
		symlink: _fs.symlink,
		unlink: _fs.unlink,
		readdir: _fs.readdir,
		readFile: _fs.readFile as any,
		writeFile: _fs.writeFile,
		mkdir: _fs.mkdir,
		watch: async function* (path, options): AsyncIterable<FileChangeInfo> {
			const signal = options?.signal
			if (signal) delete options.signal

			const remoteAC = signal ? new AbortController() : undefined

			if (signal) {
				signal.onabort = () => {
					remoteAC?.abort(signal.reason)
				}
			}

			yield* await _fs.watch(path, {
				...options,
				signal: remoteAC?.signal,
			})
		},
	}
}
