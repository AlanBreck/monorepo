/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { test, expect, describe } from "vitest";
import { inlangLixPluginV1 } from "./inlangLixPluginV1.js";
import type { Variant } from "../schema/schemaV2.js";
import type { DiffReport } from "@lix-js/sdk";
import { newProject } from "../project/newProject.js";
import { loadProjectInMemory } from "../project/loadProjectInMemory.js";
import { contentFromDatabase } from "sqlite-wasm-kysely";

describe("plugin.diff.file", () => {
	test("insert of bundle", async () => {
		const neuProject = await loadProjectInMemory({ blob: await newProject() });
		await neuProject.db
			.insertInto("bundle")
			.values({
				id: "1",
				// @ts-expect-error - database expects stringified json
				alias: JSON.stringify({}),
			})
			.execute();
		const diffReports = await inlangLixPluginV1.diff.file!({
			old: undefined,
			neu: contentFromDatabase(neuProject._sqlite),
			path: "/db.sqlite",
		});
		expect(diffReports).toEqual([
			{ type: "bundle", value: { id: "1", alias: {} } } satisfies DiffReport,
		]);
	});

	test("update of bundle", async () => {
		const oldProject = await loadProjectInMemory({ blob: await newProject() });
		await oldProject.db
			.insertInto("bundle")
			.values([
				{
					id: "1",
					// @ts-expect-error - database expects stringified json
					alias: JSON.stringify({}),
				},
				{
					id: "2",
					// @ts-expect-error - database expects stringified json
					alias: JSON.stringify({}),
				},
			])
			.execute();
		const neuProject = await loadProjectInMemory({ blob: await newProject() });
		await neuProject.db
			.insertInto("bundle")
			.values([
				{
					id: "1",
					// @ts-expect-error - database expects stringified json
					alias: JSON.stringify({
						default: "Peter Parker",
					}),
				},
				{
					id: "2",
					// @ts-expect-error - database expects stringified json
					alias: JSON.stringify({}),
				},
			])
			.execute();
		const diffReports = await inlangLixPluginV1.diff.file!({
			old: contentFromDatabase(oldProject._sqlite),
			neu: contentFromDatabase(neuProject._sqlite),
			path: "/db.sqlite",
		});
		expect(diffReports).toEqual([
			{
				type: "bundle",
				value: { id: "1", alias: { default: "Peter Parker" } },
			} satisfies DiffReport,
		]);
	});

	test("insert of message", async () => {
		const neuProject = await loadProjectInMemory({ blob: await newProject() });
		await neuProject.db
			.insertInto("message")
			.values({
				id: "1",
				// @ts-expect-error - database expects stringified json
				declarations: JSON.stringify([]),
				bundleId: "unknown",
				// @ts-expect-error - database expects stringified json
				selectors: JSON.stringify({}),
				locale: "en",
			})
			.execute();
		const diffReports = await inlangLixPluginV1.diff.file!({
			old: undefined,
			neu: contentFromDatabase(neuProject._sqlite),
			path: "/db.sqlite",
		});
		expect(diffReports).toEqual([
			{
				type: "message",
				value: {
					id: "1",
					declarations: [],
					bundleId: "unknown",
					selectors: {},
					locale: "en",
				},
			} satisfies DiffReport,
		]);
	});
	test("update of message", async () => {
		const oldProject = await loadProjectInMemory({ blob: await newProject() });
		await oldProject.db
			.insertInto("message")
			.values([
				{
					id: "1",
					// @ts-expect-error - database expects stringified json
					declarations: JSON.stringify([]),
					bundleId: "unknown",
					// @ts-expect-error - database expects stringified json
					selectors: JSON.stringify({}),
					locale: "en",
				},
				{
					id: "2",
					// @ts-expect-error - database expects stringified json
					declarations: JSON.stringify([]),
					bundleId: "unknown",
					// @ts-expect-error - database expects stringified json
					selectors: JSON.stringify({}),
					locale: "en",
				},
			])
			.execute();
		const neuProject = await loadProjectInMemory({ blob: await newProject() });
		await neuProject.db
			.insertInto("message")
			.values([
				{
					id: "1",
					// @ts-expect-error - database expects stringified json
					declarations: JSON.stringify([]),
					bundleId: "unknown",
					// @ts-expect-error - database expects stringified json
					selectors: JSON.stringify({}),
					locale: "de",
				},
				{
					id: "2",
					// @ts-expect-error - database expects stringified json
					declarations: JSON.stringify([]),
					bundleId: "unknown",
					// @ts-expect-error - database expects stringified json
					selectors: JSON.stringify({}),
					locale: "en",
				},
			])
			.execute();
		const diffReports = await inlangLixPluginV1.diff.file!({
			old: contentFromDatabase(oldProject._sqlite),
			neu: contentFromDatabase(neuProject._sqlite),
			path: "/db.sqlite",
		});
		expect(diffReports).toEqual([
			{
				type: "message",
				value: {
					id: "1",
					declarations: [],
					bundleId: "unknown",
					selectors: {},
					locale: "de",
				},
			} satisfies DiffReport,
		]);
	});
	test("insert of variant", async () => {
		const neuProject = await loadProjectInMemory({ blob: await newProject() });
		await neuProject.db
			.insertInto("variant")
			.values({
				id: "1",
				messageId: "1",
				// @ts-expect-error - database expects stringified json
				pattern: JSON.stringify([{ type: "text", value: "hello world" }]),
				match: JSON.stringify({}),
			})
			.execute();
		const diffReports = await inlangLixPluginV1.diff.file!({
			old: undefined,
			neu: contentFromDatabase(neuProject._sqlite),
			path: "/db.sqlite",
		});
		expect(diffReports).toEqual([
			{
				type: "variant",
				value: {
					id: "1",
					messageId: "1",
					pattern: [{ type: "text", value: "hello world" }],
					match: {},
				},
			} satisfies DiffReport,
		]);
	});
	test("update of variant", async () => {
		const oldProject = await loadProjectInMemory({ blob: await newProject() });
		await oldProject.db
			.insertInto("variant")
			.values([
				{
					id: "1",
					messageId: "1",
					// @ts-expect-error - database expects stringified json
					pattern: JSON.stringify([{ type: "text", value: "hello world" }]),
					match: JSON.stringify({}),
				},
				{
					id: "2",
					messageId: "1",
					// @ts-expect-error - database expects stringified json
					pattern: JSON.stringify([{ type: "text", value: "hello world" }]),
					match: JSON.stringify({}),
				},
			])
			.execute();
		const neuProject = await loadProjectInMemory({ blob: await newProject() });
		await neuProject.db
			.insertInto("variant")
			.values([
				{
					id: "1",
					messageId: "1",
					// @ts-expect-error - database expects stringified json
					pattern: JSON.stringify([
						{ type: "text", value: "hello world from Berlin" },
					]),
					match: JSON.stringify({}),
				},
				{
					id: "2",
					messageId: "1",
					// @ts-expect-error - database expects stringified json
					pattern: JSON.stringify([{ type: "text", value: "hello world" }]),
					match: JSON.stringify({}),
				},
			])
			.execute();
		const diffReports = await inlangLixPluginV1.diff.file!({
		old: contentFromDatabase(oldProject._sqlite),
			neu: contentFromDatabase(neuProject._sqlite),
			path: "/db.sqlite",
		});
		expect(diffReports).toEqual([
			{
				type: "variant",
				value: {
					id: "1",
					messageId: "1",
					pattern: [{ type: "text", value: "hello world from Berlin" }],
					match: {},
				},
			} satisfies DiffReport,
		]);
	});
});

describe("plugin.diff.variant", () => {
	test("old and neu are the same should not report a diff", async () => {
		const old: Variant = {
			id: "1",
			match: {},
			messageId: "5",
			pattern: [{ type: "text", value: "hello world" }],
		};
		const neu: Variant = {
			id: "1",
			match: {},
			messageId: "5",
			pattern: [{ type: "text", value: "hello world" }],
		};
		const diff = await inlangLixPluginV1.diff.variant({ old, neu });
		expect(diff).toEqual([]);
	});

	test("old and neu are different should yield a diff report", async () => {
		const old: Variant = {
			id: "1",
			match: {},
			messageId: "5",
			pattern: [{ type: "text", value: "hello world" }],
		};
		const neu: Variant = {
			id: "1",
			match: {},
			messageId: "5",
			pattern: [{ type: "text", value: "hello world from Berlin" }],
		};
		const diff = await inlangLixPluginV1.diff.variant({ old, neu });
		expect(diff).toEqual([
			{ type: "variant", value: neu } satisfies DiffReport,
		]);
	});

	test("old is undefined and neu is defined should return a diff report for the new value", async () => {
		const old = undefined;
		const neu: Variant = {
			id: "1",
			match: {},
			messageId: "5",
			pattern: [{ type: "text", value: "hello world" }],
		};
		const diff = await inlangLixPluginV1.diff.variant({ old, neu });
		expect(diff).toEqual([
			{ type: "variant", value: neu } satisfies DiffReport,
		]);
	});
});
