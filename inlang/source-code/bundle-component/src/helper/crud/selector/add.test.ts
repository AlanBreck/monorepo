import { type Expression, type NestedMessage } from "@inlang/sdk-v2"
import { describe, expect, it } from "vitest"
import addSelector from "./add.js"

describe("addSelector", () => {
	it("Should add selector", () => {
		const message: NestedMessage = {
			bundleId: "testId",
			id: "testId",
			locale: "en",
			selectors: [
				{
					type: "expression",
					arg: {
						type: "variable",
						name: "count",
					},
				},
			],
			declarations: [],
			variants: []
		}

		const newSelector = {
			type: "expression",
			arg: {
				type: "variable",
				name: "name",
			},
		}

		addSelector({ message, selector: newSelector as Expression })

		expect(message.selectors.length).toBe(2)
		// @ts-ignore
		expect(message.selectors[1]!.arg.name).toBe("name")
	})
})
