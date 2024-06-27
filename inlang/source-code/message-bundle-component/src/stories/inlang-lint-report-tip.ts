import { LitElement, css, html } from "lit"
import { customElement, property } from "lit/decorators.js"
import type { MessageLintReport } from "@inlang/message-lint-rule"

import SlToolTip from "@shoelace-style/shoelace/dist/components/tooltip/tooltip.component.js"
import type { LintReport } from "@inlang/sdk/v2"

// in case an app defines it's own set of shoelace components, prevent double registering
if (!customElements.get("sl-tooltip")) customElements.define("sl-tooltip", SlToolTip)

@customElement("inlang-lint-report-tip")
export default class InlangLintReportTip extends LitElement {
	static override styles = [
		css`
			.lint-report-tip {
				height: 29px;
				width: 29px;
				color: var(--sl-color-danger-700);
				display: flex;
				align-items: center;
				justify-content: center;
				border-radius: 4px;
				cursor: pointer;
			}
			.lint-report-tip:hover {
				background-color: var(--sl-color-danger-200);
			}
			.dropdown-container {
				font-size: 13px;
				width: 240px;
				background-color: white;
				border: 1px solid var(--sl-color-neutral-300);
				border-radius: 6px;
				display: flex;
				flex-direction: column;
			}
			.dropdown-item {
				display: flex;
				flex-direction: row;
				gap: 12px;
				padding: 8px 12px;
				border-top: 1px solid var(--sl-color-neutral-300);
			}
			.dropdown-item:first-child {
				border-top: none;
			}
			.report-icon {
				height: 29px;
				width: 29px;
				color: var(--sl-color-danger-700);
				display: flex;
				align-items: center;
				justify-content: center;
			}
			.report-content {
				display: flex;
				flex-direction: column;
				gap: 4px;
			}
			.report-title {
				padding-top: 2px;
				font-size: 12px;
				font-weight: 500;
				color: var(--sl-color-neutral-950);
			}
			.report-body {
				font-size: 12px;
				color: var(--sl-color-neutral-600);
				line-break: anywhere;
			}
			.report-fixes {
				display: flex;
				flex-direction: column;
				gap: 4px;
				padding-top: 4px;
			}
			.fix-button {
				width: 100%;
			}
			.fix-button::part(base):hover {
				background-color: var(--sl-color-neutral-100);
				color: var(--sl-color-neutral-900);
				border-color: var(--sl-color-neutral-400);
			}
			p {
				margin: 0;
			}
		`,
	]

	@property()
	lintReports: LintReport[] | undefined

	@property()
	fixLint: (lintReport: LintReport, fix: LintReport["fixes"][0]["title"]) => void = () => {}

	override render() {
		return html`<sl-dropdown
			distance="-4"
			placement="bottom-start"
			class="dropdown"
			@sl-show=${(e: CustomEvent) => {
				//console.log(e)
			}}
		>
			<div slot="trigger" class="lint-report-tip">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="18"
					height="18"
					viewBox="0 0 20 20"
					fill="currentColor"
				>
					<path
						d="M9 13h2v2H9v-2zm0-8h2v6H9V5zm1-5C4.47 0 0 4.5 0 10A10 10 0 1010 0zm0 18a8 8 0 110-16 8 8 0 010 16z"
					></path>
				</svg>
			</div>
			<div class="dropdown-container">
				${this.lintReports?.map((lintReport) => {
					return html`<div class="dropdown-item">
						<div class="report-icon">
							<svg
								xmlns="http://www.w3.org/2000/svg"
								width="18"
								height="18"
								viewBox="0 0 20 20"
								fill="currentColor"
							>
								<path
									d="M9 13h2v2H9v-2zm0-8h2v6H9V5zm1-5C4.47 0 0 4.5 0 10A10 10 0 1010 0zm0 18a8 8 0 110-16 8 8 0 010 16z"
								></path>
							</svg>
						</div>
						<div class="report-content">
							<p class="report-title">${lintReport.ruleId && lintReport.ruleId.split(".")[2]}</p>
							<p class="report-body">${lintReport.body}</p>
							<div class="report-fixes">
								${lintReport.fixes?.map((fix) => {
									return html`
										<sl-button
											@click=${() => {
												this.fixLint(lintReport, fix.title)
											}}
											class="fix-button"
											size="small"
											>${fix.title}</sl-button
										>
									`
								})}
							</div>
						</div>
					</div>`
				})}
			</div>
		</sl-dropdown>`
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"inlang-lint-report-tip": InlangLintReportTip
	}
}
