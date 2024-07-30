import { tryCatch } from "@inlang/result"
import { TypeCompiler } from "@sinclair/typebox/compiler"
import { validatedPluginSettings } from "./validatedPluginSettings.js"
import {
	Plugin2,
	InlangPlugin2,
	type ResolvePluginsFunction,
	type ResolvePlugin2Function,
} from "./types/plugin.js"
import {
	PluginError,
	PluginImportError,
	PluginHasNoExportsError,
	PluginExportIsInvalidError,
	PluginSettingsAreInvalidError,
	PluginReturnedInvalidCustomApiError,
	PluginImportFilesFunctionAlreadyDefinedError,
	PluginExportFilesFunctionAlreadyDefinedError,
	PluginToBeImportedFilesFunctionAlreadyDefinedError,
	PluginHasInvalidIdError,
	PluginHasInvalidSchemaError,
	PluginsDoNotProvideImportOrExportFilesError,
} from "./types/plugin-errors.js"
import { deepmerge } from "deepmerge-ts"

// const PluginCompiler = TypeCompiler.Compile(InlangPlugin2)

export const resolvePlugins: ResolvePlugin2Function = async (args) => {
	const _import = args._import

	const allPlugins: Array<Plugin2> = []
	const meta: Awaited<ReturnType<ResolvePlugin2Function>>["meta"] = []
	const pluginErrors: Array<PluginError> = []

	async function resolvePlugin(plugin: string) {
		const importedPlugin = await tryCatch<InlangPlugin2>(() => _import(plugin))

		// -- FAILED TO IMPORT --
		if (importedPlugin.error) {
			console.error(`Failed to import plugin: ${plugin}`, importedPlugin.error)
			pluginErrors.push(
				new PluginImportError({
					plugin,
					cause: importedPlugin.error as Error,
				})
			)
			return
		}

		// -- PLUGIN DOES NOT EXPORT ANYTHING --
		if (importedPlugin.data?.default === undefined) {
			console.error(`Plugin has no exports: ${plugin}`)
			pluginErrors.push(
				new PluginHasNoExportsError({
					plugin,
				})
			)
			return
		}

		// -- CHECK IF PLUGIN IS SYNTACTICALLY VALID --
		const isValidPlugin = PluginCompiler.Check(importedPlugin.data)
		if (!isValidPlugin) {
			const errors = [...PluginCompiler.Errors(importedPlugin.data)]
			console.error(`Plugin schema is invalid for: ${plugin}`, errors)
			pluginErrors.push(
				new PluginExportIsInvalidError({
					plugin,
					errors,
				})
			)
			return
		}

		// -- VALIDATE PLUGIN SETTINGS
		const result = validatedPluginSettings({
			settingsSchema: importedPlugin.data.default.settingsSchema,
			pluginSettings: (args.settings as any)[importedPlugin.data.default.id],
		})
		if (result !== "isValid") {
			console.error(`Plugin settings are invalid for: ${plugin}`, result)
			pluginErrors.push(new PluginSettingsAreInvalidError({ plugin, errors: result }))
			return
		}

		meta.push({
			plugin,
			id: importedPlugin.data.default.id,
		})

		allPlugins.push(importedPlugin.data.default as Plugin2)
	}

	await Promise.all(args.settings.modules.map(resolvePlugin))

	const result: Awaited<ReturnType<ResolvePluginsFunction>> = {
		data: {
			toBeImportedFiles: {},
			importFiles: {},
			exportFiles: {},
			customApi: {},
		},
		errors: [...pluginErrors],
	}

	for (const plugin of allPlugins) {
		const errors = [...PluginCompiler.Errors(plugin)]

		// -- INVALID ID in META --
		const hasInvalidId = errors.some((error) => error.path === "/id")
		if (hasInvalidId) {
			console.error(`Plugin has invalid ID: ${plugin.id}`, errors)
			result.errors.push(new PluginHasInvalidIdError({ id: plugin.id }))
		}

		// -- USES INVALID SCHEMA --
		if (errors.length > 0) {
			console.error(`Plugin uses invalid schema: ${plugin.id}`, errors)
			result.errors.push(
				new PluginHasInvalidSchemaError({
					id: plugin.id,
					errors: errors,
				})
			)
		}

		// -- CHECK FOR ALREADY DEFINED FUNCTIONS --
		if (typeof plugin.toBeImportedFiles === "function") {
			if (result.data.toBeImportedFiles[plugin.id]) {
				console.error(`Plugin toBeImportedFiles function already defined: ${plugin.id}`)
				result.errors.push(
					new PluginToBeImportedFilesFunctionAlreadyDefinedError({ id: plugin.id })
				)
			} else {
				result.data.toBeImportedFiles[plugin.id] = plugin.toBeImportedFiles
			}
		}

		if (typeof plugin.importFiles === "function") {
			if (result.data.importFiles[plugin.id]) {
				console.error(`Plugin importFiles function already defined: ${plugin.id}`)
				result.errors.push(new PluginImportFilesFunctionAlreadyDefinedError({ id: plugin.id }))
			} else {
				result.data.importFiles[plugin.id] = plugin.importFiles
			}
		}

		if (typeof plugin.exportFiles === "function") {
			if (result.data.exportFiles[plugin.id]) {
				console.error(`Plugin exportFiles function already defined: ${plugin.id}`)
				result.errors.push(new PluginExportFilesFunctionAlreadyDefinedError({ id: plugin.id }))
			} else {
				result.data.exportFiles[plugin.id] = plugin.exportFiles
			}
		}

		// -- ADD APP SPECIFIC API --
		if (typeof plugin.addCustomApi === "function") {
			const { data: customApi, error } = tryCatch(() =>
				plugin.addCustomApi!({
					settings: args.settings,
				})
			)
			if (error) {
				console.error(`Plugin returned invalid custom API: ${plugin.id}`, error)
				result.errors.push(new PluginReturnedInvalidCustomApiError({ id: plugin.id, cause: error }))
			} else if (typeof customApi !== "object") {
				console.error(`Plugin returned invalid custom API type: ${plugin.id}`, typeof customApi)
				result.errors.push(
					new PluginReturnedInvalidCustomApiError({
						id: plugin.id,
						cause: new Error(`The return value must be an object. Received "${typeof customApi}".`),
					})
				)
			} else {
				result.data.customApi = deepmerge(result.data.customApi, customApi)
			}
		}

		// -- CONTINUE IF ERRORS --
		if (errors.length > 0) {
			continue
		}
	}

	// -- IMPORT / EXPORT NOT DEFINED FOR ANY PLUGIN --
	if (
		Object.keys(result.data.toBeImportedFiles).length === 0 &&
		Object.keys(result.data.importFiles).length === 0 &&
		Object.keys(result.data.exportFiles).length === 0
	) {
		console.error(`No import/export functions defined for any plugin.`)
		result.errors.push(new PluginsDoNotProvideImportOrExportFilesError())
	}

	return {
		meta,
		plugins: allPlugins,
		resolvedPluginApi: result.data,
		errors: result.errors,
	}
}
