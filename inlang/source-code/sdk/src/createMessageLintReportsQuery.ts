import type {
	InlangProject,
	InstalledMessageLintRule,
	MessageLintReportsQueryApi,
	MessageQueryApi,
	MessageQueryDelegate,
} from "./api.js"
import type { ProjectSettings } from "@inlang/project-settings"
import type { resolveModules } from "./resolve-modules/index.js"
import type { MessageLintReport, Message } from "./versionedInterfaces.js"
import { lintSingleMessage } from "./lint/index.js"

import _debug from "debug"
const debug = _debug("sdk:lintReports")

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Creates a non-reactive async query API for lint reports.
 * e.g. used in editor/.../Listheader.tsx
 *
 * TODO MESDK-50: reactivity should be restored in future
 * See https://github.com/opral/monorepo/pull/2378 for why this design.
 */
export function createMessageLintReportsQuery(
	messagesQuery: MessageQueryApi,
	settings: () => ProjectSettings,
	installedMessageLintRules: () => Array<InstalledMessageLintRule>,
	resolvedModules: () => Awaited<ReturnType<typeof resolveModules>> | undefined
): InlangProject["query"]["messageLintReports"] {
	const index = new Map<MessageLintReport["messageId"], MessageLintReport[]>()

	const modules = resolvedModules()

	const rulesArray = modules?.messageLintRules
	const messageLintRuleLevels = Object.fromEntries(
		installedMessageLintRules().map((rule) => [rule.id, rule.level])
	)
	const settingsObject = () => {
		return {
			...settings(),
			messageLintRuleLevels,
		}
	}

	const lintMessage = (message: Message, messages: Message[]) => {
		if (!rulesArray) {
			return
		}

		// TODO unhandled promise rejection (as before the refactor) but won't tackle this in this pr
		lintSingleMessage({
			rules: rulesArray,
			settings: settingsObject(),
			messages: messages,
			message: message,
		}).then((report) => {
			if (report.errors.length === 0 && index.get(message.id) !== report.data) {
				debug("lintSingleMessage", message.id, report.data.length)
				index.set(message.id, report.data)
			}
		})
	}

	const messages = messagesQuery.getAll() as Message[]
	// load report for all messages once
	for (const message of messages) {
		// NOTE: this potentually creates thousands of promisses we could create a promise that batches linting
		lintMessage(message, messages)
	}

	const messageQueryChangeDelegate: MessageQueryDelegate = {
		onCleanup: () => {
			// NOTE: we could cancel all running lint rules - but results get overritten anyway
			index.clear()
		},
		onLoaded: (messages: Message[]) => {
			for (const message of messages) {
				lintMessage(message, messages)
			}
		},
		onMessageCreate: (messageId: string, message: Message) => {
			lintMessage(message, messages)
		},
		onMessageUpdate: (messageId: string, message: Message) => {
			lintMessage(message, messages)
		},
		onMessageDelete: (messageId: string) => {
			index.delete(messageId)
		},
	}

	messagesQuery.setDelegate(messageQueryChangeDelegate)

	return {
		getAll: async () => {
			await sleep(0) // evaluate on next tick to allow for out-of-order effects
			const flatValues = [...index.values()].flat()
			debug("getAll", flatValues.length)
			return structuredClone(flatValues.length === 0 ? [] : flatValues)
		},
		get: async (args: Parameters<MessageLintReportsQueryApi["get"]>[0]) => {
			await sleep(0) // evaluate on next tick to allow for out-of-order effects
			debug("get", args.where.messageId)
			return structuredClone(index.get(args.where.messageId) ?? [])
		},
	}
}
