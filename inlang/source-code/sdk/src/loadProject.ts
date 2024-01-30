/* eslint-disable @typescript-eslint/no-non-null-assertion */
import type {
	InlangProject,
	InstalledMessageLintRule,
	InstalledPlugin,
	Subscribable,
} from "./api.js"
import { type ImportFunction, resolveModules } from "./resolve-modules/index.js"
import { TypeCompiler, ValueErrorType } from "@sinclair/typebox/compiler"
import {
	ProjectSettingsFileJSONSyntaxError,
	ProjectSettingsFileNotFoundError,
	ProjectSettingsInvalidError,
	PluginLoadMessagesError,
	PluginSaveMessagesError,
	LoadProjectInvalidArgument,
	LoadMessageError,
	SaveMessageError,
} from "./errors.js"
import { createRoot, createSignal, createEffect } from "./reactivity/solid.js"
import { createMessagesQuery } from "./createMessagesQuery.js"
import { createMessageLintReportsQuery } from "./createMessageLintReportsQuery.js"
import { ProjectSettings, Message, type NodeishFilesystemSubset } from "./versionedInterfaces.js"
import { tryCatch, type Result } from "@inlang/result"
import { migrateIfOutdated } from "@inlang/project-settings/migration"
import { createNodeishFsWithAbsolutePaths } from "./createNodeishFsWithAbsolutePaths.js"
import { normalizePath, type NodeishFilesystem, getDirname } from "@lix-js/fs"
import { isAbsolutePath } from "./isAbsolutePath.js"
import { maybeMigrateToDirectory } from "./migrations/migrateToDirectory.js"

import {
	getMessageIdFromPath,
	getPathFromMessageId,
	parseMessage,
	stringifyMessage as stringifyMessage,
} from "./storage/helper.js"

import { humanIdHash } from "./storage/human-id/human-readable-id.js"

import type { Repository } from "@lix-js/client"
import { createNodeishFsWithWatcher } from "./createNodeishFsWithWatcher.js"

import { maybeCreateFirstProjectId } from "./migrations/maybeCreateFirstProjectId.js"

import { capture } from "./telemetry/capture.js"
import { identifyProject } from "./telemetry/groupIdentify.js"
import type { NodeishStats } from "../../../../lix/source-code/fs/dist/NodeishFilesystemApi.js"

const settingsCompiler = TypeCompiler.Compile(ProjectSettings)

// TODO #1844 this should be part of the project if we have multiple instances running in the same project
let messageDirtyFlags = {} as {
	[messageId: string] : boolean;
};

const messageLoadHash = {} as {
	[messageId: string] : string;
}

/**
 * @param projectPath - Absolute path to the inlang settings file.
 * @param repo - An instance of a lix repo as returned by `openRepository`.
 * @param _import - Use `_import` to pass a custom import function for testing,
 *   and supporting legacy resolvedModules such as CJS.
 * @param appId - The app id to use for telemetry e.g "app.inlang.badge"
 *
 */
export async function loadProject(args: {
	projectPath: string
	repo: Repository
	appId?: string
	_import?: ImportFunction
}): Promise<InlangProject> {
	const projectPath = normalizePath(args.projectPath)

	// -- validation --------------------------------------------------------
	// the only place where throwing is acceptable because the project
	// won't even be loaded. do not throw anywhere else. otherwise, apps
	// can't handle errors gracefully.

	if (!isAbsolutePath(args.projectPath)) {
		throw new LoadProjectInvalidArgument(
			`Expected an absolute path but received "${args.projectPath}".`,
			{ argument: "projectPath" }
		)
	} else if (/[^\\/]+\.inlang$/.test(projectPath) === false) {
		throw new LoadProjectInvalidArgument(
			`Expected a path ending in "{name}.inlang" but received "${projectPath}".\n\nValid examples: \n- "/path/to/micky-mouse.inlang"\n- "/path/to/green-elephant.inlang\n`,
			{ argument: "projectPath" }
		)
	}

	const fs = args.repo.nodeishFs

	const nodeishFs = createNodeishFsWithAbsolutePaths({
		projectPath,
		nodeishFs: fs,
	})

	// -- migratations ------------------------------------------------

	await maybeMigrateToDirectory({ nodeishFs: fs, projectPath })
	await maybeCreateFirstProjectId({ projectPath, repo: args.repo })

	// -- load project ------------------------------------------------------

	return await createRoot(async () => {
		// TODO remove tryCatch after https://github.com/opral/monorepo/issues/2013
		// - a repo will always be present
		// - if a repo is present, the project id will always be present
		const { data: projectId } = await tryCatch(() =>
			fs.readFile(args.projectPath + "/project_id", { encoding: "utf-8" })
		)

		const [initialized, markInitAsComplete, markInitAsFailed] = createAwaitable()
		// -- settings ------------------------------------------------------------

		const [settings, _setSettings] = createSignal<ProjectSettings>()
		createEffect(() => {
			// TODO:
			// if (projectId) {
			// 	telemetryBrowser.group("project", projectId, {
			// 		name: projectId,
			// 	})
			// }

			loadSettings({ settingsFilePath: projectPath + "/settings.json", nodeishFs })
				.then((settings) => setSettings(settings))
				.catch((err) => {
					markInitAsFailed(err)
				})
		})
		// TODO: create FS watcher and update settings on change

		const writeSettingsToDisk = skipFirst((settings: ProjectSettings) =>
			_writeSettingsToDisk({ nodeishFs, settings, projectPath })
		)

		const setSettings = (settings: ProjectSettings): Result<void, ProjectSettingsInvalidError> => {
			try {
				const validatedSettings = parseSettings(settings)
				_setSettings(validatedSettings)

				writeSettingsToDisk(validatedSettings)
				return { data: undefined }
			} catch (error: unknown) {
				if (error instanceof ProjectSettingsInvalidError) {
					return { error }
				}

				throw new Error(
					"Unhandled error in setSettings. This is an internal bug. Please file an issue."
				)
			}
		}

		// -- resolvedModules -----------------------------------------------------------

		const [resolvedModules, setResolvedModules] =
			createSignal<Awaited<ReturnType<typeof resolveModules>>>()

		createEffect(() => {
			const _settings = settings()
			if (!_settings) return

			resolveModules({ settings: _settings, nodeishFs, _import: args._import })
				.then((resolvedModules) => {
					setResolvedModules(resolvedModules)
				})
				.catch((err) => markInitAsFailed(err))
		})

		// -- messages ----------------------------------------------------------

		let settingsValue: ProjectSettings
		createEffect(() => (settingsValue = settings()!)) // workaround to not run effects twice (e.g. settings change + modules change) (I'm sure there exists a solid way of doing this, but I haven't found it yet)

		// please don't use this as source of truth, use the query instead
		// needed for granular linting
		const [messages, setMessages] = createSignal<Message[]>()

		const [messageLoadErrors, setMessageLoadErrors] = createSignal<{
			[messageId: string]: Error
		}>({})

		const [messageSaveErrors, setMessageSaveErrors] = createSignal<{
			[messageId: string]: Error
		}>({})

		const messageBaseFolderFolderPath = projectPath + "/messages"
		const messageFolderPath = messageBaseFolderFolderPath + "/v1"

		createEffect(() => {
			// wait for first effect excution until modules are resolved
			const _resolvedModules = resolvedModules()
			if (!_resolvedModules) return

			/*
			// -- initial load of all messages found in the messages folder ----------
			// TODO #1844 branche persistence strategy - only execute this one when we are running on a project without load- /saveMessages Plugin
			const loadAndSetMessages = async (fs: NodeishFilesystemSubset) => {
				const loadedMessages: Message[] = []

				try {
					// make sure the message folder exists within the .inlang folder
					try {
						await fs.mkdir(messageBaseFolderFolderPath, { recursive: true })
					} catch (e) {
						if ((e as any).code !== "EEXIST") {
							throw e
						}
					}

					try {
						await fs.mkdir(messageFolderPath, { recursive: true })
					} catch (e) {
						if ((e as any).code !== "EEXIST") {
							throw e
						}
					}

					// helper function that traverses recursivly through the tree
					const readFilesFromFolderRecursive = async (
						fileSystem: NodeishFilesystemSubset,
						rootPath: string,
						pathToRead: string
					) => {
						let filePaths: string[] = []
						const paths = await fileSystem.readdir(rootPath + pathToRead)
						for (const path of paths) {
							// TODO #1844 CLEARIFY Felix FILESYSTEM - what is inlangs best practice to handle other file systems atm?
							const stat = await fileSystem.stat(rootPath + pathToRead + "/" + path)

							if (stat.isDirectory()) {
								const subfolderPaths = await readFilesFromFolderRecursive(
									fileSystem,
									rootPath,
									// TODO #1844 CLEARIFY Felix FILESYSTEM - what is inlangs best practice to handle other file systems atm?
									pathToRead + "/" + path
								)
								filePaths = filePaths.concat(subfolderPaths)
							} else {
								// TODO #1844 CLEARIFY Felix FILESYSTEM - what is inlangs best practice to handle other file systems atm?
								filePaths.push(pathToRead + "/" + path)
							}
						}
						return filePaths
					}

					const messageFilePaths = await readFilesFromFolderRecursive(fs, messageFolderPath, "")
					const parallelMessageLoad = []
					for (const messageFilePath of messageFilePaths) {
						const messageId = getMessageIdFromPath(messageFilePath)
						if (!messageId) {
							// ignore files not matching the expected id file path
							continue
						}
						parallelMessageLoad.push(async () => {
							try {
								const messageRaw = await fs.readFile(`${messageFolderPath}${messageFilePath}`, {
									encoding: "utf-8",
								})

								const message = parseMessage(messageFilePath, messageRaw) as Message

								// if we end up here - message parsing was successfull remove entry in erros map if it exists
								const _messageLoadErrors = { ...messageLoadErrors() }
								delete _messageLoadErrors[messageId]
								setMessageLoadErrors(messageLoadErrors)

								loadedMessages.push(message)
							} catch (e) {
								// TODO #1844 FINK - test errors being propagated - fink doesnt show errors other than lints at the moment... -> move to new issue
								// if reading of a single message fails we propagate the error to the project errors
								messageLoadErrors()[messageId] = new LoadMessageError({
									path: messageFilePath,
									messageId,
									cause: e,
								})
								setMessageLoadErrors(messageLoadErrors)
							}
						})
					}

					await Promise.all(parallelMessageLoad)

					setMessages(loadedMessages)

					// TODO #1844 branche persistence strategy - this needs to be called also for projects using loadMessages
					markInitAsComplete()
				} catch (err) {
					markInitAsFailed(new PluginLoadMessagesError({ cause: err }))
				}
			}

			// TODO #1844 branche persistence strategy - watching files in the messages folder is only needed for projects persisting into the inlang messages folder
			// -- subsequencial upsers and delete of messages on file changes ------------
			loadAndSetMessages(nodeishFs).then(() => {
				// when initial message loading is done start watching on file changes in the message dir
				// TODO #1844 this is the place where we attach event listeners to single message files in our own message format - we deactivate this in iteration 1
				/* ;(async () => {
					try {
						// NOTE: We dont use the abortController at the moment - this is the same for the SDK everywhere atm.
						// const abortController = new AbortController()
						const watcher = nodeishFs.watch(messageFolderPath, {
							// signal: abortController.signal,
							persistent: false,
							recursive: true,
						})
						if (watcher) {
							//eslint-disable-next-line @typescript-eslint/no-unused-vars
							for await (const event of watcher) {
								// TODO #1844 remove console log
								// eslint-disable-next-line no-console
								console.log(event)
								if (!event.filename) {
									throw new Error("filename not set in event...")
								}

								const messageId = getMessageIdFromPath(event.filename)
								if (!messageId) {
									// ignore files not matching the expected id file path
									continue
								}

								let fileContent: string | undefined
								try {
									fileContent = await nodeishFs.readFile(messageFolderPath + "/" + event.filename, {
										encoding: "utf-8",
									})
								} catch (e) {
									// check for file not exists error (expected in case of deletion of a message) rethrow on everything else
									if ((e as any).code !== "ENOENT") {
										throw e
									}
								}

								if (!fileContent) {
									// file was deleted - drop the corresponding message
									messagesQuery.delete({ where: { id: messageId } })
								} else {
									try {
										const message = parseMessage(event.filename, fileContent)

										// if we end up here - message parsing was successfull remove entry in erros map if it exists
										const _messageLoadErrors = messageLoadErrors()
										delete _messageLoadErrors[messageId]
										setMessageLoadErrors(_messageLoadErrors)

										const currentMessage = messagesQuery.get({ where: { id: messageId } })
										const currentMessageStringified = stringifyMessage(currentMessage)
										if (currentMessage && currentMessageStringified === fileContent) {
											continue
										}

										messagesQuery.upsert({ where: { id: messageId }, data: message })
									} catch (e) {
										// TODO #1844 FINK - test errors being propagated - fink doesnt show errors other than lints at the moment... -> move to new issue
										messageLoadErrors()[messageId] = new LoadMessageError({
											path: messageFolderPath + "/" + event.filename,
											messageId,
											cause: e,
										})
										setMessageLoadErrors(messageLoadErrors)
									}
								}
							}
						}
					} catch (err: any) {
						if (err.name === "AbortError") return
						throw err
					}
				})() 
			})*/

			setMessages([])
			markInitAsComplete()
		})

		// -- installed items ----------------------------------------------------

		const installedMessageLintRules = () => {
			if (!resolvedModules()) return []
			return resolvedModules()!.messageLintRules.map(
				(rule) =>
					({
						id: rule.id,
						displayName: rule.displayName,
						description: rule.description,
						module:
							resolvedModules()?.meta.find((m) => m.id.includes(rule.id))?.module ??
							"Unknown module. You stumbled on a bug in inlang's source code. Please open an issue.",
						// default to warning, see https://github.com/opral/monorepo/issues/1254
						level: settingsValue["messageLintRuleLevels"]?.[rule.id] ?? "warning",
					} satisfies InstalledMessageLintRule)
			) satisfies Array<InstalledMessageLintRule>
		}

		const installedPlugins = () => {
			if (!resolvedModules()) return []
			return resolvedModules()!.plugins.map((plugin) => ({
				id: plugin.id,
				displayName: plugin.displayName,
				description: plugin.description,
				module:
					resolvedModules()?.meta.find((m) => m.id.includes(plugin.id))?.module ??
					"Unknown module. You stumbled on a bug in inlang's source code. Please open an issue.",
			})) satisfies Array<InstalledPlugin>
		}

		// -- app ---------------------------------------------------------------

		const initializeError: Error | undefined = await initialized.catch((error) => error)

		const abortController = new AbortController()
		const hasWatcher = nodeishFs.watch("/", { signal: abortController.signal }) !== undefined

		const messagesQuery = createMessagesQuery(() => messages() || [])

		const trackedMessages: Map<string, () => void> = new Map()
		let initialSetup = true
		// -- subscribe to all messages and write to files on signal -------------
		createEffect(() => {
			const _resolvedModules = resolvedModules()
			if (!_resolvedModules) return

			const currentMessageIds = messagesQuery.includedMessageIds()
			const deletedTrackedMessages = [...trackedMessages].filter(
				(tracked) => !currentMessageIds.includes(tracked[0])
			)

			// TODO #1844 branche persistence strategy - this could be used to branch between projects with and without load/saveMessages
			const saveMessagesPlugin = _resolvedModules.plugins.find(
				(plugin) => plugin.saveMessages !== undefined
			)

			for (const messageId of currentMessageIds) {
				if (!trackedMessages!.has(messageId!)) {
					// we create a new root to be able to cleanup an effect for a message the got deleted
					createRoot((dispose) => {
						createEffect(() => {
							const message = messagesQuery.get({ where: { id: messageId } })!
							if (!message) {
								return
							}
							if (!trackedMessages?.has(messageId)) {
								// initial effect execution - add dispose function
								trackedMessages?.set(messageId, dispose)
							}

							if (!initialSetup) {
								messageDirtyFlags[message.id] = true
								saveMessagesViaPlugin(
									fs,
									messageBaseFolderFolderPath,
									messagesQuery,
									settings()!,
									saveMessagesPlugin
								)
								/*const persistMessage = async (
									fs: NodeishFilesystemSubset,
									path: string,
									message: Message
								) => {
									// TODO #1844 branche persistence strategy - branch here to those project without the saveMessages
									let dir = getDirname(path)
									dir = dir.endsWith("/") ? dir.slice(0, -1) : dir

									try {
										await fs.mkdir(dir, { recursive: true })
									} catch (e) {
										if ((e as any).code !== "EEXIST") {
											throw e
										}
									}

									await fs.writeFile(path, stringifyMessage(message))

									// TODO #1844 we don't wait for the file to be persisted - investigate could this become a problem when we batch update messages
									// TODO #1844 branche persistence strategy - branch here to those project with the saveMessages
									await saveMessagesViaPlugin(
										fs,
										messageBaseFolderFolderPath,
										messagesQuery,
										settings()!,
										saveMessagesPlugin
									)
									// debouncedSave(messagesQuery.getAll())
								}
								const messageFilePath = messageFolderPath + "/" + getPathFromMessageId(message.id)
								persistMessage(nodeishFs, messageFilePath, message)
									.then(() => {
										const _messageSaveErrors = messageSaveErrors()
										delete _messageSaveErrors[messageId]
										setMessageLoadErrors(_messageSaveErrors)
									})
									.catch((error) => {
										// TODO #1844 FINK - test if errors get propagated -> move to new issue
										// in case saving didn't work (problem during serialization or saving to file) - add to message error array in project
										messageSaveErrors()[messageId] = new SaveMessageError({
											path: messageFilePath,
											messageId,
											cause: error,
										})
										setMessageSaveErrors(messageLoadErrors)
									})*/
							}
						})
					})
				}
			}

			for (const deletedMessage of deletedTrackedMessages) {
				const deletedMessageId = deletedMessage[0]
				/* TODO #1844 code that deletes the message files and calles save messages
				const messageFilePath = messageFolderPath + "/" + getPathFromMessageId(deletedMessageId)
				try {
					// TODO #1844 branche persistence strategy - branch here to those project with / without the saveMessages
					nodeishFs.rm(messageFilePath).then(() => {
						// TODO #1844 we don't wait for the file to be persisted - investigate could this become a problem when we batch update messages
						return saveMessagesViaPlugin(
							nodeishFs,
							messageBaseFolderFolderPath,
							messagesQuery,
							settings()!,
							saveMessagesPlugin
						)
					})

				} catch (e) {
					if ((e as any).code !== "ENOENT") {
						throw e
					}
				}
				*/

				// NOTE: call dispose to cleanup the effect
				const messageEffectDisposeFunction = trackedMessages.get(deletedMessageId)
				if (messageEffectDisposeFunction) {
					messageEffectDisposeFunction()
					trackedMessages.delete(deletedMessageId)
				}
			}

			if (deletedTrackedMessages.length > 0) {
				saveMessagesViaPlugin(
					nodeishFs,
					messageBaseFolderFolderPath,
					messagesQuery,
					settings()!,
					saveMessagesPlugin
				)
			}

			initialSetup = false
		})

		// TODO #1844 deal with wrong messages in inlang folder (change the type one message to something like Text2)

		// run import
		const _resolvedModules = resolvedModules()
		const _settings = settings()

		const fsWithWatcher = createNodeishFsWithWatcher({
			nodeishFs: nodeishFs,
			// this message is called whenever a file changes that was read earlier by this filesystem
			// - the plugin loads messages -> reads the file messages.json -> start watching on messages.json -> updateMessages
			updateMessages: () => {
				// NOTE the current solution does not watch on deletion or creation of a file (if one adds de.json in case of the json plugin we wont recognize this until restart)
				if (_resolvedModules?.resolvedPluginApi.loadMessages && _settings) {
					// get plugin finding the plugin that provides loadMessages function
					const loadMessagePlugin = _resolvedModules.plugins.find(
						(plugin) => plugin.loadMessages !== undefined
					)
					// TODO #1844 check if update is triggered once on setup the fs
					// TODO #1844 remove console log
					// eslint-disable-next-line no-console
					console.log("load messages because of a change in the message.json files")
					// TODO #1844 FINK check error handling for plugin load methods (triggered by file change) -> move to separate ticket
					loadMessagesViaPlugin(
						fsWithWatcher,
						messageBaseFolderFolderPath,
						messagesQuery,
						settings()!,
						loadMessagePlugin
					)
				}
			},
		})
		// initial project setup finished - import all messages using legacy load Messages method
		if (_resolvedModules?.resolvedPluginApi.loadMessages && _settings) {
			// get plugin finding the plugin that provides loadMessages function
			const loadMessagePlugin = _resolvedModules.plugins.find(
				(plugin) => plugin.loadMessages !== undefined
			)
			// TODO #1844 remove console log
			// eslint-disable-next-line no-console
			console.log(
				"Initial load messages  - will also use the filewatcher system and schedule events"
			)
			// TODO #1844 FINK check error handling for plugin load methods (initial load) -> move to separate ticket
			await loadMessagesViaPlugin(
				fsWithWatcher,
				messageBaseFolderFolderPath,
				messagesQuery,
				_settings,
				loadMessagePlugin
			)
		}

		const lintReportsQuery = createMessageLintReportsQuery(
			messagesQuery,
			settings as () => ProjectSettings,
			installedMessageLintRules,
			resolvedModules,
			hasWatcher
		)

		// TODO #1844 INFORM this is no longer needed
		// 	const debouncedSave = skipFirst(
		// 		debounce(
		// 			500,
		// 			async (newMessages) => {
		// 				// entered maximum every 500ms - doesn't mean its finished by that time
		// 				try {
		// 					const loadMessagePlugin = _resolvedModules.plugins.find(
		// 						(plugin) => plugin.loadMessages !== undefined
		// 					)
		// 					const loadPluginId = loadMessagePlugin!.id

		// 					const messagesToExport: Message[] = []
		// 					for (const message of newMessages) {
		// 						const fixedExportMessage = { ...message }
		// 						// TODO #1585 here we match using the id to support legacy load message plugins - after we introduced import / export methods we will use importedMessage.alias
		// 						fixedExportMessage.id =
		// 							fixedExportMessage.alias[loadPluginId] ?? fixedExportMessage.id

		// 						messagesToExport.push(fixedExportMessage)
		// 					}

		// 					// this will execute on the next tick - processing of the maschine translations that returned within the tick will kick in
		// 					await resolvedModules()?.resolvedPluginApi.saveMessages({
		// 						settings: settingsValue,
		// 						messages: messagesToExport,
		// 					})
		// 				} catch (err) {
		// 					throw new PluginSaveMessagesError({
		// 						cause: err,
		// 					})
		// 				}
		// 				const abortController = new AbortController()
		// 				if (
		// 					newMessages.length !== 0 &&
		// 					JSON.stringify(newMessages) !== JSON.stringify(messages()) &&
		// 					nodeishFs.watch("/", { signal: abortController.signal }) !== undefined
		// 				) {
		// 					setMessages(newMessages)
		// 				}
		// 			},
		// 			{ atBegin: false }
		// 		)
		// 	)

		/**
		 * Utility to escape reactive tracking and avoid multiple calls to
		 * the capture event.
		 *
		 * Should be addressed with https://github.com/opral/monorepo/issues/1772
		 */
		let projectLoadedCapturedAlready = false

		if (projectId && projectLoadedCapturedAlready === false) {
			projectLoadedCapturedAlready = true
			// TODO ensure that capture is "awaited" without blocking the the app from starting
			await identifyProject({
				projectId,
				properties: {
					// using the id for now as a name but can be changed in the future
					// we need at least one property to make a project visible in the dashboard
					name: projectId,
				},
			})
			await capture("SDK loaded project", {
				projectId,
				properties: {
					appId: args.appId,
					settings: settings(),
					installedPluginIds: installedPlugins().map((p) => p.id),
					installedMessageLintRuleIds: installedMessageLintRules().map((r) => r.id),
					numberOfMessages: messagesQuery.includedMessageIds().length,
				},
			})
		}

		return {
			id: projectId,
			installed: {
				plugins: createSubscribable(() => installedPlugins()),
				messageLintRules: createSubscribable(() => installedMessageLintRules()),
			},
			errors: createSubscribable(() => [
				...(initializeError ? [initializeError] : []),
				...(resolvedModules() ? resolvedModules()!.errors : []),
				...Object.values(messageLoadErrors()),
				...Object.values(messageSaveErrors()),
				// have a query error exposed
				//...(lintErrors() ?? []),
			]),
			settings: createSubscribable(() => settings() as ProjectSettings),
			setSettings,
			customApi: createSubscribable(() => resolvedModules()?.resolvedPluginApi.customApi || {}),
			query: {
				messages: messagesQuery,
				messageLintReports: lintReportsQuery,
			},
		} satisfies InlangProject
	})
}

//const x = {} as InlangProject

// ------------------------------------------------------------------------------------------------

const loadSettings = async (args: {
	settingsFilePath: string
	nodeishFs: NodeishFilesystemSubset
}) => {
	const { data: settingsFile, error: settingsFileError } = await tryCatch(
		async () => await args.nodeishFs.readFile(args.settingsFilePath, { encoding: "utf-8" })
	)
	if (settingsFileError)
		throw new ProjectSettingsFileNotFoundError({
			cause: settingsFileError,
			path: args.settingsFilePath,
		})

	const json = tryCatch(() => JSON.parse(settingsFile!))

	if (json.error) {
		throw new ProjectSettingsFileJSONSyntaxError({
			cause: json.error,
			path: args.settingsFilePath,
		})
	}
	return parseSettings(json.data)
}

const parseSettings = (settings: unknown) => {
	const withMigration = migrateIfOutdated(settings as any)
	if (settingsCompiler.Check(withMigration) === false) {
		const typeErrors = [...settingsCompiler.Errors(settings)]
		if (typeErrors.length > 0) {
			throw new ProjectSettingsInvalidError({
				errors: typeErrors,
			})
		}
	}

	const { sourceLanguageTag, languageTags } = settings as ProjectSettings
	if (!languageTags.includes(sourceLanguageTag)) {
		throw new ProjectSettingsInvalidError({
			errors: [
				{
					message: `The sourceLanguageTag "${sourceLanguageTag}" is not included in the languageTags "${languageTags.join(
						'", "'
					)}". Please add it to the languageTags.`,
					type: ValueErrorType.String,
					schema: ProjectSettings,
					value: sourceLanguageTag,
					path: "sourceLanguageTag",
				},
			],
		})
	}

	return withMigration
}

const _writeSettingsToDisk = async (args: {
	projectPath: string
	nodeishFs: NodeishFilesystemSubset
	settings: ProjectSettings
}) => {
	const { data: serializedSettings, error: serializeSettingsError } = tryCatch(() =>
		// TODO: this will probably not match the original formatting
		JSON.stringify(args.settings, undefined, 2)
	)
	if (serializeSettingsError) {
		throw serializeSettingsError
	}

	const { error: writeSettingsError } = await tryCatch(async () =>
		args.nodeishFs.writeFile(args.projectPath + "/settings.json", serializedSettings)
	)

	if (writeSettingsError) {
		throw writeSettingsError
	}
}

// ------------------------------------------------------------------------------------------------

const createAwaitable = () => {
	let resolve: () => void
	let reject: () => void

	const promise = new Promise<void>((res, rej) => {
		resolve = res
		reject = rej
	})

	return [promise, resolve!, reject!] as [
		awaitable: Promise<void>,
		resolve: () => void,
		reject: (e: unknown) => void
	]
}

// ------------------------------------------------------------------------------------------------

// TODO: create global util type
type MaybePromise<T> = T | Promise<T>

const makeTrulyAsync = <T>(fn: MaybePromise<T>): Promise<T> => (async () => fn)()

// Skip initial call, eg. to skip setup of a createEffect
function skipFirst(func: (args: any) => any) {
	let initial = false
	return function (...args: any) {
		if (initial) {
			// @ts-ignore
			return func.apply(this, args)
		}
		initial = true
	}
}

export function createSubscribable<T>(signal: () => T): Subscribable<T> {
	return Object.assign(signal, {
		subscribe: (callback: (value: T) => void) => {
			createEffect(() => {
				callback(signal())
			})
		},
	})
}

// --- serialization of loading / saving messages.
// 1. A plugin saveMessage call can not be called simultaniously to avoid side effects - its an async function not controlled by us
// 2. loading and saving must not run in "parallel".
// - json plugin exports into separate file per language.
// - saving a message in two different languages would lead to a write in de.json first
// - This will leads to a load of the messages and since en.json has not been saved yet the english variant in the message would get overritten with the old state again

let isSaving: boolean
let currentSaveMessagesViaPlugin: Promise<void> | undefined
let sheduledSaveMessages:
	| [awaitable: Promise<void>, resolve: () => void, reject: (e: unknown) => void]
	| undefined

let isLoading = false
let sheduledLoadMessagesViaPlugin:
	| [awaitable: Promise<void>, resolve: () => void, reject: (e: unknown) => void]
	| undefined

/**
 * Messsage that loads messages from a plugin - this method synchronizes with the saveMessage funciton.
 * If a save is in progress loading will wait until saving is done. If another load kicks in during this load it will queue the
 * load and execute it at the end of this load. subsequential loads will not be queued but the same promise will be reused
 *
 * - NOTE: this means that the parameters used to load like settingsValue and loadPlugin might not take into account. this has to be refactored
 * with the loadProject restructuring
 * @param fs
 * @param messagesQuery
 * @param settingsValue
 * @param loadPlugin
 * @returns void - updates the files and messages in of the project in place
 */
async function loadMessagesViaPlugin(
	fs: NodeishFilesystemSubset,
	messagesFolderPath: string,
	//messagesPath: string,
	messagesQuery: InlangProject["query"]["messages"],
	settingsValue: ProjectSettings,
	loadPlugin: any
) {
	// the current approach introuces a sync between both systems - the legacy load / save messages plugins and the new format - we dont delete messages that we don't see int he plugins produced messages array anymore

	// let the current save process finish first
	if (currentSaveMessagesViaPlugin) {
		await currentSaveMessagesViaPlugin
	}

	// loading is an asynchronous process - check if another load is in progress - queue this call if so
	if (isLoading) {
		if (!sheduledLoadMessagesViaPlugin) {
			sheduledLoadMessagesViaPlugin = createAwaitable()
		}
		// another load will take place right after the current one - its goingt to be idempotent form the current requested one - don't reschedule
		return sheduledLoadMessagesViaPlugin[0]
	}

	// set loading flag
	isLoading = true

	// TODO #1844 JL - check if we can remove this
	// const loadPluginId = loadPlugin!.id
	const lockFilePath = messagesFolderPath + "/messages.lockfile"
	const lockTime = await accquireFileLock(fs as NodeishFilesystem, lockFilePath, "loadMessage")
	const loadedMessages = await makeTrulyAsync(
		loadPlugin.loadMessages({
			settings: settingsValue,
			nodeishFs: fs,
		})
	)
	await releaseLock(fs as NodeishFilesystem, lockFilePath, "loadMessage", lockTime)

	for (const loadedMessage of loadedMessages) {
		const currentMessages = messagesQuery
			.getAll()
			// TODO #1585 here we match using the id to support legacy load message plugins - after we introduced import / export methods we will use importedMessage.alias
			.filter((message: any) => message.alias["default"] === loadedMessage.id)

		if (currentMessages.length > 1) {
			// NOTE: if we happen to find two messages witht the sam alias we throw for now
			// - this could be the case if one edits the aliase manualy
			throw new Error("more than one message with the same alias found ")
		} else if (currentMessages.length === 1) {
			// update message in place - leave message id and alias untouched
			loadedMessage.alias = {} as any

			// TODO #1585 we have to map the id of the importedMessage to the alias and fill the id property with the id of the existing message - change when import mesage provides importedMessage.alias
			loadedMessage.alias["default"] = loadedMessage.id
			loadedMessage.id = currentMessages[0]!.id

			// TODO #1844 INFORM stringifyMessage encodes messages independent from key order!
			const importedEnecoded = stringifyMessage(loadedMessage)

			// TODO #1844 use hash instead of the whole object JSON to save memory...
			if (messageLoadHash[loadedMessage.id] === importedEnecoded) {
				continue
			}

			const currentMessageEncoded = stringifyMessage(currentMessages[0]!)
			if (importedEnecoded === currentMessageEncoded) {
				continue
			}

			// NOTE: this might trigger a save before we have the chance to delete - but since save is async and waits for the lock accquired by this method - its save to set the flags afterwards
			messagesQuery.update({ where: { id: loadedMessage.id }, data: loadedMessage })
			// we load a fresh version - lets delete dirty flag that got created by the update
			delete messageDirtyFlags[loadedMessage.id]
			// TODO #1844 use hash instead of the whole object JSON to save memory...
			messageLoadHash[loadedMessage.id] = importedEnecoded
		} else {
			// message with the given alias does not exist so far
			loadedMessage.alias = {} as any
			// TODO #1585 we have to map the id of the importedMessage to the alias - change when import mesage provides importedMessage.alias
			loadedMessage.alias["default"] = loadedMessage.id

			let currentOffset = 0
			let messsageId: string | undefined
			do {
				messsageId = humanIdHash(loadedMessage.id, currentOffset)
				if (messagesQuery.get({ where: { id: messsageId } })) {
					currentOffset += 1
					messsageId = undefined
				}
			} while (messsageId === undefined)

			// create a humanId based on a hash of the alias
			loadedMessage.id = messsageId

			const importedEnecoded = stringifyMessage(loadedMessage)

			// add the message - this will trigger an async file creation in the backgound!
			messagesQuery.create({ data: loadedMessage })
			// we load a fresh version - lets delete dirty flag that got created by the create method
			delete messageDirtyFlags[loadedMessage.id]
			messageLoadHash[loadedMessage.id] = importedEnecoded
		}
	}

	console.log("loadMessagesViaPlugin: " + loadedMessages.length + " Messages processed ")

	isLoading = false

	const executingScheduledMessages = sheduledLoadMessagesViaPlugin
	if (executingScheduledMessages) {
		// a load has been requested during the load - executed it

		// reset sheduling to except scheduling again
		sheduledLoadMessagesViaPlugin = undefined

		// recall load unawaited to allow stack to pop
		loadMessagesViaPlugin(fs, messagesFolderPath, messagesQuery, settingsValue, loadPlugin).then(
			() => {
				executingScheduledMessages[1]()
			},
			(e: Error) => {
				executingScheduledMessages[2](e)
			}
		)
	}
}

async function saveMessagesViaPlugin(
	fs: NodeishFilesystemSubset,
	messagesFolderPath: string,
	messagesQuery: InlangProject["query"]["messages"],
	settingsValue: ProjectSettings,
	savePlugin: any
): Promise<any> {
	// queue next save if we have a save ongoing
	if (isSaving) {
		if (!sheduledSaveMessages) {
			sheduledSaveMessages = createAwaitable()
		}

		return sheduledSaveMessages[0]
	}

	// set isSavingFlag
	isSaving = true

	currentSaveMessagesViaPlugin = (async function () {
		const persistedMessageHashs = {} as { [messageId: string]: string }

		// check if we have any dirty message - witho
		if (Object.keys(messageDirtyFlags).length == 0) {
			// nothing to save :-)
			console.log("save was skiped - no messages marked as dirty...")
			return
		}

		try {
			const lockFilePath = messagesFolderPath + "/messages.lockfile"
			const lockTime = await accquireFileLock(fs as NodeishFilesystem, lockFilePath, "saveMessage")
			if (Object.keys(messageDirtyFlags).length == 0) {
				return
			}

			const currentMessages = messagesQuery.getAll()

			const messagesToExport: Message[] = []
			for (const message of currentMessages) {
				if (messageDirtyFlags[message.id]) {
					const importedEnecoded = stringifyMessage(message)
					// TODO #1844 use hash instead of the whole object JSON to save memory...
					persistedMessageHashs[message.id] = importedEnecoded
				}

				const fixedExportMessage = { ...message }
				// TODO #1585 here we match using the id to support legacy load message plugins - after we introduced import / export methods we will use importedMessage.alias
				fixedExportMessage.id = fixedExportMessage.alias["default"] ?? fixedExportMessage.id

				messagesToExport.push(fixedExportMessage)
			}
			
			// wa are about to save the messages to the plugin - reset all flags now
			messageDirtyFlags = {}

			// TODO #1844 SPLIT (separate ticket) make sure save messages produces the same output again and again
			// TODO #1844v Versioning on plugins? cache issue?
			await savePlugin.saveMessages({
				settings: settingsValue,
				messages: messagesToExport,
				nodeishFs: fs,
			})

			await releaseLock(fs as NodeishFilesystem, lockFilePath, "saveMessage", lockTime)
		} catch (err) {
			// something went wrong - add dirty flags again
			for (const dirtyMessageId of Object.keys(persistedMessageHashs)) {
				messageDirtyFlags[dirtyMessageId] = true
			}

			// ok an error
			throw new PluginSaveMessagesError({
				cause: err,
			})
		} finally {
			isSaving = false
		}
	})()

	await currentSaveMessagesViaPlugin

	if (sheduledSaveMessages) {
		const executingSheduledSaveMessages = sheduledSaveMessages
		sheduledSaveMessages = undefined

		return await saveMessagesViaPlugin(
			fs,
			messagesFolderPath,
			messagesQuery,
			settingsValue,
			savePlugin
		).then(
			() => {
				return executingSheduledSaveMessages[1]()
			},
			(e: Error) => {
				return executingSheduledSaveMessages[2](e)
			}
		)
	}
}

const maxRetries = 5
const nProbes = 10
const probeInterval = 100
async function accquireFileLock(
	fs: NodeishFilesystem,
	lockFilePath: string,
	lockOrigin: string,
	tryCount: number = 0
): Promise<number> {
	if (tryCount > maxRetries) {
		throw new Error("maximum lock accuriations reached")
	}

	try {
		// TODO #1844 remove console log
		// eslint-disable-next-line no-console
		console.log(lockOrigin + " tries to accquire a lockfile Retry Nr.: " + tryCount)
		await fs.mkdir(lockFilePath)
		const stats = await fs.stat(lockFilePath)
		// TODO #1844 remove console log
		// eslint-disable-next-line no-console
		console.log(lockOrigin + " accquired a lockfile Retry Nr.: " + tryCount)
		return stats.mtimeMs
	} catch (error: any) {
		if (error.code !== "EEXIST") {
			// we only expect the error that the file exists already (locked by other process)
			throw error
		}
	}

	let currentLockTime: number

	try {
		const stats = await fs.stat(lockFilePath)
		currentLockTime = stats.mtimeMs
	} catch (fstatError: any) {
		if (fstatError.code === "ENOENT") {
			// lock file seems to be gone :) - lets try again
			return accquireFileLock(fs, lockFilePath, lockOrigin, tryCount + 1)
		}
		throw fstatError
	}
	// TODO #1844 remove console log
	// eslint-disable-next-line no-console
	console.log(
		lockOrigin +
			" tries to accquire a lockfile  - lock currently in use... starting probe phase " +
			+tryCount
	)

	return new Promise((resolve, reject) => {
		let probeCounts = 0
		const scheduleProbationTimeout = () => {
			setTimeout(async () => {
				probeCounts += 1
				let lockFileStats: undefined | NodeishStats = undefined
				try {
					// TODO #1844 remove console log
					// eslint-disable-next-line no-console
					console.log(
						lockOrigin +
							" tries to accquire a lockfile - check if the lock is free now " +
							+tryCount
					)

					// alright lets give it another try
					lockFileStats = await fs.stat(lockFilePath)
				} catch (fstatError: any) {
					if (fstatError.code === "ENOENT") {
						// TODO #1844 remove console log
						// eslint-disable-next-line no-console
						console.log(
							lockOrigin +
								" tries to accquire a lockfile - lock file seems to be free now - try to accquire" +
								+tryCount
						)
						// lock file seems to be gone :) - lets try again
						const lock = accquireFileLock(fs, lockFilePath, lockOrigin, tryCount + 1)
						return resolve(lock)
					}
					return reject(fstatError)
				}

				// still the same locker! -
				if (lockFileStats.mtimeMs === currentLockTime) {
					if (probeCounts >= nProbes) {
						// ok maximum lock time ran up (we waitetd nProbes * probeInterval) - we consider the lock to be stale
						// TODO #1844 remove console log
						// eslint-disable-next-line no-console
						console.log(
							lockOrigin +
								" tries to accquire a lockfile  - lock not free - but stale lets drop it" +
								+tryCount
						)
						try {
							await fs.rmdir(lockFilePath)
						} catch (rmLockError: any) {
							if (rmLockError.code === "ENOENT") {
								// lock already gone?
								// Option 1: The "stale process" decided to get rid of it
								// Option 2: Another process accquiring the lock and detected a stale one as well
							}
							return reject(rmLockError)
						}
						try {
							const lock = await accquireFileLock(fs, lockFilePath, lockOrigin, tryCount + 1)
							return resolve(lock)
						} catch (lockAquireException) {
							return reject(lockAquireException)
						}
					} else {
						// lets schedule a new probation
						return scheduleProbationTimeout()
					}
				} else {
					try {
						const lock = await accquireFileLock(fs, lockFilePath, lockOrigin, tryCount + 1)
						return resolve(lock)
					} catch (error) {
						return reject(error)
					}
				}
			}, probeInterval)
		}
		scheduleProbationTimeout()
	})
}

async function releaseLock(
	fs: NodeishFilesystem,
	lockFilePath: string,
	lockOrigin: string,
	lockTime: number
) {
	// TODO #1844 remove console log
	// eslint-disable-next-line no-console
	console.log(lockOrigin + " releasing the lock ")
	try {
		const stats = await fs.stat(lockFilePath)
		if (stats.mtimeMs === lockTime) {
			// this can be corrupt as welll since the last getStat and the current a modification could have occured :-/
			await fs.rmdir(lockFilePath)
		}
	} catch (statError: any) {
		// TODO #1844 remove console log
		// eslint-disable-next-line no-console
		console.log(lockOrigin + " couldn't release the lock")
		if (statError.code === "ENOENT") {
			// ok seeks like the log was released by someone else
			// TODO #1844 remove console log
			// eslint-disable-next-line no-console
			console.log(lockOrigin + "WARNING - the lock was released by a different process")
			return
		}
		// TODO #1844 remove console log
		// eslint-disable-next-line no-console
		console.log(statError)
		throw statError
	}
}
