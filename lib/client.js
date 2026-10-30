/**
 * dsh-deepseek-balance — browser half.
 *
 * Lazy-CJS client bundle in the format the dsh client module system expects:
 * `window.__ModuleLoader__.load({ id, factory })` where `id` is the PACKAGE
 * NAME (the boot-graph row key — it must match package.json's `name` exactly)
 * and the factory returns a Cordis plugin object `{ inject, apply }`.
 *
 * Both `dsh web` and the dsh Desktop app consume this same contract
 * (`dsh.client.platform === "web"`), so one bundle serves both.
 *
 * The plugin registers one additive entry into the composer's
 * `conversation.input.right` list slot, i.e. the right-hand side of the input
 * toolbar on the same row as the textarea:
 *
 *   [ 余额数字 ] [ 自动刷新开关 ]
 *
 *   - click the balance chip → manual refresh (GET /deepseek-balance/state)
 *   - hover the widget       → glass tooltip: 账户余额 / 更新时间 / 自动刷新状态
 *   - toggle the switch      → 5-minute auto refresh, default OFF, remembered
 *                              per browser in localStorage
 *
 * Only the official account balance is shown — no cost/token/quota statistics.
 *
 * Runtime dependencies: just the shell-seeded `react` and `react/jsx-runtime`.
 * Styling is one injected <style> tag built from the app's `--dsw-*` design
 * tokens, so it follows the light/dark theme automatically. No transitions, no
 * keyframes: nothing animates or repaints on a timer.
 */
window.__ModuleLoader__.load({
	id: "dsh-deepseek-balance",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");

		//#region styles
		const css = [
			/* The glass pill that sits in the composer's trailing row. */
			".dsau{position:relative;display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 8px;border-radius:13px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));background:color-mix(in srgb,var(--dsw-alias-bg-layer-1,#f7f7f8) 58%,transparent);-webkit-backdrop-filter:blur(14px) saturate(150%);backdrop-filter:blur(14px) saturate(150%);box-shadow:0 1px 2px rgba(0,0,0,.05);user-select:none;flex:none}",
			"@supports not (backdrop-filter:blur(1px)){.dsau{background:var(--dsw-alias-bg-layer-2,#ffffff)}}",
			".dsau-loading{opacity:.72}",
			/* Balance chip = the manual-refresh button. */
			".dsau-chip{appearance:none;border:0;background:transparent;padding:0 2px;margin:0;cursor:pointer;color:var(--dsw-alias-label-primary,#14161a);font-family:var(--dsw-font-family,Inter,system-ui);font-size:12px;line-height:16px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}",
			".dsau-chip:hover{color:var(--dsw-alias-brand-primary,#4d6bfe)}",
			".dsau-chip:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:1px;border-radius:6px}",
			".dsau-chip:disabled{cursor:default;color:var(--dsw-alias-label-tertiary,#8b9096)}",
			/* Auto-refresh switch: pure CSS, no transition. */
			".dsau-toggle{position:relative;display:inline-flex;align-items:center;width:28px;height:16px;flex:none;cursor:pointer}",
			".dsau-toggle input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer}",
			".dsau-toggle-track{display:inline-flex;align-items:center;width:26px;height:14px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14));background:color-mix(in srgb,var(--dsw-alias-label-tertiary,#8b9096) 34%,transparent)}",
			".dsau-toggle-thumb{width:10px;height:10px;border-radius:50%;background:var(--dsw-alias-label-primary,#14161a);transform:translateX(1px)}",
			".dsau-toggle input:checked + .dsau-toggle-track{background:var(--dsw-alias-brand-primary,#4d6bfe);border-color:transparent}",
			".dsau-toggle input:checked + .dsau-toggle-track .dsau-toggle-thumb{background:#ffffff;transform:translateX(13px)}",
			".dsau-toggle input:focus-visible + .dsau-toggle-track{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:1px}",
			/* Hover tooltip: a glass panel above the widget. */
			".dsau-tip{position:absolute;right:0;bottom:calc(100% + 10px);z-index:60;min-width:210px;padding:10px 12px;border-radius:12px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1));background:color-mix(in srgb,var(--dsw-alias-bg-layer-1,#ffffff) 82%,transparent);-webkit-backdrop-filter:blur(18px) saturate(160%);backdrop-filter:blur(18px) saturate(160%);box-shadow:var(--dsw-shadow-lv3,0 8px 24px rgba(0,0,0,.16));opacity:0;visibility:hidden;color:var(--dsw-alias-label-primary,#14161a)}",
			".dsau:hover .dsau-tip,.dsau:focus-within .dsau-tip{opacity:1;visibility:visible}",
			".dsau-tip-row{display:flex;justify-content:space-between;align-items:baseline;gap:14px;font-family:var(--dsw-font-family,Inter,system-ui);font-size:12px;line-height:20px}",
			".dsau-tip-row + .dsau-tip-row{margin-top:1px}",
			/* A subordinate breakdown row (赠金 / 充值): indented under the total,
			   one type size down, same label/value colors as any other row. */
			".dsau-tip-row.dsau-tip-sub{padding-left:12px;font-size:11px;line-height:18px;opacity:.85}",
			".dsau-tip-row.dsau-tip-sub .dsau-tip-label:before{content:\"·\";margin-right:6px;color:var(--dsw-alias-label-tertiary,#8b9096)}",
			".dsau-tip-label{color:var(--dsw-alias-label-secondary,#62676d);flex:none}",
			".dsau-tip-value{color:var(--dsw-alias-label-primary,#14161a);font-weight:600;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}",
			".dsau-tip-value.dsau-tip-hint{color:var(--dsw-alias-label-tertiary,#8b9096);font-weight:400;white-space:normal}",
			".dsau-tip-value.dsau-tip-error{color:var(--dsw-alias-state-error-primary,#e5484d);font-weight:400;white-space:normal;word-break:break-all}",
			".dsau-tip-sep{height:1px;margin:6px 0;background:var(--dsw-alias-border-l1,rgba(0,0,0,.08))}",
			/* Dark theme: tokens already flip; the shadow needs to deepen. */
			"body[data-ds-dark-theme] .dsau{border-color:var(--dsw-alias-border-l2,rgba(255,255,255,.14))}",
			"body[data-ds-dark-theme] .dsau-tip{box-shadow:0 8px 24px rgba(0,0,0,.5)}"
		].join("");
		const styleTagId = "dsh-deepseek-balance/widget.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(styleTagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-deepseek-balance";
			tag.dataset.pluginCss = styleTagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion

		//#region constants & helpers
		/** Fixed endpoint served by the host half (`lib/index.js` ENDPOINT_PATH). */
		const ENDPOINT = "/deepseek-balance/state";
		const AUTO_REFRESH_MS = 5 * 60 * 1000;
		const AUTO_KEY = "dsh-deepseek-balance:auto";

		/** Format a money amount in the account's own currency. */
		function fmtMoney(value, currency) {
			const n = Number(value);
			const cur = typeof currency === "string" && currency.length > 0 ? currency : "CNY";
			try {
				return new Intl.NumberFormat(undefined, { style: "currency", currency: cur, maximumFractionDigits: 2 }).format(n);
			} catch {
				return cur + " " + (isFinite(n) ? n.toFixed(2) : "0.00");
			}
		}

		/** Format a timestamp as a wall-clock time. */
		function fmtTime(ms) {
			try {
				return new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
			} catch {
				return String(ms);
			}
		}
		//#endregion

		//#region locale
		const NS = "deepseek-balance";
		const zh = {
			"chip.aria": "DeepSeek API 余额，点击刷新",
			"chip.title": "点击刷新余额",
			"chip.nokey": "未配置",
			"auto.aria": "自动刷新（每 5 分钟）",
			"auto.title": "自动刷新开关，默认关闭；开启后每 5 分钟刷新一次",
			"tip.balance": "账户余额",
			"tip.granted": "赠金",
			"tip.toppedUp": "充值",
			"tip.updated": "更新时间",
			"tip.auto": "自动刷新",
			"tip.autoOn": "开 · 每 5 分钟",
			"tip.autoOff": "关",
			"tip.credential": "未配置 API 密钥",
			"tip.credentialHint": "请配置 DEEPSEEK_API_KEY 后重启",
			"tip.error": "刷新失败",
			"tip.loading": "加载中…",
			"tip.unknown": "未知错误"
		};
		const en = {
			"chip.aria": "DeepSeek API balance, click to refresh",
			"chip.title": "Click to refresh balance",
			"chip.nokey": "No key",
			"auto.aria": "Auto refresh every 5 minutes",
			"auto.title": "Auto-refresh toggle, off by default; refreshes every 5 minutes when on",
			"tip.balance": "Account balance",
			"tip.granted": "Granted",
			"tip.toppedUp": "Topped up",
			"tip.updated": "Updated",
			"tip.auto": "Auto refresh",
			"tip.autoOn": "On · every 5 min",
			"tip.autoOff": "Off",
			"tip.credential": "API key not configured",
			"tip.credentialHint": "Configure DEEPSEEK_API_KEY and restart",
			"tip.error": "Refresh failed",
			"tip.loading": "Loading…",
			"tip.unknown": "Unknown error"
		};
		//#endregion

		//#region widget
		/**
		 * The composer widget. Receives the standard `t` locale seat; all data
		 * comes from the host endpoint and all state is local.
		 */
		function UsageWidget(props) {
			const t = typeof props.t === "function" ? props.t : (key) => key;
			const [data, setData] = react.useState(null);
			const [error, setError] = react.useState(null);
			const [loading, setLoading] = react.useState(false);
			const [auto, setAuto] = react.useState(() => {
				try {
					return window.localStorage.getItem(AUTO_KEY) === "1";
				} catch {
					return false;
				}
			});

			/** Manual refresh — also the balance-chip click handler. */
			const refresh = react.useCallback(async () => {
				setLoading(true);
				try {
					const response = await fetch(ENDPOINT, { cache: "no-store", headers: { Accept: "application/json" } });
					if (!response.ok) throw new Error("HTTP " + String(response.status));
					setData(await response.json());
					setError(null);
				} catch (err) {
					setError(err instanceof Error ? err.message : String(err));
				} finally {
					setLoading(false);
				}
			}, []);

			// One load on mount.
			react.useEffect(() => {
				refresh();
			}, [refresh]);

			// Optional 5-minute auto refresh (default OFF).
			react.useEffect(() => {
				if (!auto) return undefined;
				const timer = setInterval(() => {
					refresh();
				}, AUTO_REFRESH_MS);
				return () => clearInterval(timer);
			}, [auto, refresh]);

			const onToggle = (event) => {
				const next = Boolean(event.target.checked);
				setAuto(next);
				try {
					window.localStorage.setItem(AUTO_KEY, next ? "1" : "0");
				} catch {
					/* storage unavailable — keep the in-memory choice */
				}
				if (next) refresh();
			};

			// ---- derived values -------------------------------------------
			const ok = data !== null && data.ok === true;
			const balance = ok ? data.balance : null;
			const chipText = data === null
				? "\u2026"
				: ok
					? (data.configured === true && balance !== null ? fmtMoney(balance.total, balance.currency) : t("chip.nokey"))
					: "\u2014";

			// ---- tooltip rows ---------------------------------------------
			const groups = [];
			const balanceGroup = [];
			const metaGroup = [];
			if (data === null) {
				metaGroup.push({ label: t("tip.loading"), value: "\u2026", hint: true });
			} else if (!ok) {
				metaGroup.push({ label: t("tip.error"), value: error || t("tip.unknown"), error: true });
			} else {
				if (data.configured !== true) {
					balanceGroup.push({ label: t("tip.credential"), value: t("tip.credentialHint"), hint: true });
				} else if (balance !== null) {
					balanceGroup.push({ label: t("tip.balance"), value: fmtMoney(balance.total, balance.currency) });
					// Breakdown of total_balance, straight from the official fields.
					// Order is topped-up first, then granted: the panel answers "how
					// much of this is my own money", so the funds the user paid for
					// lead and the platform's gift follows.
					// Each is optional: the API omits them for some accounts, and a
					// missing one must be hidden rather than shown as ¥0.00.
					if (typeof balance.toppedUp === "number") {
						balanceGroup.push({ label: t("tip.toppedUp"), value: fmtMoney(balance.toppedUp, balance.currency), sub: true });
					}
					if (typeof balance.granted === "number") {
						balanceGroup.push({ label: t("tip.granted"), value: fmtMoney(balance.granted, balance.currency), sub: true });
					}
				}
				if (data.updatedAt) metaGroup.push({ label: t("tip.updated"), value: fmtTime(data.updatedAt) });
				metaGroup.push({ label: t("tip.auto"), value: auto ? t("tip.autoOn") : t("tip.autoOff") });
			}
			if (balanceGroup.length > 0) groups.push(balanceGroup);
			if (metaGroup.length > 0) groups.push(metaGroup);

			const tipNodes = [];
			let rowKey = 0;
			groups.forEach((group, gi) => {
				if (gi > 0) tipNodes.push(react_jsx_runtime.jsx("div", { className: "dsau-tip-sep" }, "sep" + gi));
				for (const row of group) {
					rowKey += 1;
					tipNodes.push(react_jsx_runtime.jsx("div", {
						className: "dsau-tip-row" + (row.sub ? " dsau-tip-sub" : ""),
						children: [
							react_jsx_runtime.jsx("span", { className: "dsau-tip-label" + (row.hint ? " dsau-tip-hint" : ""), children: row.label }, "l" + rowKey),
							react_jsx_runtime.jsx("span", {
								className: "dsau-tip-value" + (row.hint ? " dsau-tip-hint" : "") + (row.error ? " dsau-tip-error" : ""),
								children: row.value
							}, "v" + rowKey)
						]
					}, "row" + rowKey));
				}
			});

			// ---- render ----------------------------------------------------
			return react_jsx_runtime.jsx("div", {
				className: "dsau" + (loading ? " dsau-loading" : ""),
				children: [
					react_jsx_runtime.jsx("button", {
						type: "button",
						className: "dsau-chip",
						onClick: () => {
							refresh();
						},
						title: t("chip.title"),
						"aria-label": t("chip.aria"),
						disabled: loading,
						children: chipText
					}, "chip"),
					react_jsx_runtime.jsx("label", {
						className: "dsau-toggle",
						title: t("auto.title"),
						children: [
							react_jsx_runtime.jsx("input", { type: "checkbox", checked: auto, onChange: onToggle, "aria-label": t("auto.aria") }, "toggle-input"),
							react_jsx_runtime.jsx("span", {
								className: "dsau-toggle-track",
								children: react_jsx_runtime.jsx("span", { className: "dsau-toggle-thumb" })
							}, "toggle-track")
						]
					}, "toggle"),
					react_jsx_runtime.jsx("div", { className: "dsau-tip", role: "tooltip", children: tipNodes }, "tip")
				]
			});
		}
		//#endregion

		//#region plugin
		/** Required client services: the locale registry and the slot registry. */
		const inject = ["locale", "slots"];

		/**
		 * Client plugin body.
		 * @param {import('@deepseek-ai/cordis').Context} ctx - client root context.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-deepseek-balance: dictionaries");
			// Wait for the seat's declaration, then register; unloading the plugin
			// removes the entry with the fiber.
			ctx.slots.inject("conversation.input.right", () => ctx.slots.register({
				name: "conversation.input.right",
				id: "deepseek-balance",
				order: 0,
				locale: NS
			}, UsageWidget));
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
