import { createComponent } from "@lit/react";
import { InlangBundle as LitInlangBundle } from "@inlang/bundle-component"
import React, { useEffect, useState } from "react";
import { useAtom } from "jotai";
import { projectAtom } from "../state.ts";
import {
	BundleNested,
	MessageNested,
	Variant,
	selectBundleNested,
} from "@inlang/sdk2";
import queryHelper from "../helper/queryHelper.ts";

export const ReactBundle = createComponent({
	tagName: "inlang-bundle",
	elementClass: LitInlangBundle,
	react: React,
	events: {
		changeMessageBundle: "change-message-bundle",
		insertMessage: "insert-message",
		updateMessage: "update-message",

		insertVariant: "insert-variant",
		updateVariant: "update-variant",
		deleteVariant: "delete-variant",
		fixLint: "fix-lint",
	},
});

const InlangBundle = (props: { bundleId: string }) => {
	const [project] = useAtom(projectAtom);
	const [bundle, setBundle] = useState<BundleNested | undefined>(undefined);
	const [changedIds, setChangedIds] = useState<string[]>([]);

	const calculateChangedBundleIds = async () => {
		const uncommittedChanges = await project?.lix.db
			.selectFrom("change")
			.selectAll()
			.where("commit_id", "is", null)
			.execute();

		if (uncommittedChanges) {
			// @ts-expect-error - https://github.com/opral/lix-sdk/issues/27
			setChangedIds(uncommittedChanges.map((change) => change.value.id));
		}
	};

	useEffect(() => {
		if (!project) return;
		queryBundle();
		calculateChangedBundleIds();
		setInterval(async () => {
			queryBundle();
			calculateChangedBundleIds();
		}, 2000);
	}, []);

	const queryBundle = async () => {
		if (!project) return;
		const bundle = await selectBundleNested(project.db)
			.where("id", "=", props.bundleId)
			.executeTakeFirst();
		setBundle(bundle);
	};

	const onMesageInsert = (event: {
		detail: { argument: { message: MessageNested } };
	}) => {
		if (project) {
			const insertedMessage = event.detail.argument.message;
			queryHelper.message.insert(project.db, insertedMessage).execute();
		}
	};
	const onMesageUpdate = (event: {
		detail: { argument: { message: MessageNested } };
	}) => {
		if (project) {
			const updatedMessage = event.detail.argument.message;
			queryHelper.message.update(project.db, updatedMessage).execute();
		}
	};
	const onVariantInsert = async (event: {
		detail: { argument: { variant: Variant } };
	}) => {
		if (project) {
			const insertedVariant = event.detail.argument.variant;
			const result = await queryHelper.variant
				.insert(project.db, insertedVariant)
				.execute();
			console.log(result);
		}
	};
	const onVariantUpdate = async (event: {
		detail: { argument: { variant: Variant } };
	}) => {
		if (project) {
			const updatedVariant = event.detail.argument.variant;
			await queryHelper.variant.update(project.db, updatedVariant).execute();
		}
	};
	const onVariantDelete = (event: {
		detail: { argument: { variant: Variant } };
	}) => {
		if (project) {
			const deletedVariant = event.detail.argument.variant;
			queryHelper.variant.delete(project.db, deletedVariant).execute();
		}
	};

	return (
		<>
			{bundle && (
				<div className="relative">
					<ReactBundle
						style={{ all: "initial" }}
						bundle={bundle}
						settings={project?.settings.get()}
						insertMessage={onMesageInsert as any}
						updateMessage={onMesageUpdate as any}
						insertVariant={onVariantInsert as any}
						updateVariant={onVariantUpdate as any}
						deleteVariant={onVariantDelete as any}
					/>
					<div className="absolute top-[14px] right-0 pointer-events-none translate-x-6">
						{arraysIntersect(getAllNestedIds(bundle), changedIds) && (
							<div className="bg-blue-500 w-3 h-3 text-white p-1 rounded-full" />
						)}
					</div>
				</div>
			)}
		</>
	);
};

export default InlangBundle;

const getAllNestedIds = (bundle: BundleNested): string[] => {
	const messageIds = bundle.messages.map((message) => message.id);
	const variantIds = bundle.messages
		.flatMap((message) => message.variants)
		.map((variant) => variant.id);
	return [...messageIds, ...variantIds, ...bundle.id];
};

function arraysIntersect(arr1: any[], arr2: any[]): boolean {
	// Convert the first array to a Set
	const set1 = new Set(arr1);

	// Check if any element in arr2 exists in set1
	for (const element of arr2) {
		if (set1.has(element)) {
			return true;
		}
	}

	// If no elements are found in the intersection
	return false;
}