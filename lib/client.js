window.__ModuleLoader__.load({
	id: "dsh-model-manager",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		//#endregion
		let react = require("react");
		react = __toESM(react, 1);
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/transport.ts
		/** HTTP uses Desktop's authenticated same-origin forwarder; streamBaseUrl is
		* the separate loopback transport advertised for streaming connections. */
		function hostRouteUrl(path) {
			const location = globalThis.location;
			if (location?.protocol === "dsh-app:") return new URL(path, "dsh-app://app/").href;
			if (location && ["http:", "https:"].includes(location.protocol)) return new URL(path, location.href).href;
			const transport = globalThis.__DSH_TRANSPORT__;
			if (transport?.streamBaseUrl) return new URL(path, `${transport.streamBaseUrl.replace(/\/+$/, "")}/`).href;
			return path;
		}
		//#endregion
		//#region src/client/auto-tabs.tsx
		const labels = {
			simple: "简单任务",
			normal: "常规任务",
			complex: "复杂任务"
		};
		const grades = [
			"simple",
			"normal",
			"complex"
		];
		const types = {
			coding: "编码",
			writing: "写作",
			research: "调研",
			analysis: "分析",
			general: "通用"
		};
		async function request$1(path, init) {
			const response = await fetch(hostRouteUrl(`/api/model-manager${path}`), {
				headers: { "Content-Type": "application/json" },
				...init
			});
			const value = await response.json();
			if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`);
			return value;
		}
		function key$1(ref) {
			return JSON.stringify([ref.providerId, ref.modelId]);
		}
		function parse(value) {
			if (!value) return void 0;
			if (value.startsWith("@")) return value;
			const [providerId, modelId] = JSON.parse(value);
			return {
				providerId,
				modelId
			};
		}
		function Pick({ value, models, aliases, onChange }) {
			const missing = value && (typeof value === "string" ? !aliases.includes(value.slice(1)) : !models.some((model) => key$1(model) === key$1(value)));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
				value: typeof value === "string" ? value : value ? key$1(value) : "",
				onChange: (event) => onChange(parse(event.target.value)),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
						value: "",
						children: "未设置"
					}),
					aliases.map((alias) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
						value: `@${alias}`,
						children: ["@", alias]
					}, alias)),
					missing && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
						value: typeof value === "string" ? value : key$1(value),
						children: [typeof value === "string" ? value : `${value.providerId}/${value.modelId}`, "（失效：别名未绑定或模型未加载）"]
					}),
					models.map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
						value: key$1(model),
						children: [
							model.name,
							" · ",
							model.providerId
						]
					}, key$1(model)))
				]
			});
		}
		function Effort({ selection, draft, models, onChange }) {
			const target = selection.target;
			const records = (typeof target === "string" ? draft.aliases[target.slice(1)]?.candidates ?? [] : target ? [target] : []).map((ref) => models.find((model) => key$1(model) === key$1(ref))).filter((model) => !!model);
			const efforts = records.length ? records[0].reasoningEfforts.filter((e) => records.every((model) => model.reasoningEfforts.some((item) => item.id === e.id))) : [];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
				value: selection.reasoningEffort ?? "",
				onChange: (event) => onChange(event.target.value || void 0),
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
					value: "",
					children: "使用模型默认"
				}), efforts.map((e) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
					value: e.id,
					children: [
						e.id === "off" ? "关闭思考" : e.name,
						"（",
						e.id,
						"）"
					]
				}, e.id))]
			});
		}
		function AutoTab({ draft, models, aliases, edit, notify }) {
			const [runner, setRunner] = (0, react.useState)();
			const [suggestion, setSuggestion] = (0, react.useState)();
			const [busy, setBusy] = (0, react.useState)(false);
			const recommend = async () => {
				setBusy(true);
				try {
					setSuggestion(await request$1("/recommend", {
						method: "POST",
						body: JSON.stringify({ evaluator: runner })
					}));
				} catch (error) {
					notify("error", String(error));
				} finally {
					setBusy(false);
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dmm-card",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dmm-switch-row",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "AUTO 自动选模型" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dmm-muted",
							children: "每轮用户消息评估一次任务等级，再选择主模型。"
						})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							checked: draft.auto.enabled,
							onChange: (event) => edit((next) => {
								next.auto.enabled = event.target.checked;
							})
						}), draft.auto.enabled ? "已开启" : "未启用"] })]
					})
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dmm-card",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "评估模型" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dmm-row",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Pick, {
								value: draft.auto.evaluator,
								models,
								aliases: [],
								onChange: (value) => edit((next) => {
									next.auto.evaluator = value && typeof value !== "string" ? value : void 0;
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["评估推理档位 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Effort, {
								selection: {
									target: draft.auto.evaluator,
									reasoningEffort: draft.auto.evaluatorReasoningEffort
								},
								draft,
								models,
								onChange: (value) => edit((next) => {
									next.auto.evaluatorReasoningEffort = value;
								})
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dmm-muted",
								children: "只判断任务难度。评估超时或无效时使用常规档。"
							})
						]
					})]
				}),
				grades.map((grade) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dmm-card",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: labels[grade] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dmm-row",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["执行模型 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Pick, {
								value: draft.auto[grade].target,
								models,
								aliases,
								onChange: (value) => edit((next) => {
									next.auto[grade].target = value;
									next.auto[grade].reasoningEffort = void 0;
								})
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["推理档位 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Effort, {
								selection: draft.auto[grade],
								draft,
								models,
								onChange: (value) => edit((next) => {
									next.auto[grade].reasoningEffort = value;
								})
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["输出上限 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "number",
								min: "1",
								placeholder: "使用模型默认",
								value: draft.auto[grade].maxOutputTokens ?? "",
								onChange: (event) => edit((next) => {
									next.auto[grade].maxOutputTokens = event.target.value ? Number(event.target.value) : void 0;
								})
							})] })
						]
					})]
				}, grade)),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dmm-card",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "任务规则（按顺序优先匹配）" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dmm-muted",
							children: "首个匹配且满足能力要求的规则生效；没有可用规则时使用三档配置，并向更高档尝试。"
						}),
						(draft.auto.rules ?? []).map((rule, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dmm-card",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dmm-row",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											type: "checkbox",
											checked: rule.enabled,
											onChange: (e) => edit((next) => {
												next.auto.rules[index].enabled = e.target.checked;
											})
										}), "启用"] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											"aria-label": "规则名称",
											value: rule.name,
											onChange: (e) => edit((next) => {
												next.auto.rules[index].name = e.target.value;
											})
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											disabled: !index,
											onClick: () => edit((next) => {
												const list = next.auto.rules;
												[list[index - 1], list[index]] = [list[index], list[index - 1]];
											}),
											children: "上移"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											disabled: index === (draft.auto.rules?.length ?? 0) - 1,
											onClick: () => edit((next) => {
												const list = next.auto.rules;
												[list[index + 1], list[index]] = [list[index], list[index + 1]];
											}),
											children: "下移"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											onClick: () => edit((next) => {
												next.auto.rules.splice(index, 1);
											}),
											children: "删除规则"
										})
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dmm-row",
									children: Object.entries(types).map(([value, label]) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "checkbox",
										checked: rule.taskTypes.includes(value),
										onChange: (e) => edit((next) => {
											const r = next.auto.rules[index];
											r.taskTypes = e.target.checked ? [...r.taskTypes, value] : r.taskTypes.filter((t) => t !== value);
										})
									}), label] }, value))
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dmm-row",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "复杂度（全不选表示不限）" }), grades.map((value) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "checkbox",
										checked: rule.grades?.includes(value) ?? false,
										onChange: (e) => edit((next) => {
											const r = next.auto.rules[index];
											const list = e.target.checked ? [...r.grades ?? [], value] : (r.grades ?? []).filter((g) => g !== value);
											r.grades = list.length ? list : void 0;
										})
									}), labels[value]] }, value))]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dmm-row",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Pick, {
											value: rule.selection.target,
											models,
											aliases,
											onChange: (value) => edit((next) => {
												next.auto.rules[index].selection = {
													...rule.selection,
													target: value,
													reasoningEffort: void 0
												};
											})
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Effort, {
											selection: rule.selection,
											draft,
											models,
											onChange: (value) => edit((next) => {
												next.auto.rules[index].selection.reasoningEffort = value;
											})
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["输出上限 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											type: "number",
											min: "1",
											placeholder: "使用模型默认",
											value: rule.selection.maxOutputTokens ?? "",
											onChange: (e) => edit((next) => {
												next.auto.rules[index].selection.maxOutputTokens = e.target.value ? Number(e.target.value) : void 0;
											})
										})] })
									]
								})
							]
						}, rule.id)),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							onClick: () => edit((next) => {
								next.auto.rules ??= [];
								next.auto.rules.push({
									id: crypto.randomUUID(),
									name: "新任务规则",
									enabled: false,
									taskTypes: ["coding"],
									selection: {}
								});
							}),
							children: "添加任务规则"
						})
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dmm-card",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "生成配置建议" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dmm-muted",
							children: "单独选择推荐模型，根据当前目录生成三个执行档的草案。应用后仍需保存设置。"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dmm-row",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Pick, {
								value: runner,
								models,
								aliases: [],
								onChange: (value) => setRunner(value && typeof value !== "string" ? value : void 0)
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								disabled: busy || !models.length,
								onClick: () => void recommend(),
								children: "生成建议"
							})]
						}),
						suggestion && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dmm-muted",
								children: "检查模型选择，确认后应用到表单。"
							}),
							grades.map((grade) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dmm-row",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: labels[grade] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Pick, {
									value: suggestion.grades[grade]?.target,
									models,
									aliases,
									onChange: (value) => setSuggestion((current) => current && {
										...current,
										grades: {
											...current.grades,
											[grade]: { target: value }
										}
									})
								})]
							}, grade)),
							suggestion.notes.map((note, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dmm-muted",
								children: note
							}, index)),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								onClick: () => {
									edit((next) => {
										for (const grade of grades) if (suggestion.grades[grade]?.target) next.auto[grade] = {
											...next.auto[grade],
											...suggestion.grades[grade]
										};
									});
									setSuggestion(void 0);
								},
								children: "应用到表单"
							})
						] })
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
					className: "dmm-guide",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "生效规则" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "只在模型选择器选中 AUTO 时评估主任务。本轮工具调用复用同一次结果。子 Agent 使用 DSH 原生模型选择。旧配置在启用新 AUTO 前继续沿用旧主模型。" })]
				})
			] });
		}
		//#endregion
		//#region src/official-types.ts
		const DEFAULT_OFFICIAL_URL = "https://api-docs.deepseek.com/zh-cn/";
		function officialAnalysisTimeout(value = 180) {
			if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 30 || value > 600) throw new Error("每轮分析时限必须是 30–600 的整数秒");
			return value;
		}
		function predictedModelCount(preview, selected) {
			const ids = new Set(preview.localModelIds);
			for (const diff of preview.diffs.filter((item) => selected.includes(item.id) && !item.blockedReasons.length)) {
				if (diff.field === "addModel") ids.add(diff.modelId);
				if (diff.field === "removeModel") ids.delete(diff.modelId);
				if (diff.field === "migrateModel") {
					diff.after.oldIds.forEach((id) => ids.delete(id));
					ids.add(diff.modelId);
				}
			}
			return ids.size;
		}
		//#endregion
		//#region src/client/official-stream.ts
		/** POST SSE：网络分片可切在任何字符或事件边界，result 必须是唯一终止结果。 */
		async function readOfficialStream(response, progress) {
			if (!response.ok) {
				const value = await response.json();
				throw new Error(value.error ?? `HTTP ${response.status}`);
			}
			if (!response.body) throw new Error("浏览器无法读取分析进度");
			const reader = response.body.getReader(), decoder = new TextDecoder();
			let buffer = "", result;
			const consume = (frame) => {
				const lines = frame.split("\n"), event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
				const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
				if (!data) return;
				const value = JSON.parse(data);
				if (event === "progress") progress(value);
				if (event === "error") throw new Error(value.error ?? "资料分析失败");
				if (event === "result") {
					if (result || !value?.token || !value.analysis?.complete) throw new Error("同步结果无效");
					result = value;
				}
			};
			try {
				while (true) {
					const chunk = await reader.read();
					buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
					buffer = buffer.replace(/\r\n/g, "\n");
					let index;
					while ((index = buffer.indexOf("\n\n")) >= 0) {
						consume(buffer.slice(0, index));
						buffer = buffer.slice(index + 2);
					}
					if (buffer.length > 2e6) throw new Error("同步响应过大");
					if (chunk.done) break;
				}
				if (buffer.trim()) throw new Error("分析进度连接不完整");
				if (!result) throw new Error("分析中断，请重新刷新");
				return result;
			} finally {
				await reader.cancel().catch(() => {});
				reader.releaseLock();
			}
		}
		//#endregion
		//#region src/client/official-progress.tsx
		function OfficialProgressStatus({ progress }) {
			const [now, setNow] = (0, react.useState)(() => Date.now());
			const start = progress?.stage === "analyzing" ? progress.analysisStartedAt : void 0;
			(0, react.useEffect)(() => {
				if (!start || !Number.isFinite(Date.parse(start))) return;
				setNow(Date.now());
				const timer = window.setInterval(() => setNow(Date.now()), 1e3);
				return () => window.clearInterval(timer);
			}, [start]);
			if (!progress) return null;
			const elapsed = start ? Math.max(0, Math.floor((now - Date.parse(start)) / 1e3)) : void 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
				role: "status",
				children: [
					{
						reading: "读取网页",
						analyzing: "分析资料",
						diffing: "生成差异"
					}[progress.stage],
					"… 已读取 ",
					progress.pageCount,
					" 页",
					progress.round ? `，第 ${progress.round} 轮` : "",
					Number.isFinite(elapsed) && progress.analysisTimeoutSeconds ? `，本轮已用 ${elapsed} 秒 / 时限 ${progress.analysisTimeoutSeconds} 秒` : ""
				]
			});
		}
		//#endregion
		//#region src/client/catalog-panel.tsx
		async function catalogRequest(path, value) {
			const response = await fetch(hostRouteUrl(`/api/model-manager/${path}`), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(value)
			});
			const body = await response.json();
			if (!response.ok) throw Object.assign(new Error(body.error ?? `HTTP ${response.status}`), { existingModel: body.existingModel });
			return body;
		}
		function CatalogPreviewPanel({ view, selected, busy, onResolve }) {
			const resolutions = view.operations.flatMap((operation) => operation.choices.filter((c) => c.resolution).map((c) => ({
				id: c.id,
				optionId: c.resolution
			})));
			const labels = {
				add: "新增模型",
				rename: "修改显示名称",
				remove: "删除模型",
				update: "更新声明",
				migrate: "整体合并迁移",
				removeAlias: "删除别名",
				clearLegacyPreferences: "清理旧分工偏好",
				clearLegacyImageOverrides: "清理旧插件图片声明",
				clearLegacyAliasReliability: "清理旧别名恢复策略"
			};
			const pathLabel = (path) => ({
				"auto.main.target": "旧主模型绑定",
				"auto.simple.target": "AUTO 简单任务",
				"auto.normal.target": "AUTO 常规任务",
				"auto.complex.target": "AUTO 复杂任务",
				"vision.target": "当前视觉模型",
				"auto.roles.vision.target": "旧视觉兜底",
				"agent-default-model.model": "宿主默认模型"
			})[path] ?? (path.startsWith("auto.preferences.") ? "分工偏好" : path.startsWith("auto.roles.") ? "旧角色模型" : path.startsWith("overrides.") ? "未来会话／下一轮模型覆盖" : path.startsWith("subagent-model-selection.") ? "子 Agent 模型范围" : path);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "dmm-muted",
					children: "只在应用时写入；处理冲突和引用不会调用 LLM。选中操作整体应用。"
				}),
				view.counts.filter((c) => c.operationCount || view.operations.some((o) => o.model?.providerId === c.providerId)).map((c) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
					c.providerId,
					"：本地 ",
					c.before,
					" 个 → 选中操作后 ",
					c.after,
					" 个；",
					c.operationCount,
					" 项选中操作"
				] }, c.providerId)),
				view.operations.map((operation) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dmm-card",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "checkbox",
								disabled: busy || !!operation.blockedReasons.length && !selected.includes(operation.id),
								checked: selected.includes(operation.id),
								onChange: (e) => onResolve(e.target.checked ? [...selected, operation.id] : selected.filter((id) => id !== operation.id), resolutions)
							}),
							labels[operation.kind],
							"：",
							!operation.model ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "已停用的历史字段" }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: operation.kind === "removeAlias" ? `@${operation.model.modelId.slice(6)}` : operation.model.modelId }),
								" · ",
								operation.model.providerId
							] })
						] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							className: "dmm-muted",
							children: [
								JSON.stringify(operation.before),
								" → ",
								operation.kind === "clearLegacyPreferences" ? "移除旧偏好字段" : JSON.stringify(operation.after)
							]
						}),
						!!operation.referenceChanges?.length && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
							open: true,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "引用与视觉开关变化" }), operation.referenceChanges.map((change) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								className: "dmm-muted",
								children: [
									change.path,
									"：",
									JSON.stringify(change.before),
									" → ",
									JSON.stringify(change.after)
								]
							}, change.path))]
						}),
						!!operation.references.filter((r) => r.type === "usage").length && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "使用引用" }), operation.references.filter((r) => r.type === "usage").map((r, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dmm-muted",
							children: r.chain?.join(" → ") ?? r.path
						}, i))] }),
						!!operation.attachedSettings.length && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
							open: true,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "附属设置（将随明确确认的删除清理并备份）" }), operation.attachedSettings.map((path) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dmm-muted",
								children: path
							}, path))]
						}),
						operation.choices.map((choice) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dmm-row",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [
								pathLabel(choice.path),
								" ",
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "dmm-muted",
									children: [
										"（",
										choice.path,
										"）"
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
									"aria-label": pathLabel(choice.path),
									disabled: busy,
									value: choice.resolution ?? "",
									onChange: (e) => {
										const next = resolutions.filter((r) => r.id !== choice.id);
										if (e.target.value) next.push({
											id: choice.id,
											optionId: e.target.value
										});
										onResolve(selected, next);
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "",
										children: "请选择处理方式"
									}), choice.options.map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: option.optionId,
										children: option.label
									}, option.optionId))]
								})
							] }), choice.kind === "vision" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dmm-muted",
								children: "取消删除：不勾选本组；共享别名等其他引用仍需处理。"
							})]
						}, choice.id)),
						(operation.kind === "remove" || operation.kind === "removeAlias") && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							disabled: busy,
							onClick: () => onResolve(selected.filter((id) => id !== operation.id), resolutions),
							children: "取消删除（保留原配置）"
						}),
						operation.blockedReasons.map((reason, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dmm-error",
							children: reason
						}, i))
					]
				}, operation.id))
			] });
		}
		function LegacyPreferencesManager({ config, dirty, externalBusy, backupId, onApplied, notify, onBusyChange, aliasCount }) {
			const [view, setView] = (0, react.useState)(null), [working, setWorking] = (0, react.useState)(false), [error, setError] = (0, react.useState)("");
			const busy = working || externalBusy, exists = aliasCount === void 0 ? Object.hasOwn(config.auto, "preferences") : aliasCount > 0;
			const aliasCleanup = aliasCount !== void 0, title = aliasCleanup ? "旧别名恢复策略" : "旧分工偏好";
			const operation = aliasCleanup ? "clearLegacyAliasReliability" : "clearLegacyPreferences";
			(0, react.useEffect)(() => {
				setView(null);
				setError("");
			}, [config, dirty]);
			const act = async (action) => {
				if (dirty || busy) return;
				setWorking(true);
				onBusyChange(true);
				setError("");
				try {
					await action();
				} catch (failure) {
					setView(null);
					setError(String(failure));
					notify("error", String(failure));
				} finally {
					setWorking(false);
					onBusyChange(false);
				}
			};
			if (!exists && !backupId) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dmm-card",
				children: [
					exists && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("strong", { children: [title, "已停用"] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dmm-muted",
							children: aliasCleanup ? `${aliasCount} 个别名有旧策略。清理只删除旧次数、重试和降级字段，保留候选、推理档位、未知设置及全部使用引用。` : "这些历史设置已不再用于子任务分工。清理只移除旧偏好，保留旧主模型、视觉兜底和官方子 Agent 设置。"
						}),
						!aliasCleanup && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "查看旧偏好" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", { children: JSON.stringify(config.auto.preferences, null, 2) })] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							disabled: busy || dirty,
							onClick: () => void act(async () => {
								setView(null);
								setView(await catalogRequest("catalog-preview", { operations: [{ kind: operation }] }));
							}),
							children: "预览清理"
						})
					] }),
					backupId && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						disabled: busy || dirty,
						onClick: () => void act(async () => {
							const result = await catalogRequest("catalog-restore", { backupId });
							setView(null);
							onApplied(result.snapshot);
							notify("success", `已恢复最近操作；${title}仍处于停用状态。`);
						}),
						children: "恢复最近操作"
					}),
					dirty && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dmm-dirty",
						children: "有未保存的插件草稿。先保存，或点“重新加载”放弃草稿，再重新预览。"
					}),
					error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "alert",
						className: "dmm-error",
						children: error
					}),
					view && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CatalogPreviewPanel, {
							view,
							selected: view.selected,
							busy: busy || dirty,
							onResolve: (selected, resolutions) => void act(async () => {
								setView(await catalogRequest("catalog-resolve", {
									token: view.token,
									selected,
									resolutions
								}));
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: "dmm-primary",
							disabled: busy || dirty || !view.selected.length,
							onClick: () => void act(async () => {
								const result = await catalogRequest("catalog-apply", {
									token: view.token,
									selected: view.selected
								});
								setView(null);
								onApplied(result.snapshot);
								notify("success", `已清理${title}，可恢复本次操作。`);
							}),
							children: "应用清理"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							disabled: busy,
							onClick: () => setView(null),
							children: "取消清理"
						})
					] })
				]
			});
		}
		function AliasRemovalManager({ name, close, dirty, externalBusy, backupId, onApplied, notify, onBusyChange }) {
			const [view, setView] = (0, react.useState)(null), [working, setWorking] = (0, react.useState)(false), [error, setError] = (0, react.useState)("");
			const busy = working || externalBusy;
			(0, react.useEffect)(() => {
				setView(null);
				setError("");
			}, [name, dirty]);
			const act = async (action) => {
				setWorking(true);
				onBusyChange(true);
				setError("");
				try {
					await action();
				} catch (failure) {
					setView(null);
					setError(String(failure));
					notify("error", String(failure));
				} finally {
					setWorking(false);
					onBusyChange(false);
				}
			};
			const preview = () => void act(async () => {
				if (!name || dirty) return;
				setView(null);
				setView(await catalogRequest("catalog-preview", { operations: [{
					kind: "removeAlias",
					name
				}] }));
			});
			const resolve = (selected, resolutions) => void act(async () => {
				if (!view || dirty) return;
				setView(await catalogRequest("catalog-resolve", {
					token: view.token,
					selected,
					resolutions
				}));
			});
			const apply = () => void act(async () => {
				if (!view || dirty) return;
				const result = await catalogRequest("catalog-apply", {
					token: view.token,
					selected: view.selected
				});
				setView(null);
				close();
				onApplied(result.snapshot);
				notify("success", "已删除别名并处理引用；真实模型保留，可恢复本次操作。");
			});
			const restore = () => void act(async () => {
				if (dirty || !backupId) return;
				const result = await catalogRequest("catalog-restore", { backupId });
				setView(null);
				close();
				onApplied(result.snapshot);
				notify("success", "已恢复本次操作及其引用。");
			});
			if (!name && !backupId) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dmm-card",
				id: "dmm-alias-removal",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dmm-row",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: name ? `删除别名 @${name}` : "操作恢复" }), backupId && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							disabled: busy || dirty,
							onClick: restore,
							children: "恢复本次操作及引用"
						})]
					}),
					name && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dmm-muted",
						children: "先处理下面的使用引用，再整体删除。候选真实模型保留；旧主模型绑定也会显示在这里。"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dmm-row",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							disabled: busy || dirty,
							onClick: preview,
							children: "预览别名删除及引用"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							disabled: busy,
							onClick: () => {
								setView(null);
								close();
							},
							children: "取消删除"
						})]
					})] }),
					dirty && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dmm-dirty",
						children: "有未保存的插件草稿。先保存，或点“重新加载”放弃草稿，再重新预览；当前草稿不会被删除预览覆盖。"
					}),
					error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "alert",
						className: "dmm-error",
						children: error
					}),
					view && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CatalogPreviewPanel, {
						view,
						selected: view.selected,
						busy: busy || dirty,
						onResolve: resolve
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						className: "dmm-primary",
						disabled: busy || dirty || !view.selected.length || view.operations.some((o) => view.selected.includes(o.id) && o.blockedReasons.length > 0),
						onClick: apply,
						children: "应用别名删除及引用修改"
					})] })
				]
			});
		}
		function CatalogManager({ models, capabilities, editor, setEditor, dirty, externalBusy, backupId, backupWritesPlugin, onApplied, notify }) {
			const [provider, setProvider] = (0, react.useState)(""), [id, setId] = (0, react.useState)(""), [name, setName] = (0, react.useState)("");
			const [image, setImage] = (0, react.useState)(""), [context, setContext] = (0, react.useState)(""), [output, setOutput] = (0, react.useState)("");
			const [view, setView] = (0, react.useState)(null), [working, setBusy] = (0, react.useState)(false);
			const busy = working || externalBusy;
			const [existing, setExisting] = (0, react.useState)();
			(0, react.useEffect)(() => {
				setView(null);
				setExisting(void 0);
				setProvider(editor?.model?.providerId ?? capabilities.find((c) => c.canAdd)?.providerId ?? "");
				setId(editor?.model?.modelId ?? "");
				setName(models.find((m) => m.providerId === editor?.model?.providerId && m.modelId === editor?.model?.modelId)?.name ?? "");
				setImage("");
				setContext("");
				setOutput("");
			}, [editor]);
			const act = async (fn) => {
				setBusy(true);
				try {
					await fn();
				} catch (error) {
					const ref = error?.existingModel;
					if (ref) setExisting(ref);
					notify("error", String(error));
				} finally {
					setBusy(false);
				}
			};
			const invalidate = () => {
				setView(null);
				setExisting(void 0);
			};
			const preview = () => void act(async () => {
				setView(null);
				const model = {
					providerId: provider,
					modelId: id
				};
				const operation = editor?.kind === "rename" ? {
					kind: "rename",
					model,
					name
				} : editor?.kind === "remove" ? {
					kind: "remove",
					model
				} : {
					kind: "add",
					model,
					...name ? { name } : {},
					...image ? { image: image === "yes" } : {},
					...context ? { contextWindow: Number(context) } : {},
					...output ? { maxTokens: Number(output) } : {}
				};
				setView(await catalogRequest("catalog-preview", { operations: [operation] }));
			});
			const resolve = (selected, resolutions) => void act(async () => {
				if (!view) return;
				const next = await catalogRequest("catalog-resolve", {
					token: view.token,
					selected,
					resolutions
				});
				setView(next.catalog ?? next);
			});
			const apply = () => void act(async () => {
				if (!view || dirty && view.writesPlugin) return;
				const result = await catalogRequest("catalog-apply", {
					token: view.token,
					selected: view.selected
				});
				setView(null);
				setEditor(null);
				onApplied(result.snapshot);
				notify("success", "已应用本次目录修改，可恢复本次操作。");
			});
			const restore = () => void act(async () => {
				if (dirty && backupWritesPlugin !== false) return;
				onApplied((await catalogRequest("catalog-restore", { backupId })).snapshot);
				setView(null);
				notify("success", "已恢复本次目录操作。");
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dmm-card",
				id: "dmm-catalog-editor",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dmm-row",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "模型目录管理" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								disabled: busy || !capabilities.some((c) => c.canAdd),
								onClick: () => setEditor({ kind: "add" }),
								children: "新增模型"
							}),
							backupId && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								disabled: busy || dirty && backupWritesPlugin !== false,
								onClick: restore,
								children: "恢复本次目录操作"
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dmm-muted",
						children: "API ID 用于调用；显示名称用于 DSH 展示。修改名称不改变实际模型。新增不会自动请求 API。"
					}),
					editor && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dmm-row",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["Provider ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
								disabled: busy || editor.kind !== "add",
								value: provider,
								onChange: (e) => {
									setProvider(e.target.value);
									invalidate();
								},
								children: capabilities.filter((c) => c.canAdd).map((c) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", { children: c.providerId }, c.providerId))
							})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["API 模型 ID ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								disabled: busy || editor.kind !== "add",
								value: id,
								onChange: (e) => {
									setId(e.target.value);
									invalidate();
								}
							})] })]
						}),
						editor.kind !== "remove" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dmm-row",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["显示名称 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								disabled: busy,
								value: name,
								onChange: (e) => {
									setName(e.target.value);
									invalidate();
								}
							})] })
						}),
						editor.kind === "add" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dmm-row",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["图片声明 ", /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
									value: image,
									disabled: busy,
									onChange: (e) => {
										setImage(e.target.value);
										invalidate();
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "",
											children: "使用 Provider 默认"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "yes",
											children: "支持图片"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "no",
											children: "仅文本"
										})
									]
								})] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["上下文 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "number",
									min: "1",
									disabled: busy,
									value: context,
									onChange: (e) => {
										setContext(e.target.value);
										invalidate();
									}
								})] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["输出上限 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "number",
									min: "1",
									disabled: busy,
									value: output,
									onChange: (e) => {
										setOutput(e.target.value);
										invalidate();
									}
								})] })
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dmm-row",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									disabled: busy || !id || !provider,
									onClick: preview,
									children: editor.kind === "remove" ? "预览删除及引用处理" : "预览本次修改"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									disabled: busy,
									onClick: () => {
										setEditor(null);
										setView(null);
									},
									children: "取消"
								}),
								existing && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									disabled: busy,
									onClick: () => setEditor({
										kind: "rename",
										model: existing
									}),
									children: "编辑已有模型"
								})
							]
						})
					] }),
					view && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CatalogPreviewPanel, {
						view,
						selected: view.selected,
						busy,
						onResolve: resolve
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						className: "dmm-primary",
						disabled: busy || dirty && view.writesPlugin || !view.selected.length || view.operations.some((o) => view.selected.includes(o.id) && o.blockedReasons.length),
						onClick: apply,
						children: "应用本次修改"
					})] }),
					dirty && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dmm-dirty",
						children: "有其他未保存插件草稿。仅更改宿主目录可直接应用；涉及插件设置时，先保存或放弃草稿，再重新预览。处理选项无需保存。"
					})
				]
			});
		}
		//#endregion
		//#region src/domain.ts
		/**
		* 把探测得到的验证证据映射成可预览的配置建议。
		* 只依据行为证据：识别出探测图颜色才算高置信；
		* 网络错误、取消、请求被拒一律不给建议，避免把偶发故障写成模型能力。
		*/
		function probeSuggestions(verifications) {
			const suggestions = [];
			for (const item of verifications) {
				if (item.kind !== "image") continue;
				if (item.status === "accepted" && item.behavior === "observed") suggestions.push({
					field: "hostImage",
					value: "yes",
					confidence: "high",
					reason: "图片探测通过：模型正确识别了探测图的颜色"
				});
			}
			return suggestions;
		}
		function fromManagedId(id) {
			try {
				let raw;
				if (id.includes("/")) {
					const parts = id.split("/");
					if (parts.length !== 2 || parts.some((part) => !part)) throw new Error();
					raw = parts.map((part) => decodeURIComponent(part));
				} else {
					if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error();
					const binary = atob(id.replace(/-/g, "+").replace(/_/g, "/"));
					if (btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") !== id) throw new Error();
					const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
					raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
				}
				if (!Array.isArray(raw) || raw.length !== 2 || raw.some((v) => typeof v !== "string" || !v)) throw new Error();
				return {
					providerId: raw[0],
					modelId: raw[1]
				};
			} catch {
				throw new Error("无效的受管理模型 ID");
			}
		}
		//#endregion
		//#region src/client/parameter-stream.ts
		async function readParameterStream(response, progress) {
			if (!response.ok) {
				const value = await response.json();
				throw new Error(value.error ?? `HTTP ${response.status}`);
			}
			if (!response.body) throw new Error("浏览器无法读取分析进度");
			const reader = response.body.getReader(), decoder = new TextDecoder();
			let buffer = "", result;
			const consume = (frame) => {
				const lines = frame.split("\n"), event = lines.find((l) => l.startsWith("event:"))?.slice(6).trim();
				const data = lines.filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
				if (!data) return;
				const value = JSON.parse(data);
				if (result && [
					"result",
					"error",
					"progress"
				].includes(event ?? "")) throw new Error("参数分析返回多个终止事件");
				if (event === "progress") progress(value);
				if (event === "error") throw new Error(value.error ?? "参数分析失败");
				if (event === "result") {
					if (typeof value?.token !== "string" || !Array.isArray(value.parameterAnalysis?.results) || !Array.isArray(value.selectedFields) || value.origin !== "parameter") throw new Error("参数分析结果无效");
					result = value;
				}
			};
			try {
				while (true) {
					const chunk = await reader.read();
					buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
					buffer = buffer.replace(/\r\n/g, "\n");
					let index;
					while ((index = buffer.indexOf("\n\n")) >= 0) {
						consume(buffer.slice(0, index));
						buffer = buffer.slice(index + 2);
					}
					if (buffer.length > 8e6) throw new Error("参数预览响应过大");
					if (chunk.done) break;
				}
				if (buffer.trim() || !result) throw new Error("参数分析连接不完整，请重新分析");
				return result;
			} finally {
				await reader.cancel().catch(() => {});
				reader.releaseLock();
			}
		}
		//#endregion
		//#region src/client/parameter-panel.tsx
		const key = (ref) => JSON.stringify([ref.providerId, ref.modelId]);
		const sources = {
			user: "用户显式配置",
			catalog: "内置目录",
			"provider-default": "Provider 默认",
			"runtime-default": "宿主兜底默认",
			unknown: "来源未核实"
		};
		const display = (value) => value === void 0 ? "未声明／未知" : JSON.stringify(value);
		function ParameterPanel({ models, config, revision, defaultModel, backupId, manualBackupId, legacyCount, dirty, externalBusy, onBusyChange, onApplied, onCredentialSaved, notify }) {
			const [filter, setFilter] = (0, react.useState)(""), [provider, setProvider] = (0, react.useState)(""), [picked, setPicked] = (0, react.useState)([]);
			const [analyzer, setAnalyzer] = (0, react.useState)(""), [effort, setEffort] = (0, react.useState)(""), [timeout, setTimeoutValue] = (0, react.useState)("180");
			const [credential, setCredential] = (0, react.useState)(config.parameterCompletion?.searchCredentialName ?? "WEB_SEARCH_API_KEY");
			const [view, setView] = (0, react.useState)(null), [cleanup, setCleanup] = (0, react.useState)(null);
			const [progress, setProgress] = (0, react.useState)(null), [working, setWorking] = (0, react.useState)(false), [error, setError] = (0, react.useState)(""), [now, setNow] = (0, react.useState)(Date.now());
			const abort = (0, react.useRef)(null), epoch = (0, react.useRef)(0);
			const busy = working || externalBusy;
			const realModels = models.filter((m) => m.loaded && m.providerId !== "dsh-model-manager");
			let realDefault = defaultModel;
			if (realDefault?.providerId === "dsh-model-manager") try {
				realDefault = fromManagedId(realDefault.modelId);
			} catch {
				realDefault = void 0;
			}
			const effectiveAnalyzer = realModels.find((m) => key(m) === (analyzer || (realDefault ? key(realDefault) : "")));
			const filtered = realModels.filter((m) => (!provider || m.providerId === provider) && `${m.modelId} ${m.name}`.toLowerCase().includes(filter.trim().toLowerCase()));
			const groups = [...new Set(filtered.map((m) => m.providerId))];
			const invalidate = () => {
				epoch.current++;
				abort.current?.abort();
				setView(null);
				setCleanup(null);
				setError("");
			};
			(0, react.useEffect)(() => {
				invalidate();
			}, [
				analyzer,
				effort,
				timeout,
				picked.join("|"),
				revision,
				models
			]);
			(0, react.useEffect)(() => {
				setEffort("");
			}, [
				analyzer,
				defaultModel?.providerId,
				defaultModel?.modelId
			]);
			(0, react.useEffect)(() => {
				setCredential(config.parameterCompletion?.searchCredentialName ?? "WEB_SEARCH_API_KEY");
			}, [config.parameterCompletion?.searchCredentialName]);
			(0, react.useEffect)(() => () => {
				epoch.current++;
				abort.current?.abort();
			}, []);
			(0, react.useEffect)(() => {
				if (!progress) return;
				const timer = window.setInterval(() => setNow(Date.now()), 1e3);
				return () => window.clearInterval(timer);
			}, [progress]);
			const act = async (action) => {
				if (busy) return;
				setWorking(true);
				onBusyChange(true);
				setError("");
				try {
					await action();
				} catch (failure) {
					setError(String(failure));
					notify("error", String(failure));
				} finally {
					setWorking(false);
					onBusyChange(false);
				}
			};
			const analyze = () => void act(async () => {
				invalidate();
				const generation = epoch.current, controller = new AbortController();
				abort.current = controller;
				setProgress({
					stage: "searching",
					modelIndex: 0,
					modelCount: picked.length,
					searchCount: 0,
					analysisCount: 0
				});
				try {
					const result = await readParameterStream(await fetch(hostRouteUrl("/api/model-manager/model-parameter-preview"), {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Accept: "text/event-stream"
						},
						body: JSON.stringify({
							models: realModels.filter((m) => picked.includes(key(m))).map(({ providerId, modelId }) => ({
								providerId,
								modelId
							})),
							analyzer: effectiveAnalyzer ? {
								providerId: effectiveAnalyzer.providerId,
								modelId: effectiveAnalyzer.modelId
							} : null,
							...effort ? { reasoningEffort: effort } : {},
							analysisTimeoutSeconds: Number(timeout)
						}),
						signal: controller.signal
					}), (value) => {
						if (epoch.current === generation && !controller.signal.aborted) setProgress(value);
					});
					if (controller.signal.aborted || epoch.current !== generation) return;
					setView(result);
					notify("info", "分析完成，请逐字段核对建议与依据；应用后才修改配置。");
				} catch (failure) {
					if (!controller.signal.aborted) throw failure;
					setError("分析已取消，配置未修改。");
				} finally {
					if (abort.current === controller) abort.current = null;
					setProgress(null);
				}
			});
			const resolve = (selectedFields, selected = view?.selected ?? [], resolutions) => void act(async () => {
				if (!view?.token) return;
				const choices = resolutions ?? view.operations.flatMap((o) => o.choices.filter((c) => c.resolution).map((c) => ({
					id: c.id,
					optionId: c.resolution
				})));
				const request = {
					token: view.token,
					selected,
					resolutions: choices,
					...selectedFields !== view.selectedFields ? { selectedFields } : {}
				};
				setView(await catalogRequest("catalog-resolve", request));
			});
			const restore = (id) => void act(async () => {
				if (dirty) return;
				invalidate();
				onApplied((await catalogRequest("catalog-restore", { backupId: id })).snapshot);
				notify("success", "已恢复本次操作；退役的插件图片声明仍不参与运行。");
			});
			const toggle = (keys, checked) => {
				setPicked((current) => checked ? [.../* @__PURE__ */ new Set([...current, ...keys])] : current.filter((k) => !keys.includes(k)));
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dmm-card",
				id: "dmm-parameter-completion",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "智能补全参数" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dmm-muted",
						children: "搜索平台官方资料，逐字段核对原生图片、上下文、最大输出、推理档位及协议兼容参数；资料不足时知识建议明确标注。分析会产生搜索与 LLM 用量。"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dmm-row",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["搜索凭据引用 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								disabled: busy,
								value: credential,
								onChange: (e) => setCredential(e.target.value)
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								disabled: busy || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(credential),
								onClick: () => void act(async () => {
									invalidate();
									onCredentialSaved((await catalogRequest("parameter-search-credential", {
										revision,
										name: credential
									})).snapshot);
									notify("success", "已保存搜索凭据引用，其他草稿保留。");
								}),
								children: "保存搜索引用"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dmm-muted",
								children: "在 DSH 凭据中配置 Agent Plan 专属 Key；这里只填引用名。"
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dmm-row",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["模型 ID／名称 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								value: filter,
								disabled: busy,
								onChange: (e) => setFilter(e.target.value)
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["Provider ", /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
								value: provider,
								disabled: busy,
								onChange: (e) => setProvider(e.target.value),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "",
									children: "全部 Provider"
								}), [...new Set(realModels.map((m) => m.providerId))].map((p) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", { children: p }, p))]
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								disabled: busy,
								onClick: () => toggle(filtered.map(key), true),
								children: "全选筛选结果"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								disabled: busy,
								onClick: () => setPicked([]),
								children: "清空选择"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
								"已选 ",
								picked.length,
								" 个"
							] })
						]
					}),
					groups.map((p) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("summary", { children: [
							p,
							" · ",
							filtered.filter((m) => m.providerId === p).length,
							" 个"
						] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							disabled: busy,
							checked: filtered.filter((m) => m.providerId === p).every((m) => picked.includes(key(m))),
							onChange: (e) => toggle(filtered.filter((m) => m.providerId === p).map(key), e.target.checked)
						}), "选择本组"] }),
						filtered.filter((m) => m.providerId === p).map((m) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "checkbox",
								disabled: busy,
								checked: picked.includes(key(m)),
								onChange: (e) => toggle([key(m)], e.target.checked)
							}),
							m.name,
							" ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dmm-muted",
								children: m.modelId
							})
						] }) }, key(m)))
					] }, p)),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dmm-row",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["本次分析模型 ", /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
								disabled: busy,
								value: analyzer,
								onChange: (e) => setAnalyzer(e.target.value),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
									value: "",
									children: ["宿主默认：", effectiveAnalyzer?.name ?? "未设置真实模型"]
								}), realModels.map((m) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
									value: key(m),
									children: [
										m.name,
										" · ",
										m.providerId
									]
								}, key(m)))]
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["本次推理档位 ", /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
								disabled: busy,
								value: effort,
								onChange: (e) => setEffort(e.target.value),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "",
									children: "模型默认"
								}), effectiveAnalyzer?.reasoningEfforts.map((e) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: e.id,
									children: e.name
								}, e.id))]
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["每轮分析时限（秒）", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "number",
								min: "30",
								max: "600",
								step: "1",
								disabled: busy,
								value: timeout,
								onChange: (e) => setTimeoutValue(e.target.value)
							})] })
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dmm-row",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: "dmm-primary",
								disabled: busy || !picked.length || picked.length > 100 || !effectiveAnalyzer || !Number.isInteger(Number(timeout)) || Number(timeout) < 30 || Number(timeout) > 600,
								onClick: analyze,
								children: "分析选中模型"
							}),
							abort.current && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								onClick: () => {
									epoch.current++;
									abort.current?.abort();
									setView(null);
								},
								children: "取消分析"
							}),
							backupId && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								disabled: busy || dirty,
								onClick: () => restore(backupId),
								children: "恢复最近参数修改"
							})
						]
					}),
					picked.length > 100 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dmm-error",
						children: "每批最多 100 个模型，请缩小选择范围。"
					}),
					progress && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						role: "status",
						children: [
							{
								searching: "搜索官方资料",
								reading: "读取正文",
								analyzing: "分析参数",
								planning: "构建预览"
							}[progress.stage],
							"：",
							progress.modelIndex,
							"/",
							progress.modelCount,
							" · ",
							progress.model?.modelId,
							" · 搜索 ",
							progress.searchCount,
							" 次、分析 ",
							progress.analysisCount,
							" 次",
							progress.stage === "analyzing" && progress.analysisStartedAt ? ` · 第 ${progress.round} 轮 ${Math.max(0, Math.floor((now - Date.parse(progress.analysisStartedAt)) / 1e3))}/${progress.analysisTimeoutSeconds} 秒` : ""
						]
					}),
					error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "alert",
						className: "dmm-error",
						children: error
					}),
					view && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						view.parameterAnalysis.results.map((result) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dmm-card",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("strong", { children: [
									result.model.modelId,
									" · ",
									result.model.providerId
								] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: {
									ready: "有待核对建议",
									"no-change": "没有需要修改的已知字段",
									failed: "分析失败，本模型无修改",
									unsupported: "该平台未适配可写字段"
								}[result.status] }),
								result.notes.map((note, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dmm-muted",
									children: note
								}, i)),
								result.suggestions.map((s) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dmm-card",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												type: "checkbox",
												disabled: busy || !view.token || !s.writable || s.value === void 0 || JSON.stringify(s.currentValue) === JSON.stringify(s.value),
												checked: view.selectedFields.includes(s.id),
												onChange: (e) => resolve(e.target.checked ? [...view.selectedFields, s.id] : view.selectedFields.filter((id) => id !== s.id))
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: s.label ?? s.field.join(".") }),
											" · ",
											{
												official: "官方原文",
												knowledge: "知识建议（未验证）",
												unknown: "未知，不修改"
											}[s.basis]
										] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
											"当前：",
											display(s.currentValue),
											"（",
											sources[s.currentSource],
											"） → 建议：",
											display(s.value)
										] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
											className: "dmm-muted",
											children: [
												s.reason,
												s.effect ? ` · 修改效果：${s.effect}` : "",
												s.blockedReason ? ` · 不可写：${s.blockedReason}` : ""
											]
										}),
										s.evidence.map((e, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("a", {
											href: e.source,
											target: "_blank",
											rel: "noreferrer",
											children: ["官方证据 ", new URL(e.source).hostname]
										}) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("blockquote", { children: e.quote })] }, i))
									]
								}, s.id))
							]
						}, key(result.model))),
						!!view.operations.length && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CatalogPreviewPanel, {
							view,
							selected: view.selected,
							busy,
							onResolve: (selected, resolutions) => resolve(view.selectedFields, selected, resolutions)
						}),
						dirty && view.writesPlugin && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dmm-dirty",
							children: "本次包含名称来源或引用修改，请先保存或放弃其他草稿，再重新分析。"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: "dmm-primary",
							disabled: busy || !view.token || !view.selected.length || dirty && view.writesPlugin || view.operations.some((o) => view.selected.includes(o.id) && o.blockedReasons.length),
							onClick: () => void act(async () => {
								const result = await catalogRequest("catalog-apply", {
									token: view.token,
									selected: view.selected
								});
								invalidate();
								onApplied(result.snapshot);
								notify("success", "已应用选中参数并刷新目录，可恢复本次操作。");
							}),
							children: "应用选中参数"
						})
					] }),
					legacyCount > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dmm-card",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "旧插件图片声明已停用" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								className: "dmm-muted",
								children: [
									"检测到 ",
									legacyCount,
									" 项旧声明，图片能力统一采用宿主原生目录。清理会备份原值，不改变原生图片参数。"
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								disabled: busy || dirty,
								onClick: () => void act(async () => {
									invalidate();
									setCleanup(await catalogRequest("catalog-preview", { operations: [{ kind: "clearLegacyImageOverrides" }] }));
								}),
								children: "预览清理旧图片声明"
							}),
							manualBackupId && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								disabled: busy || dirty,
								onClick: () => restore(manualBackupId),
								children: "恢复最近目录操作"
							}),
							dirty && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dmm-dirty",
								children: "请先保存或放弃其他草稿，再预览清理。"
							})
						]
					}),
					cleanup && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CatalogPreviewPanel, {
							view: cleanup,
							selected: cleanup.selected,
							busy: busy || dirty,
							onResolve: (selected, resolutions) => void act(async () => setCleanup(await catalogRequest("catalog-resolve", {
								token: cleanup.token,
								selected,
								resolutions
							})))
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							disabled: busy || dirty || !cleanup.selected.length,
							onClick: () => void act(async () => {
								const result = await catalogRequest("catalog-apply", {
									token: cleanup.token,
									selected: cleanup.selected
								});
								invalidate();
								onApplied(result.snapshot);
								notify("success", "已清理旧图片声明，可恢复最近目录操作。");
							}),
							children: "应用旧图片声明清理"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							disabled: busy,
							onClick: () => setCleanup(null),
							children: "取消清理"
						})
					] })
				]
			});
		}
		//#endregion
		//#region src/client/source-panel.tsx
		function SourcePanel({ dirty, disabled, onApplied, onRefresh, navigate, backupId }) {
			const [sources, setSources] = (0, react.useState)([]), [ark, setArk] = (0, react.useState)(), [kind, setKind] = (0, react.useState)("deepseek");
			const [provider, setProvider] = (0, react.useState)("deepseek-official"), [sourceId, setSourceId] = (0, react.useState)(), [profile, setProfile] = (0, react.useState)(""), [newKey, setNewKey] = (0, react.useState)(""), [credential, setCredential] = (0, react.useState)();
			const [connection, setConnection] = (0, react.useState)({}), [owners, setOwners] = (0, react.useState)([]), [protocols, setProtocols] = (0, react.useState)([]);
			const [preview, setPreview] = (0, react.useState)(), [selectedConnections, setSelectedConnections] = (0, react.useState)([]), [busy, setBusy] = (0, react.useState)(false), [reading, setReading] = (0, react.useState)(false), [message, setMessage] = (0, react.useState)("");
			const [auth, setAuth] = (0, react.useState)(), [code, setCode] = (0, react.useState)("");
			const generation = (0, react.useRef)(0), abort = (0, react.useRef)();
			const load = async () => {
				const r = await fetch(hostRouteUrl("/api/model-manager/sources"));
				const value = await r.json();
				if (!r.ok) throw Error(value.error);
				setSources(value.sources);
				setArk(value.ark);
				setOwners(value.owners ?? []);
				setProtocols(value.protocols ?? []);
			};
			(0, react.useEffect)(() => {
				load().catch((e) => setMessage(String(e)));
				return () => {
					generation.current++;
					abort.current?.abort();
				};
			}, []);
			const act = async (fn) => {
				setBusy(true);
				setMessage("");
				try {
					await fn();
				} catch (e) {
					setMessage(String(e));
				} finally {
					setBusy(false);
				}
			};
			const choose = (source, k = kind) => {
				generation.current++;
				abort.current?.abort();
				setPreview(void 0);
				setCredential(void 0);
				setNewKey("");
				setSourceId(source?.sourceId);
				setKind(source?.kind ?? k);
				setProvider(source?.providerId ?? (k === "deepseek" ? "deepseek-official" : k === "opencode-go" ? "opencode-go" : "ark-agent-plan"));
				setProfile(source?.arkProfile ?? "");
				setConnection({});
				setMessage("");
			};
			const read = async (ref = credential) => {
				const sequence = ++generation.current, controller = new AbortController();
				abort.current?.abort();
				abort.current = controller;
				setReading(true);
				setPreview(void 0);
				try {
					const response = await fetch(hostRouteUrl("/api/model-manager/sources/preview"), {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							kind,
							providerId: provider,
							sourceId,
							credentialRef: ref,
							arkProfile: profile || void 0,
							connection
						}),
						signal: controller.signal
					});
					const value = await response.json();
					if (sequence !== generation.current) return;
					if (!response.ok) throw Error(value.error);
					setPreview(value);
					setSelectedConnections(value.connectionChanges.filter((c) => c.selected).map((c) => c.fieldId));
					setMessage("目录已读取；检查原值与新值后应用。尚未修改模型配置。");
				} finally {
					setReading(false);
				}
			};
			const selected = sources.find((s) => s.sourceId === sourceId) ?? sources.find((s) => s.providerId === provider && s.kind === kind);
			const owner = owners.find((o) => o.sourceId === selected?.sourceId);
			const locked = busy || disabled;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dmm-card",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "模型来源" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dmm-muted",
							children: "先连接来源，再检查导入预览。目录刷新不删除下架模型，已有不同值保持不选；能力资料与真实调用验证分开。"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dmm-row",
							children: [
								"deepseek",
								"ark-agent-plan",
								"opencode-go"
							].map((k) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								"aria-pressed": kind === k,
								disabled: locked,
								onClick: () => choose(void 0, k),
								children: k === "deepseek" ? "DeepSeek 官方" : k === "ark-agent-plan" ? "火山 Agent Plan" : "OpenCode Go"
							}, k))
						}),
						sources.map((source) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dmm-row",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									disabled: locked,
									onClick: () => choose(source),
									children: source.providerId
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
									source.loaded ? "已加载" : "未加载",
									" · ",
									source.modelCount,
									" 个模型 · ",
									source.kind === "opencode-go" ? "账号由原插件管理" : source.credential.configured ? "凭据已配置" : "凭据未配置"
								] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "dmm-muted",
									children: [source.ownerEntryIds.join("、"), source.reason ? ` · ${source.reason}` : ""]
								})
							]
						}, source.sourceId))
					]
				}),
				kind === "opencode-go" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dmm-card",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "OpenCode Go 账号与目录" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "沿用原插件的多账号、用量与目录同步功能。图片和推理声明从宿主读取。" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							disabled: !navigate || locked || !sources.find((s) => s.kind === "opencode-go")?.ownerEntryIds.length,
							onClick: navigate,
							children: "账号与来源设置"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							disabled: locked,
							onClick: () => void act(async () => {
								await onRefresh();
								await load();
								setMessage("已读取 OpenCode Go 的当前目录。");
							}),
							children: "返回后刷新目录"
						}),
						!navigate && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dmm-muted",
							children: "当前宿主未提供插件导航，请在原生插件页打开 OpenCode Go。"
						})
					]
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dmm-card",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: kind === "deepseek" ? "DeepSeek 官方连接" : "火山 Agent Plan 连接" }),
						kind === "ark-agent-plan" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dmm-row",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["来源标识 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									disabled: locked || !!sourceId,
									value: provider,
									onChange: (e) => {
										setProvider(e.target.value);
										setPreview(void 0);
									}
								})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["查询用 Profile ", /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
									disabled: locked,
									value: profile,
									onChange: (e) => {
										setProfile(e.target.value);
										setPreview(void 0);
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "",
										children: "请选择"
									}), (ark?.profiles ?? []).filter((p) => [
										"plan",
										"team",
										"agent-plan",
										"agent_plan"
									].includes(p.type)).map((p) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
										value: p.name,
										children: [
											p.name,
											"（",
											p.type,
											"）"
										]
									}, p.name))]
								})] })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								className: "dmm-muted",
								children: ["查询账号与调用 Key 独立；不会切换默认 Profile。", ark?.available ? "" : "本机 ArkCLI 状态暂不可用。"]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "连接火山账号" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dmm-muted",
									children: "点击后进入官方授权，登录可能更新本机 ArkCLI 身份和 Profile。完成后重新选择查询 Profile。"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									disabled: locked,
									onClick: () => void act(async () => setAuth(await catalogRequest("sources/ark-auth", { action: "start" }))),
									children: "连接火山账号"
								}),
								auth && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
											href: auth.authorizeUrl,
											target: "_blank",
											rel: "noreferrer",
											children: "打开本次官方授权页面"
										}),
										" · ",
										new Date(auth.expiresAt).toLocaleTimeString(),
										" 前有效"
									] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["本次授权码 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "password",
										autoComplete: "off",
										value: code,
										disabled: locked,
										onChange: (e) => setCode(e.target.value)
									})] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										disabled: locked || !code,
										onClick: () => void act(async () => {
											const submitted = code;
											setCode("");
											const status = await catalogRequest("sources/ark-auth", {
												action: "complete",
												loginToken: auth.loginToken,
												code: submitted
											});
											setArk({
												available: true,
												...status
											});
											setAuth(void 0);
											setMessage("授权完成，请重新选择查询 Profile。");
										}),
										children: "完成连接"
									})
								] })
							] })
						] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							className: "dmm-muted",
							children: [
								"当前凭据：",
								selected?.credential.ref ?? "由来源默认设置决定",
								"（",
								selected?.credential.configured ? "已配置" : "未确认",
								"）。新 Key 独立保存，不覆盖已有 Key。"
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dmm-row",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["新 API Key ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "password",
									autoComplete: "off",
									disabled: locked,
									value: newKey,
									onChange: (e) => setNewKey(e.target.value)
								})] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									disabled: locked || !newKey.trim() || kind === "ark-agent-plan" && !profile,
									onClick: () => void act(async () => {
										const saved = await catalogRequest("sources/credential", {
											sourceKind: kind,
											newKey
										});
										setNewKey("");
										setCredential(saved.credentialRef);
										setMessage("新凭据已保存；读取失败或取消预览时，凭据仍会保留。");
										try {
											await read(saved.credentialRef);
										} catch (e) {
											throw Error(`新凭据已保存；目录未修改。${String(e)}`);
										}
									}),
									children: "先保存凭据，再读取模型"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									disabled: locked || kind === "ark-agent-plan" && !profile,
									onClick: () => void act(() => read()),
									children: "读取现有来源模型"
								})
							]
						}),
						credential && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							className: "dmm-muted",
							children: [
								"新凭据已保存为 ",
								credential,
								"。取消预览保留此引用；模型连接仅在应用后改变。"
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "高级连接设置" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dmm-muted",
								children: "保存到实际来源所有者；下一次请求使用。空白表示保持原值。火山新来源预设套餐地址和兼容协议，不自动切到按量地址。"
							}),
							kind === "ark-agent-plan" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["协议 ", /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
								disabled: locked,
								value: String(connection.api ?? ""),
								onChange: (e) => {
									setConnection((c) => ({
										...c,
										api: e.target.value || void 0
									}));
									setPreview(void 0);
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "",
									children: "保持原值／新来源默认"
								}), (protocols.length ? protocols : [
									"openai-completions",
									"openai-responses",
									"anthropic-messages"
								]).map((api) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: api,
									children: {
										"openai-completions": "OpenAI Chat Completions",
										"openai-responses": "OpenAI Responses",
										"anthropic-messages": "Anthropic Messages"
									}[api] ?? api
								}, api))]
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dmm-row",
								children: (kind === "deepseek" ? ["baseURL"] : [
									"baseURL",
									"displayName",
									"defaultContextWindow",
									"defaultMaxTokens"
								]).map((field) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [{
									baseURL: "调用地址",
									displayName: "来源名称",
									defaultContextWindow: "未知模型上下文默认值",
									defaultMaxTokens: "未知模型输出默认值"
								}[field], /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									disabled: locked,
									type: field.startsWith("default") ? "number" : "text",
									placeholder: String(owner?.fields?.find((f) => f.fieldId === field)?.value ?? ""),
									value: String(connection[field] ?? ""),
									onChange: (e) => {
										setConnection((c) => {
											const next = { ...c };
											if (!e.target.value) delete next[field];
											else next[field] = field.startsWith("default") ? Number(e.target.value) : e.target.value;
											return next;
										});
										setPreview(void 0);
									}
								})] }, field))
							})
						] })
					]
				}),
				reading && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					onClick: () => {
						generation.current++;
						abort.current?.abort();
						setReading(false);
						setMessage(credential ? "读取已停止；新凭据保留，目录未修改。" : "读取已停止，目录未修改。");
					},
					children: "停止读取"
				}),
				message && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					role: "status",
					className: "dmm-note",
					children: message
				}),
				dirty && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "dmm-dirty",
					children: "模型管理有未保存草稿；可以连接和读取，应用前请先保存或明确放弃草稿。"
				}),
				preview && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dmm-card",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("strong", { children: ["来源导入预览 · ", new Date(preview.fetchedAt).toLocaleString()] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "目录资料与推理信息（只读）" }), preview.models.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: item.model.modelId }),
							item.evidence.map((e, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dmm-muted",
								children: e
							}, i)),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", { children: JSON.stringify(item.fields, null, 2) })
						] }, JSON.stringify(item.model)))] }),
						preview.notes.map((n, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dmm-muted",
							children: n
						}, i)),
						preview.connectionChanges.map((c) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: "dmm-row",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									disabled: locked,
									checked: selectedConnections.includes(c.fieldId),
									onChange: (e) => setSelectedConnections((ids) => e.target.checked ? [...ids, c.fieldId] : ids.filter((id) => id !== c.fieldId))
								}),
								c.label,
								"：",
								JSON.stringify(c.before ?? "未设置"),
								" → ",
								JSON.stringify(c.after)
							]
						}, c.fieldId)),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CatalogPreviewPanel, {
							view: preview.catalog,
							selected: preview.catalog.selected,
							busy: locked,
							onResolve: (selected, resolutions) => void act(async () => {
								const catalog = await catalogRequest("catalog-resolve", {
									token: preview.catalog.token,
									selected,
									resolutions
								});
								setPreview((p) => p && {
									...p,
									catalog
								});
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: "dmm-primary",
							disabled: locked || dirty || !preview.catalog.selected.length && !selectedConnections.length,
							onClick: () => void act(async () => {
								onApplied((await catalogRequest("catalog-apply", {
									token: preview.catalog.token,
									selected: preview.catalog.selected,
									selectedConnections
								})).snapshot);
								setPreview(void 0);
								setCredential(void 0);
								await load();
								setMessage("来源配置已应用，并保留可恢复备份。");
							}),
							children: "应用选中配置"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							disabled: locked,
							onClick: () => void act(async () => {
								await catalogRequest("catalog-resolve", {
									token: preview.catalog.token,
									selected: [],
									resolutions: [],
									cancel: true
								});
								generation.current++;
								setPreview(void 0);
								setMessage(credential ? "预览已取消；新凭据已保留，模型目录未修改。" : "预览已取消，模型目录未修改。");
							}),
							children: "取消预览"
						})
					]
				}),
				backupId && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					disabled: locked || dirty,
					onClick: () => void act(async () => {
						onApplied((await catalogRequest("catalog-restore", { backupId })).snapshot);
						setPreview(void 0);
						await load();
						setMessage("已恢复最近来源配置；凭据保留。");
					}),
					children: "恢复最近来源导入"
				})
			] });
		}
		//#endregion
		//#region src/client/alias-health-panel.tsx
		function AliasHealthPanel() {
			const [state, setState] = (0, react.useState)(), [error, setError] = (0, react.useState)(""), [busy, setBusy] = (0, react.useState)(false);
			const load = async () => {
				const r = await fetch(hostRouteUrl("/api/model-manager/alias-health"));
				const value = await r.json();
				if (!r.ok) throw Error(value.error);
				setState(value);
			};
			(0, react.useEffect)(() => {
				load().catch((e) => setError(String(e)));
			}, []);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dmm-card",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "候选恢复状态" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dmm-muted",
						children: "冷却到期后由下一轮真实请求尝试首选；不发送后台探测。本轮工具循环继续使用已成功的候选。"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						disabled: busy,
						onClick: () => void load().catch((e) => setError(String(e))),
						children: "刷新状态"
					}),
					state?.warning && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dmm-note",
						children: state.warning
					}),
					state?.entries?.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dmm-row",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
							"@",
							entry.alias,
							" · ",
							entry.model.providerId,
							"/",
							entry.model.modelId,
							" · ",
							{
								transient: "临时故障",
								"rate-limit": "限流",
								quota: "额度不足",
								auth: "凭据无效"
							}[entry.kind],
							" · ",
							entry.recovering ? "正在恢复" : entry.retryAt ? `下次可尝试：${new Date(entry.retryAt).toLocaleString()}` : "更换凭据或手动恢复后再试"
						] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							disabled: busy,
							onClick: () => {
								setBusy(true);
								setError("");
								fetch(hostRouteUrl("/api/model-manager/alias-health"), {
									method: "POST",
									headers: { "Content-Type": "application/json" },
									body: JSON.stringify({
										alias: entry.alias,
										expectedRevisionToken: state.revisionToken
									})
								}).then(async (r) => {
									const v = await r.json();
									if (!r.ok) throw Error(v.error);
									setState(v);
								}).catch((e) => setError(String(e))).finally(() => setBusy(false));
							},
							children: "立即重新尝试首选"
						})]
					}, `${entry.alias}:${entry.model.providerId}:${entry.model.modelId}`)),
					state && !state.entries?.length && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dmm-muted",
						children: "当前没有冷却中的候选。"
					}),
					error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "alert",
						className: "dmm-error",
						children: error
					})
				]
			});
		}
		//#endregion
		//#region src/client/index.tsx
		const inject = ["slots"];
		const tabs = [
			"模型来源",
			"模型",
			"别名与兜底",
			"AUTO 自动选模型",
			"视觉",
			"日志"
		];
		const probeLabels = { hostImage: "宿主原生图片声明" };
		const supportLabels = {
			yes: "支持",
			no: "不支持",
			unknown: "未知"
		};
		/** 归一化所有快照响应：models/verifications 缺失兜底为空数组，避免渲染时 TypeError 白屏；config 缺失说明服务端异常，抛错走失败路径。 */
		function asSnapshot(value) {
			if (!value?.config) throw new Error("模型管理响应不完整，请重试或重启 DSH");
			return {
				...value,
				models: Array.isArray(value?.models) ? value.models : [],
				verifications: Array.isArray(value?.verifications) ? value.verifications : []
			};
		}
		const style = `
.dmm-root [hidden]{display:none!important}.dmm-root{font-family:system-ui,'Segoe UI',sans-serif;font-size:14px;line-height:1.55;padding:20px;max-width:1100px;color:var(--dsw-alias-label-primary,#222)}
.dmm-root h2{margin:0 0 6px;font-size:20px}.dmm-muted{color:var(--dsw-alias-label-secondary,#666);font-size:12px}
.dmm-tabs{display:flex;flex-wrap:wrap;gap:7px;margin:18px 0}.dmm-tabs button,.dmm-root button,.dmm-composer{font:inherit}
.dmm-tabs button,.dmm-root button{border:1px solid var(--dsw-alias-border-l2,#ccc);border-radius:7px;background:var(--dsw-alias-bg-layer-2,#fff);color:inherit;padding:6px 10px;cursor:pointer}
.dmm-tabs button[aria-selected=true],.dmm-root button.dmm-primary{background:var(--dsw-alias-brand-primary,#356dde);color:var(--dsw-alias-label-primary-foreground,#fff);border-color:transparent}
.dmm-root button:disabled{cursor:not-allowed;opacity:.5}
.dmm-card{border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:10px;padding:14px;margin:10px 0;background:var(--dsw-alias-bg-layer-2,#fff)}
.dmm-group{border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:10px;margin:10px 0;background:var(--dsw-alias-bg-layer-2,#fff)}
.dmm-group-head{display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:10px 14px;cursor:pointer;user-select:none}
.dmm-group-body{border-top:1px solid var(--dsw-alias-border-l2,#eee);padding:4px 14px 10px}
.dmm-badge{font-size:12px;border-radius:6px;padding:2px 7px;background:var(--dsw-alias-bg-layer-1,#f0f2f5)}
.dmm-badge-warn{color:#b42318;background:rgba(180,35,24,.08)}
.dmm-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}.dmm-row{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:8px 0}
.dmm-root input:not([type=checkbox]),.dmm-root select,.dmm-root textarea{font:inherit;background:var(--dsw-alias-bg-layer-1,#fff);color:inherit;border:1px solid var(--dsw-alias-border-l2,#bbb);border-radius:6px;padding:6px;min-width:110px}
.dmm-root input[type=checkbox]{width:16px;height:16px;margin:0 6px 0 0;vertical-align:middle;accent-color:var(--dsw-alias-brand-primary,#356dde)}
.dmm-switch-row{display:flex;align-items:center;justify-content:space-between;gap:14px}.dmm-switch-row strong{display:block}.dmm-switch-row input{flex:none}.dmm-log-row{border-bottom:1px solid var(--dsw-alias-border-l2,#ddd);padding:8px 0}.dmm-log-row:last-child{border-bottom:0}
.dmm-root textarea{width:100%;min-height:100px}.dmm-root label{font-size:13px}.dmm-error{color:#b42318}.dmm-composer{border:0;background:transparent;color:inherit;cursor:pointer;font-size:12px}
.dmm-dirty{color:#b54708;font-size:12px}
.dmm-empty{border-style:dashed;text-align:center}
.dmm-modal-mask{position:fixed;inset:0;z-index:9998;background:rgba(15,23,42,.4);display:flex;align-items:center;justify-content:center;padding:20px}
.dmm-modal{background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,#222);border:1px solid var(--dsw-alias-border-l2,#ccc);border-radius:12px;padding:16px;width:min(620px,94vw);max-height:82vh;overflow:auto;box-shadow:0 16px 48px rgba(0,0,0,.28)}
.dmm-modal h3{margin:0 0 6px;font-size:16px}
.dmm-note{color:#b54708;font-size:12px;margin:6px 0}
.dmm-actions{position:sticky;bottom:0;z-index:6;display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-top:16px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:10px;background:var(--dsw-alias-bg-layer-2,#fff);box-shadow:0 -6px 16px rgba(0,0,0,.07)}
.dmm-toasts{position:fixed;right:18px;bottom:18px;z-index:9999;display:flex;flex-direction:column;gap:8px;max-width:min(380px,90vw)}
.dmm-toast{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-radius:9px;font-size:13px;line-height:1.45;background:var(--dsw-alias-bg-layer-2,#fff);border:1px solid var(--dsw-alias-border-l2,#ccc);box-shadow:0 8px 24px rgba(0,0,0,.18);color:var(--dsw-alias-label-primary,#222)}
.dmm-toast-success{border-color:#2f855a}.dmm-toast-error{border-color:#b42318}.dmm-toast-info{border-color:var(--dsw-alias-brand-primary,#356dde)}
.dmm-root .dmm-toast button{border:0;background:transparent;color:inherit;cursor:pointer;font-size:15px;line-height:1;padding:0 2px}
.dmm-steps{margin:6px 0;padding-left:20px;list-style:disc}.dmm-steps li{margin:5px 0;font-size:13px;line-height:1.65}
.dmm-hint{border-left:3px solid var(--dsw-alias-brand-primary,#356dde);background:var(--dsw-alias-bg-layer-1,#f6f7f9);border-radius:0 8px 8px 0;padding:8px 12px;margin:8px 0;font-size:12px;color:var(--dsw-alias-label-secondary,#555);line-height:1.7}
.dmm-composer summary{cursor:pointer;user-select:none}
.dmm-popcard{padding:10px 12px;box-shadow:0 10px 28px rgba(0,0,0,.14)}
.dmm-guide{background:var(--dsw-alias-bg-layer-1,#f7f8fa);border:1px solid var(--dsw-alias-border-l2,#e3e6eb);border-radius:10px;padding:12px 14px;margin:10px 0}
.dmm-guide>strong{display:block;font-size:14px;margin-bottom:6px}
.dmm-guide p{margin:6px 0;font-size:13px;line-height:1.7}
.dmm-guide .dmm-steps{margin:6px 0 2px}
.dmm-guide summary{cursor:pointer;user-select:none;font-weight:600;font-size:14px;list-style:revert}
.dmm-guide[open]>summary{margin-bottom:6px}
.dmm-root pre{white-space:pre-wrap;word-break:break-all;max-height:420px;overflow:auto}
`;
		function injectStyle() {
			if (document.querySelector("style[data-dsh-model-manager]")) return;
			const node = document.createElement("style");
			node.dataset.dshModelManager = "";
			node.textContent = style;
			document.head.appendChild(node);
		}
		async function request(path, init) {
			const response = await fetch(hostRouteUrl(`/api/model-manager${path}`), {
				headers: { "Content-Type": "application/json" },
				...init
			});
			const value = await response.json();
			if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`);
			return value;
		}
		function refValue(ref) {
			return typeof ref === "string" ? ref : ref ? JSON.stringify([ref.providerId, ref.modelId]) : "";
		}
		function parseRef(value) {
			if (!value) return void 0;
			if (value.startsWith("@")) return value;
			const [providerId, modelId] = JSON.parse(value);
			return {
				providerId,
				modelId
			};
		}
		/** 配置是否与已保存版本一致：两侧都来自同一份 JSON，因此直接比较序列化结果即可。 */
		function sameConfig(a, b) {
			return JSON.stringify(a) === JSON.stringify(b);
		}
		function EffortSelect({ target, value, models, aliases, onChange, disabled, label = "推理档位" }) {
			const selected = (typeof target === "string" ? aliases[target.slice(1)]?.candidates ?? [] : target ? [target] : []).map((ref) => models.find((model) => model.providerId === ref.providerId && model.modelId === ref.modelId)).filter((model) => !!model);
			const efforts = selected.length ? selected[0].reasoningEfforts.filter((e) => selected.every((model) => model.reasoningEfforts.some((item) => item.id === e.id))) : [];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
				"aria-label": label,
				disabled,
				value: value ?? "",
				onChange: (event) => onChange(event.target.value || void 0),
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
					value: "",
					children: "使用模型默认"
				}), efforts.map((e) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
					value: e.id,
					children: [
						e.id === "off" ? "关闭思考" : e.name,
						"（",
						e.id,
						"）"
					]
				}, e.id))]
			});
		}
		function SelectModel({ value, models, aliases, disabled, onChange }) {
			const missing = value && (typeof value === "string" ? !aliases.includes(value.slice(1)) : !models.some((model) => model.providerId === value.providerId && model.modelId === value.modelId));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
				disabled,
				value: refValue(value),
				onChange: (event) => onChange(parseRef(event.target.value)),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
						value: "",
						children: "未设置"
					}),
					missing && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
						value: refValue(value),
						children: [typeof value === "string" ? value : `${value.providerId}/${value.modelId}`, "（失效：别名未绑定或模型不在当前可选目录）"]
					}),
					aliases.map((alias) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
						value: `@${alias}`,
						children: ["@", alias]
					}, alias)),
					models.map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
						value: JSON.stringify([model.providerId, model.modelId]),
						children: [
							model.name,
							" · ",
							model.providerId
						]
					}, `${model.providerId}:${model.modelId}`))
				]
			});
		}
		function FilterBar({ text, onText, provider, onProvider, providers, matched, total, onReset, children }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dmm-row",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
						"aria-label": "筛选 Provider",
						value: provider,
						onChange: (event) => onProvider(event.target.value),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
							value: "",
							children: [
								"全部 Provider（",
								providers.length,
								"）"
							]
						}), providers.map((id) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
							value: id,
							children: id
						}, id))]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						"aria-label": "筛选模型",
						placeholder: "筛选模型名或 ID",
						value: text,
						onChange: (event) => onText(event.target.value)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dmm-muted",
						children: [
							"匹配 ",
							matched,
							" / 共 ",
							total,
							" 个模型"
						]
					}),
					text || provider ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						onClick: onReset,
						children: "清除筛选"
					}) : null,
					children
				]
			});
		}
		function NativeEditor({ model, revision, refresh, notify }) {
			const [image, setImage] = (0, react.useState)(model.nativeImage);
			const [context, setContext] = (0, react.useState)(model.contextWindow?.toString() ?? "");
			const [output, setOutput] = (0, react.useState)(model.defaultMaxTokens?.toString() ?? "");
			const [busy, setBusy] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				setImage(model.nativeImage);
				setContext(model.contextWindow?.toString() ?? "");
				setOutput(model.defaultMaxTokens?.toString() ?? "");
			}, [
				model.nativeImage,
				model.contextWindow,
				model.defaultMaxTokens
			]);
			const save = async () => {
				if (revision === void 0) return;
				setBusy(true);
				try {
					const fields = {
						providerId: model.providerId,
						modelId: model.modelId,
						revision
					};
					if (image !== "unknown") fields.image = image === "yes";
					if (context) fields.contextWindow = Number(context);
					if (output) fields.maxTokens = Number(output);
					await request("/native", {
						method: "POST",
						body: JSON.stringify(fields)
					});
					await refresh();
					notify("success", `已把宿主声明写入 llm-pi-ai：${model.name}。下一次请求按新声明处理。`);
				} catch (error) {
					notify("error", String(error));
				} finally {
					setBusy(false);
				}
			};
			const clear = async (field) => {
				if (revision === void 0) return;
				setBusy(true);
				try {
					await request("/native", {
						method: "POST",
						body: JSON.stringify({
							providerId: model.providerId,
							modelId: model.modelId,
							revision,
							clear: [field]
						})
					});
					await refresh();
					notify("success", `已清除 ${model.name} 的该项宿主覆盖，后续请求使用宿主默认声明。`);
				} catch (error) {
					notify("error", String(error));
				} finally {
					setBusy(false);
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dmm-row",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["宿主原生图片 ", /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
						disabled: !model.nativeEditable,
						value: image,
						onChange: (event) => setImage(event.target.value),
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "unknown",
								children: "未知"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "yes",
								children: "支持"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "no",
								children: "不支持"
							})
						]
					})] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["上下文容量 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						disabled: !model.nativeEditable,
						type: "number",
						min: "1",
						value: context,
						onChange: (event) => setContext(event.target.value)
					})] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["模型最大输出 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						disabled: !model.nativeEditable,
						type: "number",
						min: "1",
						value: output,
						onChange: (event) => setOutput(event.target.value)
					})] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						disabled: busy || revision === void 0 || !model.nativeEditable,
						onClick: () => void save(),
						children: "保存到宿主"
					}),
					model.nativeClearable && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							disabled: busy || revision === void 0,
							onClick: () => void clear("image"),
							children: "清除图片覆盖"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							disabled: busy || revision === void 0,
							onClick: () => void clear("contextWindow"),
							children: "清除容量覆盖"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							disabled: busy || revision === void 0,
							onClick: () => void clear("maxTokens"),
							children: "清除输出覆盖"
						})
					] }),
					!model.nativeEditable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dmm-muted",
						children: model.nativeEditReason
					})
				]
			});
		}
		/** 各视觉策略的一句话取舍说明，随下拉框选中项动态展示。 */
		const policyHelp = {
			"native-first": "当前模型支持看图：图片直接发给它本人，不绕道、不产生额外调用；不支持：自动改用看图工具请视觉模型代看；两边都没有：带图片的请求会报错。日常推荐，能力强就少绕路，不够也有兜底。",
			"sidecar-first": "只要下方配置了视觉模型，哪怕当前模型自己能看图，也一律由视觉模型代看、只把文字结论交给对话模型；未配置视觉模型时退回直接看图。适合想让看图统一走固定便宜模型的场景。",
			"native-only": "只允许当前模型直接看图，绝不调用视觉模型。当前模型不支持图片时，带图片的请求直接报错。",
			"sidecar-only": "所有图片一律经看图工具由视觉模型代看；必须配置视觉模型，否则带图片的请求直接报错。"
		};
		function VisionSection({ draft, models, aliases, edit }) {
			const clearVision = () => {
				if (draft.auto.roles.vision.target && !window.confirm("仍有旧视觉兜底。清空视觉模型会同时清除当前目标和旧兜底及其推理档位；视觉开关和其他设置保留。确认清除？")) return;
				edit((next) => {
					delete next.vision.target;
					delete next.auto.roles.vision.target;
					delete next.auto.roles.vision.reasoningEffort;
					delete next.auto.roles.vision.tier;
					delete next.auto.roles.vision.thinking;
				});
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
					className: "dmm-guide",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "视觉辅助是做什么的？（点开查看说明）" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dmm-muted",
							style: { margin: "6px 0" },
							children: "你把图片粘贴或拖入输入框发送后，图片需要随消息交给当前对话模型。DSH 默认不加工图片：模型声明「支持图片」就发原图；声明「不支持」则图片到不了模型——它只能看到一行占位文字，或直接收到报错。"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: {
								margin: "6px 0",
								fontSize: 13
							},
							children: "开启「视觉辅助」后，插件在每次请求发出前接管图片路由："
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("ul", {
							className: "dmm-steps",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "当前模型自己支持看图" }), "：图片原样随消息发给它，效果最直接，也不产生额外调用。"] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "当前模型不支持看图" }), "：自动模式先请视觉模型理解图片，再把带来源的观察交给当前模型；仍可用看图工具继续追问或裁剪。"] })]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dmm-muted",
							children: "附件上传与发送流程保持不变；新图和工具图片都会处理；历史追问按当前问题读取，会话内复用相同问题的观察。关闭开关立即恢复 DSH 默认行为。"
						})
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dmm-card",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dmm-switch-row",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "视觉辅助" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dmm-muted",
								children: "当前模型看不了图时，交给辅助模型理解图片。"
							})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								"aria-label": "启用视觉辅助",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: draft.vision.enabled,
									onChange: (event) => edit((next) => {
										next.vision.enabled = event.target.checked;
									})
								}), draft.vision.enabled ? "已开启" : "已关闭"]
							})]
						}),
						draft.vision.enabled && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "dmm-row",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: draft.vision.automatic !== false,
									onChange: (e) => edit((next) => {
										next.vision.automatic = e.target.checked;
									})
								}), "自动理解图片（默认开启）"]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dmm-muted",
								children: "自动模式在每步请求前准备必要观察，包括工具返回的图片，并在会话中记录视觉来源；关闭后仍可用看图工具追问或裁剪。"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dmm-row",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["策略 ", /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
									value: draft.vision.policy,
									onChange: (event) => edit((next) => {
										next.vision.policy = event.target.value;
									}),
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "native-first",
											children: "原生优先（推荐）"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "sidecar-first",
											children: "看图工具优先"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "native-only",
											children: "仅原生直读"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "sidecar-only",
											children: "仅看图工具"
										})
									]
								})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dmm-muted",
									children: "决定「当前模型直接看图」与「交给视觉模型代看」如何取舍。"
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dmm-hint",
								children: policyHelp[draft.vision.policy]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
								className: "dmm-guide",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "何时使用辅助模型？" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "当前模型不能直接看图时，辅助模型先理解图片，再把文字结果交给当前模型。未选择辅助模型且当前模型不支持图片时，请求会报错。" })]
							})
						] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dmm-row",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["视觉模型 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SelectModel, {
								value: draft.vision.target,
								models: models.filter((m) => m.nativeImage === "yes"),
								aliases,
								onChange: (value) => {
									if (!value) clearVision();
									else edit((next) => {
										next.vision.target = value;
									});
								}
							})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								disabled: !draft.vision.target && !draft.auto.roles.vision.target,
								onClick: clearVision,
								children: draft.auto.roles.vision.target ? "清空视觉目标及旧兜底" : "清除当前视觉目标"
							})]
						}),
						draft.auto.roles.vision.target && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dmm-row",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["旧视觉兜底 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SelectModel, {
									value: draft.auto.roles.vision.target,
									models: models.filter((m) => m.nativeImage === "yes"),
									aliases,
									onChange: (value) => edit((next) => {
										delete next.auto.roles.vision.reasoningEffort;
										delete next.auto.roles.vision.tier;
										delete next.auto.roles.vision.thinking;
										if (value) next.auto.roles.vision.target = value;
										else delete next.auto.roles.vision.target;
									})
								})] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									onClick: () => edit((next) => {
										delete next.auto.roles.vision.target;
										delete next.auto.roles.vision.reasoningEffort;
										delete next.auto.roles.vision.tier;
										delete next.auto.roles.vision.thinking;
									}),
									children: "清除旧视觉兜底"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dmm-muted",
									children: "未设置当前目标时仍可能使用此旧兜底。要清空视觉模型，请同时明确清除此项；清除无关旧兜底不会关闭当前辅助。"
								})
							]
						})
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dmm-guide",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "看图工具的工作方式" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("ul", {
						className: "dmm-steps",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: "自动模式先生成带附件编号和视觉模型来源的观察，随后交给对话模型。关闭自动模式时，对话模型可按附件编号调用 model_manager_inspect_image；理解失败会明确反馈。" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: "模型看图时可以附带裁剪区域（x,y,width,height，取值 0–1），插件只把这一块裁剪图发给视觉模型，方便放大看局部细节；不带区域就看整张原图。" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: "相同图片、相同问题、相同区域的看图结果会被缓存，重复追问不重复消耗视觉模型用量。" })
						]
					})]
				})
			] });
		}
		function TierMapping({ name, models, draft, edit }) {
			if (!models.length) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "候选模型推理档位" }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "dmm-muted",
					children: "每个候选只显示它自己支持的档位；留空使用模型默认。"
				}),
				models.map((model) => {
					const key = JSON.stringify([model.providerId, model.modelId]);
					return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dmm-row",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
							model.name,
							" · ",
							model.providerId
						] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
							value: draft.aliases[name].efforts?.[key] ?? "",
							onChange: (event) => edit((next) => {
								next.aliases[name].efforts ??= {};
								if (event.target.value) next.aliases[name].efforts[key] = event.target.value;
								else delete next.aliases[name].efforts[key];
							}),
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "",
								children: "使用模型默认"
							}), model.reasoningEfforts.map((e) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
								value: e.id,
								children: [
									e.id === "off" ? "关闭思考" : e.name,
									"（",
									e.id,
									"）"
								]
							}, e.id))]
						})]
					}, key);
				})
			] });
		}
		/** 别名卡：固定恢复规则与候选模型的档位映射。 */
		function AliasCard({ name, draft, models, edit, notify, removeAlias }) {
			const alias = draft.aliases[name];
			if (!alias) return null;
			const candidates = alias.candidates ?? [];
			const isLongContext = name === "long-context";
			const referenced = [...new Map(candidates.map((ref) => [JSON.stringify([ref.providerId, ref.modelId]), models.find((model) => model.providerId === ref.providerId && model.modelId === ref.modelId)]).values()).values()].filter((item) => !!item);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dmm-card",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dmm-row",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("strong", { children: ["@", name] }),
							isLongContext && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dmm-badge",
								children: "内置：上下文溢出兜底"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								onClick: () => removeAlias(name),
								children: "删除"
							})
						]
					}),
					isLongContext && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dmm-muted",
						children: "具体模型请求上下文溢出时可使用这里的候选。其他别名只尝试自己配置的候选，不自动追加本组；也可直接选择本别名。"
					}),
					candidates.map((ref, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dmm-row",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [index + 1, "."] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SelectModel, {
								value: ref,
								models,
								aliases: [],
								onChange: (value) => edit((next) => {
									if (value && typeof value !== "string") next.aliases[name].candidates[index] = value;
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								disabled: !index,
								onClick: () => edit((next) => {
									const list = next.aliases[name].candidates;
									[list[index - 1], list[index]] = [list[index], list[index - 1]];
								}),
								children: "上移"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								disabled: index === candidates.length - 1,
								onClick: () => edit((next) => {
									const list = next.aliases[name].candidates;
									[list[index + 1], list[index]] = [list[index], list[index + 1]];
								}),
								children: "下移"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								onClick: () => edit((next) => {
									next.aliases[name].candidates.splice(index, 1);
								}),
								children: "移除"
							})
						]
					}, index)),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						onClick: () => edit((next) => {
							if (models[0]) next.aliases[name].candidates.push({
								providerId: models[0].providerId,
								modelId: models[0].modelId
							});
						}),
						children: "添加候选"
					}),
					!candidates.length && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dmm-note",
						children: "每个别名至少要有一个具体模型才能保存。"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dmm-muted",
						children: "按顺序尝试全部候选。网络、超时或服务端临时故障每个候选最多调用 5 次；其他错误直接换下一个。成功后显示完整回答，失败的半段内容丢弃；停止后不再重试。"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TierMapping, {
						name,
						models: referenced,
						draft,
						edit
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dmm-row",
						children: [
							{
								key: "transientCooldownSeconds",
								label: "临时故障冷却",
								value: 60
							},
							{
								key: "rateLimitCooldownSeconds",
								label: "限流冷却",
								value: 300
							},
							{
								key: "quotaCooldownSeconds",
								label: "额度不足冷却",
								value: 3600
							}
						].map((field) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [
							field.label,
							"（秒，1–604800）",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "number",
								min: "1",
								max: "604800",
								placeholder: `默认 ${field.value}`,
								value: alias.recovery?.[field.key] ?? "",
								onChange: (e) => edit((next) => {
									next.aliases[name].recovery ??= {};
									if (e.target.value) next.aliases[name].recovery[field.key] = Number(e.target.value);
									else delete next.aliases[name].recovery[field.key];
								})
							})
						] }, field.key))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dmm-muted",
						children: "限流和额度不足优先采用服务端等待时间；凭据无效需更换凭据或手动恢复。能力和参数不匹配只跳过本次。"
					}),
					!referenced.some((model) => model.reasoningEfforts.length) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dmm-muted",
						children: "候选模型都没有公开推理档位，无需映射。"
					})
				]
			});
		}
		function ManagerSection({ ctx }) {
			const [catalogEditor, setCatalogEditor] = (0, react.useState)(null);
			const [snapshot, setSnapshot] = (0, react.useState)(null);
			const [draft, setDraft] = (0, react.useState)(null);
			const [tab, setTab] = (0, react.useState)("模型来源");
			const draftRevision = (0, react.useRef)(0);
			const [fatal, setFatal] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(false);
			const [refreshing, setRefreshing] = (0, react.useState)(false);
			const [probing, setProbing] = (0, react.useState)("");
			const [preview, setPreview] = (0, react.useState)(null);
			const [officialError, setOfficialError] = (0, react.useState)("");
			const [official, setOfficial] = (0, react.useState)(null);
			const [officialChecked, setOfficialChecked] = (0, react.useState)([]);
			const [officialProgress, setOfficialProgress] = (0, react.useState)(null);
			const [officialSource, setOfficialSource] = (0, react.useState)(DEFAULT_OFFICIAL_URL);
			const [officialAnalyzer, setOfficialAnalyzer] = (0, react.useState)();
			const [officialEffort, setOfficialEffort] = (0, react.useState)();
			const [officialTimeout, setOfficialTimeout] = (0, react.useState)(String(180));
			const officialFormInitialized = (0, react.useRef)(false);
			const officialAbort = (0, react.useRef)(null);
			const [notices, setNotices] = (0, react.useState)([]);
			const [aliasName, setAliasName] = (0, react.useState)("");
			const [removingAlias, setRemovingAlias] = (0, react.useState)(null);
			const [logs, setLogs] = (0, react.useState)([]);
			const [modelFilter, setModelFilter] = (0, react.useState)("");
			const [providerFilter, setProviderFilter] = (0, react.useState)("");
			const [expanded, setExpanded] = (0, react.useState)(/* @__PURE__ */ new Set());
			const [verifyTarget, setVerifyTarget] = (0, react.useState)();
			const [verifyKind, setVerifyKind] = (0, react.useState)("text");
			const [verifyResult, setVerifyResult] = (0, react.useState)(null);
			(0, react.useRef)(null);
			const noticeSeq = (0, react.useRef)(0);
			const timers = (0, react.useRef)([]);
			(0, react.useEffect)(() => () => {
				timers.current.forEach((id) => window.clearTimeout(id));
				officialAbort.current?.abort();
			}, []);
			const effectiveAnalyzer = officialAnalyzer ?? snapshot?.hostDefault;
			(0, react.useEffect)(() => {
				setOfficial(null);
				setOfficialChecked([]);
				setOfficialError("");
			}, [
				officialSource,
				effectiveAnalyzer?.providerId,
				effectiveAnalyzer?.modelId,
				officialEffort,
				officialTimeout
			]);
			(0, react.useEffect)(() => {
				setOfficialEffort(void 0);
			}, [effectiveAnalyzer?.providerId, effectiveAnalyzer?.modelId]);
			const dismiss = (0, react.useCallback)((id) => setNotices((list) => list.filter((item) => item.id !== id)), []);
			const notify = (0, react.useCallback)((kind, text) => {
				const id = ++noticeSeq.current;
				setNotices((list) => [...list, {
					id,
					kind,
					text
				}]);
				const ttl = kind === "error" ? 12e3 : 4500;
				timers.current.push(window.setTimeout(() => setNotices((list) => list.filter((item) => item.id !== id)), ttl));
			}, []);
			const load = async () => {
				const next = asSnapshot(await request(""));
				if (next.config.version !== 4) throw new Error(`检测到旧版插件服务（配置格式 v${next.config.version}）：请重启 DSH 让新版 host 生效后刷新本页`);
				if (!officialFormInitialized.current) {
					setOfficialSource(next.config.official?.sourceUrl ?? "https://api-docs.deepseek.com/zh-cn/");
					setOfficialAnalyzer(next.config.official?.analyzer);
					officialFormInitialized.current = true;
				}
				draftRevision.current = next.revision;
				setSnapshot(next);
				setDraft(structuredClone(next.config));
				setFatal("");
				setOfficial(null);
				setOfficialChecked([]);
				setExpanded(/* @__PURE__ */ new Set());
			};
			(0, react.useEffect)(() => {
				load().catch((error) => setFatal(String(error)));
			}, []);
			/** 只刷新宿主目录与证据，不覆盖用户正在编辑的草稿。 */
			const refreshDirectory = async (silent = false) => {
				if (!snapshot) return null;
				const before = new Set(snapshot.models.map((model) => `${model.providerId}:${model.modelId}`));
				const next = asSnapshot(await request("/refresh", { method: "POST" }));
				const after = new Set(next.models.map((model) => `${model.providerId}:${model.modelId}`));
				const added = [...after].filter((key) => !before.has(key)).length;
				const removed = [...before].filter((key) => !after.has(key)).length;
				setSnapshot(next);
				if (!silent) notify("success", `目录已刷新：宿主加载 ${next.models.length} 个模型${added || removed ? `（新增 ${added}、移除 ${removed}）` : "（与上次相比没有变化）"}。`);
				return next;
			};
			const edit = (fn) => setDraft((current) => {
				if (!current || busy) return current;
				const next = structuredClone(current);
				fn(next);
				return next;
			});
			const save = async () => {
				if (!snapshot || !draft) return;
				setBusy(true);
				try {
					const next = asSnapshot(await request("", {
						method: "PUT",
						body: JSON.stringify({
							revision: draftRevision.current,
							config: draft
						})
					}));
					draftRevision.current = next.revision;
					setSnapshot(next);
					setDraft(structuredClone(next.config));
					window.dispatchEvent(new Event("dmm:config"));
					setOfficial(null);
					setOfficialChecked([]);
					notify("success", "已保存插件配置（所有标签页），后续请求使用新配置。");
				} catch (error) {
					const text = String(error);
					notify("error", /CONFLICT|冲突/i.test(text) ? `${text}：配置已被别处修改，请点「重新加载」取回最新版本再改。` : text);
				} finally {
					setBusy(false);
				}
			};
			const reload = async () => {
				if (dirty && !window.confirm("「重新加载」会放弃所有未保存的修改，改为读取已保存的配置。确定继续？")) return;
				try {
					await load();
					notify("info", "已重新加载当前已保存的配置。");
				} catch (error) {
					notify("error", String(error));
				}
			};
			/** 验证一个模型（文字/图片/工具/推理档位）；图片验证通过时直接给出可一键写入的声明建议。 */
			const verifyOne = async (ref, kind) => {
				const result = await request("/verify", {
					method: "POST",
					body: JSON.stringify({
						...ref,
						kind
					})
				});
				setVerifyResult(result.verification);
				const fresh = asSnapshot(await request(""));
				setSnapshot(fresh);
				const suggestions = kind === "image" ? imageSuggestions([result.verification]) : [];
				if (suggestions.length) {
					const model = fresh.models.find((item) => item.providerId === ref.providerId && item.modelId === ref.modelId);
					setPreview({
						title: `验证建议：${model?.name ?? ref.modelId}`,
						model,
						suggestions,
						checked: suggestions.map((item) => item.confidence === "high"),
						verifications: [result.verification]
					});
				} else notify("success", `验证完成：${kind} ${result.verification.status}${result.verification.behavior ? ` / ${result.verification.behavior}` : ""}。`);
			};
			const imageSuggestions = probeSuggestions;
			const refreshOfficial = async () => {
				setCatalogEditor(null);
				setOfficialError("");
				officialAbort.current?.abort();
				const controller = new AbortController();
				officialAbort.current = controller;
				setOfficial(null);
				setOfficialChecked([]);
				setOfficialProgress({
					stage: "reading",
					round: 1,
					pageCount: 0
				});
				setBusy(true);
				try {
					const analysisTimeoutSeconds = officialAnalysisTimeout(Number(officialTimeout));
					const result = await readOfficialStream(await fetch(hostRouteUrl("/api/model-manager/official-preview"), {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Accept: "text/event-stream"
						},
						body: JSON.stringify({
							sourceUrl: officialSource,
							analyzer: officialAnalyzer ?? null,
							...officialEffort ? { reasoningEffort: officialEffort } : {},
							analysisTimeoutSeconds
						}),
						signal: controller.signal
					}), (value) => {
						if (officialAbort.current === controller && !controller.signal.aborted) setOfficialProgress(value);
					});
					if (controller.signal.aborted || officialAbort.current !== controller) return;
					setOfficial(result);
					setOfficialChecked(result.diffs.filter((item) => item.field !== "removeModel" && !item.blockedReasons.length).map((item) => item.id));
					notify("info", `识别出 ${result.analysis.models.length} 个当前 API 模型、${result.diffs.length} 项差异，请核对原文证据。`);
				} catch (error) {
					if (officialAbort.current === controller) {
						const reason = controller.signal.aborted ? "分析已取消，配置未修改。" : String(error);
						setOfficialError(reason);
						notify(controller.signal.aborted ? "info" : "error", reason);
					}
				} finally {
					if (officialAbort.current === controller) {
						officialAbort.current = null;
						setOfficialProgress(null);
						setBusy(false);
					}
				}
			};
			const applyOfficial = async () => {
				if (!official || dirty) return;
				setBusy(true);
				try {
					await request("/official-apply", {
						method: "POST",
						body: JSON.stringify({
							token: official.token,
							selected: officialChecked
						})
					});
					setOfficial(null);
					await refreshDirectory(true);
					await load();
					notify("success", "已应用选中的官方资料，可使用“恢复上次同步”撤回。");
				} catch (error) {
					notify("error", String(error));
				} finally {
					setBusy(false);
				}
			};
			const resolveOfficial = async (selected, resolutions) => {
				if (!official || busy) return;
				setBusy(true);
				try {
					const next = await catalogRequest("catalog-resolve", {
						token: official.token,
						selected,
						resolutions
					});
					setOfficial(next);
					setOfficialChecked(next.catalog?.selected ?? selected);
				} catch (error) {
					notify("error", String(error));
				} finally {
					setBusy(false);
				}
			};
			const probeOne = async (model) => {
				const key = `${model.providerId}:${model.modelId}`;
				setProbing(key);
				try {
					const result = await request("/probe", {
						method: "POST",
						body: JSON.stringify({
							providerId: model.providerId,
							modelId: model.modelId,
							items: ["image", "tools"]
						})
					});
					const fresh = (await refreshDirectory(true))?.models.find((item) => item.providerId === model.providerId && item.modelId === model.modelId) ?? model;
					const shared = {
						model: fresh,
						elevated: result.elevated,
						restoreFailed: result.restoreFailed,
						notes: result.notes
					};
					if (!result.suggestions.length) {
						setPreview({
							title: `探测结果：${fresh.name}`,
							...shared,
							suggestions: [],
							checked: [],
							verifications: result.verifications
						});
						return;
					}
					setPreview({
						title: `探测建议：${fresh.name}`,
						...shared,
						suggestions: result.suggestions,
						checked: result.suggestions.map((item) => item.confidence === "high")
					});
				} catch (error) {
					setPreview({
						title: `探测失败：${model.name}`,
						model,
						suggestions: [],
						checked: [],
						failure: String(error)
					});
				} finally {
					setProbing("");
				}
			};
			const applyProbe = async () => {
				if (!preview || !snapshot || !preview.model) return;
				const chosen = preview.suggestions.filter((_, index) => preview.checked[index]);
				if (!chosen.length) {
					notify("info", "没有勾选任何结论。");
					return;
				}
				setBusy(true);
				let hostApplied = 0, skipped = 0;
				try {
					if (chosen.some((item) => item.field === "hostImage")) {
						if (preview.model.nativeEditable && snapshot.nativeRevision !== void 0) {
							await request("/native", {
								method: "POST",
								body: JSON.stringify({
									providerId: preview.model.providerId,
									modelId: preview.model.modelId,
									revision: snapshot.nativeRevision,
									image: true
								})
							});
							await refreshDirectory(true);
							hostApplied++;
						} else skipped++;
					}
					setPreview({
						...preview,
						title: "已应用结论",
						suggestions: [],
						checked: [],
						applied: {
							hostApplied,
							skipped
						}
					});
				} catch (error) {
					setPreview((current) => current && {
						...current,
						failure: String(error)
					});
				} finally {
					setBusy(false);
				}
			};
			if (!draft || !snapshot) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dmm-root",
				children: fatal || "正在加载模型管理…"
			});
			const dirty = !sameConfig(draft, snapshot.config);
			const aliases = Object.keys(draft.aliases);
			const providers = [...new Set(snapshot.models.map((model) => model.providerId))].sort();
			const keyword = modelFilter.trim().toLowerCase();
			const filtered = snapshot.models.filter((model) => (!providerFilter || model.providerId === providerFilter) && `${model.providerId} ${model.modelId} ${model.name}`.toLowerCase().includes(keyword));
			const resetFilter = () => {
				setModelFilter("");
				setProviderFilter("");
			};
			const filtering = !!(keyword || providerFilter);
			const currentSupport = (model, field) => {
				return model.nativeImage;
			};
			/** 按 Provider 分组；组默认全部收起（点组头展开）；筛选生效时只显示匹配的组并全部展开。 */
			const attention = (group) => group.some((model) => snapshot.verifications.some((item) => item.model.providerId === model.providerId && item.model.modelId === model.modelId && (item.stale || item.status === "rejected" || item.status === "network-error")));
			const verifiedCount = (group) => group.filter((model) => snapshot.verifications.some((item) => item.model.providerId === model.providerId && item.model.modelId === model.modelId && item.status === "accepted" && !item.stale)).length;
			const warnCount = (group) => group.filter((model) => snapshot.verifications.some((item) => item.model.providerId === model.providerId && item.model.modelId === model.modelId && (item.stale || item.status === "rejected" || item.status === "network-error"))).length;
			const groups = providers.map((id) => ({
				id,
				models: filtered.filter((model) => model.providerId === id)
			})).filter((group) => group.models.length);
			const groupOpen = (id) => filtering ? true : expanded.has(id);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dmm-root",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: "模型管理" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
						className: "dmm-guide",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "这个插件是干什么的？（点开查看说明）" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "查看已加载模型及能力，配置别名、AUTO 自动选模型和视觉辅助。子 Agent 模型范围请到 DSH 官方设置配置。" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("ul", {
								className: "dmm-steps",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "推荐顺序" }), "：核对模型 → 配置别名 → 配置 AUTO 的评估模型与三个执行档 → 按需配置视觉辅助；子 Agent 使用 DSH 官方设置。"] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "模型选择" }), "：选具体模型或 @别名直接使用；选 AUTO 才会逐轮评估任务等级。"] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "看不到刚导入的模型" }), "：目录只代表宿主已加载的模型，点「刷新目录」即可，不必重启 DSH。"] })
								]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dmm-tabs",
						children: tabs.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							"aria-selected": tab === item,
							onClick: () => {
								setTab(item);
								if (item === "日志") request("/logs").then((result) => setLogs(result.events)).catch((error) => notify("error", String(error)));
							},
							children: item
						}, item))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						hidden: tab !== "模型来源",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SourcePanel, {
							dirty,
							disabled: busy,
							backupId: snapshot.sourceBackupId,
							navigate: ctx?.get?.("pluginNavigation") ? () => ctx.get("pluginNavigation").openBundle("dsh-opencode-go") : void 0,
							onRefresh: () => refreshDirectory(true),
							onApplied: (value) => {
								const next = asSnapshot(value);
								draftRevision.current = next.revision;
								setSnapshot(next);
								setDraft(structuredClone(next.config));
								window.dispatchEvent(new Event("dmm:config"));
							}
						})
					}),
					tab === "模型" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dmm-card",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "同步 DeepSeek 官方配置" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dmm-muted",
									children: "每次重新读取入口网页，由 LLM 根据原文识别当前 API model name；必要时读取相关链接。会调用一次或多次分析模型，产生用量。先预览，再手动应用。"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dmm-row",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["资料入口 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										"aria-label": "官方资料入口",
										disabled: busy,
										style: { width: "min(520px, 100%)" },
										value: officialSource,
										onChange: (event) => setOfficialSource(event.target.value)
									})] })
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dmm-row",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["分析模型 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SelectModel, {
										disabled: busy,
										value: officialAnalyzer,
										models: snapshot.models.filter((model) => model.providerId !== "dsh-model-manager"),
										aliases: [],
										onChange: (value) => {
											setOfficialAnalyzer(value && typeof value !== "string" ? value : void 0);
											setOfficialEffort(void 0);
										}
									})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["推理档位 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EffortSelect, {
										disabled: busy,
										label: "分析推理档位",
										target: effectiveAnalyzer,
										value: officialEffort,
										models: snapshot.models,
										aliases: {},
										onChange: setOfficialEffort
									})] })]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dmm-row",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["每轮分析时限（秒） ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										"aria-label": "每轮分析时限（秒）",
										type: "number",
										min: 30,
										max: 600,
										step: 1,
										disabled: busy,
										value: officialTimeout,
										onChange: (event) => setOfficialTimeout(event.target.value)
									})] })
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
									className: "dmm-muted",
									children: [
										"本次参数不保存，无需点击“保存设置”。未选择分析模型时使用宿主默认模型",
										!officialAnalyzer && snapshot.hostDefault ? `（${snapshot.hostDefault.providerId}/${snapshot.hostDefault.modelId}）` : "",
										"；独立于 AUTO。刷新只生成预览，手动应用才改选中差异。"
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dmm-row",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											disabled: busy,
											onClick: () => void refreshOfficial(),
											children: "刷新并预览"
										}),
										officialProgress && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											onClick: () => {
												officialAbort.current?.abort();
												setOfficial(null);
												setOfficialChecked([]);
											},
											children: "取消分析"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											disabled: busy || dirty,
											onClick: () => {
												setBusy(true);
												request("/official-restore", {
													method: "POST",
													body: "{}"
												}).then(async () => {
													await load();
													notify("success", "已恢复上次同步前的配置。");
												}).catch((error) => notify("error", String(error))).finally(() => setBusy(false));
											},
											children: "恢复上次同步"
										})
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(OfficialProgressStatus, { progress: officialProgress }),
								officialError && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dmm-error",
									role: "alert",
									children: officialError
								}),
								dirty && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dmm-note",
									children: "有未保存的插件草稿。应用或恢复前，请先保存或重新加载放弃草稿，再刷新预览。"
								}),
								official && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
										"官方当前 ",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: official.analysis.models.length }),
										" 个模型 · 本地 ",
										official.localModelIds.length,
										" 个 · 选中操作后预计 ",
										official.catalog?.counts.find((c) => c.providerId === "deepseek-official")?.after ?? predictedModelCount(official, officialChecked),
										" 个 · 差异 ",
										official.diffs.length,
										" 项"
									] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
										className: "dmm-muted",
										children: [
											"抓取时间：",
											official.fetchedAt,
											"；分析模型：",
											official.analyzer.providerId,
											"/",
											official.analyzer.modelId,
											"；推理档位：",
											official.reasoningEffort ?? "模型默认",
											"；每轮分析时限：",
											official.analysisTimeoutSeconds,
											" 秒。完整性由 LLM 判断，请核对原文；不代表当前账号调用验证。"
										]
									}),
									official.analysis.models.map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: model.id }),
										model.name ? ` · ${model.name}` : "",
										model.evidence.map((item, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
											className: "dmm-muted",
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
													href: item.source,
													target: "_blank",
													rel: "noreferrer",
													children: "依据网页"
												}),
												"：",
												item.quote
											]
										}, index))
									] }, model.id)),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", { children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "实际读取页面与完整性依据" }),
										official.pages.map((page) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
												href: page.url,
												target: "_blank",
												rel: "noreferrer",
												children: page.url
											}),
											" · ",
											page.fetchedAt
										] }, page.url)),
										official.analysis.completenessEvidence.map((item, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: item.quote }, index)),
										official.notes.map((note, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: note }, `note-${index}`))
									] }),
									official.catalog && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CatalogPreviewPanel, {
										view: official.catalog,
										selected: officialChecked,
										busy,
										onResolve: (selected, resolutions) => {
											resolveOfficial(selected, resolutions);
										}
									}),
									official.diffs.map((diff) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dmm-card",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [
												!official.catalog && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
													type: "checkbox",
													disabled: !!diff.blockedReasons.length || busy,
													checked: officialChecked.includes(diff.id),
													onChange: (event) => setOfficialChecked((current) => event.target.checked ? [...current, diff.id] : current.filter((id) => id !== diff.id))
												}),
												{
													name: "名称更新",
													inputModalities: "图片能力更新",
													contextWindow: "上下文更新",
													addModel: "新增模型",
													migrateModel: "合并迁移",
													removeModel: "移除旧模型"
												}[diff.field],
												"：",
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: diff.modelId }),
												"（原文证据）"
											] }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												className: "dmm-muted",
												children: diff.reason
											}),
											diff.field === "migrateModel" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
												diff.before.join("、"),
												" → ",
												diff.modelId,
												"（创建／合并目标、迁移引用、移除旧入口）"
											] }) : diff.field !== "addModel" && diff.field !== "removeModel" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
												JSON.stringify(diff.before),
												" → ",
												JSON.stringify(diff.after)
											] }) : null,
											diff.references.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("summary", { children: [
												"涉及 ",
												diff.references.length,
												" 处引用"
											] }), diff.references.map((path) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: path }, path))] }),
											!official.catalog && diff.blockedReasons.map((reason) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
												className: "dmm-error",
												children: [reason, "；请调整后重新预览。"]
											}, reason)),
											diff.evidence.map((item, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
												className: "dmm-muted",
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
														href: item.source,
														target: "_blank",
														rel: "noreferrer",
														children: "依据网页"
													}),
													"：",
													item.quote
												]
											}, index))
										]
									}, diff.id)),
									!official.diffs.length && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "dmm-muted",
										children: "当前官方模型清单及有证据的声明已一致。"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: "dmm-primary",
										disabled: busy || dirty || !officialChecked.length,
										onClick: () => void applyOfficial(),
										children: "应用选中差异"
									})
								] })
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CatalogManager, {
							backupWritesPlugin: snapshot.catalogBackupWritesPlugin,
							backupId: snapshot.catalogBackupId,
							externalBusy: busy,
							models: snapshot.models,
							capabilities: snapshot.catalogCapabilities ?? [],
							editor: catalogEditor,
							setEditor: (editor) => {
								setCatalogEditor(editor);
								setOfficial(null);
								setOfficialChecked([]);
								document.getElementById("dmm-catalog-editor")?.scrollIntoView({ block: "nearest" });
							},
							dirty,
							notify,
							onApplied: (value) => {
								const next = asSnapshot(value);
								setSnapshot(next);
								if (!dirty) setDraft(structuredClone(next.config));
								setOfficial(null);
								setOfficialChecked([]);
								window.dispatchEvent(new Event("dmm:config"));
							}
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ParameterPanel, {
							models: snapshot.models,
							config: snapshot.config,
							revision: snapshot.revision,
							defaultModel: snapshot.hostDefault,
							backupId: snapshot.parameterBackupId,
							manualBackupId: snapshot.catalogBackupId,
							legacyCount: snapshot.legacyImageOverrideCount ?? 0,
							dirty,
							externalBusy: busy,
							onBusyChange: setBusy,
							notify,
							onApplied: (value) => {
								const next = asSnapshot(value);
								setSnapshot(next);
								if (!dirty) setDraft(structuredClone(next.config));
								setOfficial(null);
								setOfficialChecked([]);
								window.dispatchEvent(new Event("dmm:config"));
							},
							onCredentialSaved: (value) => {
								const next = asSnapshot(value);
								draftRevision.current = next.revision;
								setSnapshot(next);
								setDraft((current) => current && {
									...current,
									parameterCompletion: structuredClone(next.config.parameterCompletion)
								});
								setOfficial(null);
								setOfficialChecked([]);
							}
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
							className: "dmm-guide",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "这一页是干什么的？（点开查看说明）" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "按 Provider 分组列出宿主已加载的模型，核对并修正能力声明、实测验证。组默认全部收起，点组头展开：" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("ul", {
									className: "dmm-steps",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "模型能力" }), "：优先看已加载模型目录及官方资料；需要确认当前账号是否能调用时再发真实验证请求。"] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "验证证据" }), "：与能力声明分开显示，不自动修改配置。"] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "「验证失败/过期」徽标" }), "：表示该组里有模型的验证证据是失败或已过期（配置改过后旧证据作废）。它只是提示「值得再测一次」，不代表模型不可调用——没验证过的模型本来就没有证据。"] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "宿主声明" }), "：可编辑模型的手动修正需单独保存到宿主；DeepSeek 官方模型可先用上方同步功能预览差异。"] })
									]
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(FilterBar, {
							text: modelFilter,
							onText: setModelFilter,
							provider: providerFilter,
							onProvider: setProviderFilter,
							providers,
							matched: filtered.length,
							total: snapshot.models.length,
							onReset: resetFilter,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									disabled: refreshing,
									onClick: () => {
										setRefreshing(true);
										refreshDirectory().catch((error) => notify("error", `刷新目录失败：${String(error)}`)).finally(() => setRefreshing(false));
									},
									children: refreshing ? "刷新中…" : "刷新目录"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dmm-muted",
									children: "真实调用验证会消耗用量；结果不自动修改模型声明。"
								}),
								!filtering && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									onClick: () => setExpanded(new Set(groups.map((group) => group.id))),
									children: "展开全部"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									onClick: () => setExpanded(/* @__PURE__ */ new Set()),
									children: "收起全部"
								})] })
							]
						}),
						groups.map((group) => {
							const open = groupOpen(group.id);
							const warn = attention(group.models);
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dmm-group",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dmm-group-head",
									role: "button",
									"aria-expanded": open,
									onClick: () => setExpanded((current) => {
										const next = new Set(current);
										if (next.has(group.id)) next.delete(group.id);
										else next.add(group.id);
										return next;
									}),
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("strong", { children: [
											open ? "▾" : "▸",
											" ",
											group.id
										] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "dmm-badge",
											children: [group.models.length, " 个模型"]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "dmm-badge",
											children: ["已验证 ", verifiedCount(group.models)]
										}),
										warn ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "dmm-badge dmm-badge-warn",
											children: [
												"验证失败/过期 ",
												warnCount(group.models),
												"（仅提示，不代表不可用）"
											]
										}) : null
									]
								}), open && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dmm-group-body",
									children: group.models.map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dmm-card",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: model.name }),
											" ",
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: "dmm-muted",
												children: [
													model.providerId,
													" / ",
													model.modelId
												]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "dmm-row",
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														disabled: busy || !snapshot.catalogCapabilities?.find((c) => c.providerId === model.providerId)?.canRename,
														onClick: () => {
															document.getElementById("dmm-catalog-editor")?.scrollIntoView({ block: "start" });
															setCatalogEditor({
																kind: "rename",
																model
															});
															setOfficial(null);
														},
														children: "修改显示名称"
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														disabled: busy || !snapshot.catalogCapabilities?.find((c) => c.providerId === model.providerId)?.canRemove,
														onClick: () => {
															document.getElementById("dmm-catalog-editor")?.scrollIntoView({ block: "start" });
															setCatalogEditor({
																kind: "remove",
																model
															});
															setOfficial(null);
														},
														children: "删除模型"
													}),
													snapshot.catalogCapabilities?.find((c) => c.providerId === model.providerId)?.reason && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "dmm-muted",
														children: snapshot.catalogCapabilities.find((c) => c.providerId === model.providerId)?.reason
													})
												]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "dmm-row",
												children: [
													"原生图片：",
													model.nativeImage,
													"；上下文：",
													model.contextWindow ?? "未知",
													"；默认输出：",
													model.defaultMaxTokens ?? "未知",
													"；推理档位：",
													model.reasoningEfforts.map((e) => e.id).join(" / ") || "模型默认",
													"；默认推理：",
													model.defaultReasoningEffort ?? "由来源决定",
													"；图片声明：",
													model.nativeDeclaration === "saved" ? "来源的已保存覆盖" : "来源默认"
												]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "dmm-muted",
												children: [
													"资料：",
													model.capabilitySource ?? "未知",
													model.capabilityCheckedAt ? ` · 核对于 ${model.capabilityCheckedAt}` : ""
												]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												className: "dmm-muted",
												children: snapshot.verifications.filter((item) => item.model.providerId === model.providerId && item.model.modelId === model.modelId).map((item) => `${item.kind}: ${item.status} / ${item.behavior ?? "未知"}${item.stale ? "（已过期）" : ""}`).join("；") || "尚无验证证据"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NativeEditor, {
												model,
												revision: model.nativeRevision ?? snapshot.nativeRevision,
												refresh: async () => {
													await refreshDirectory(true);
												},
												notify
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "dmm-row",
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														disabled: busy || probing !== "",
														onClick: () => void probeOne(model),
														children: probing === `${model.providerId}:${model.modelId}` ? "验证中…" : "验证图片能力"
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														disabled: busy,
														onClick: () => {
															setBusy(true);
															verifyOne({
																providerId: model.providerId,
																modelId: model.modelId
															}, "text").catch((error) => notify("error", String(error))).finally(() => setBusy(false));
														},
														children: "验证文字"
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														disabled: busy,
														onClick: () => {
															setBusy(true);
															verifyOne({
																providerId: model.providerId,
																modelId: model.modelId
															}, "image").catch((error) => notify("error", String(error))).finally(() => setBusy(false));
														},
														children: "验证图片"
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														disabled: busy,
														onClick: () => {
															setBusy(true);
															verifyOne({
																providerId: model.providerId,
																modelId: model.modelId
															}, "tools").catch((error) => notify("error", String(error))).finally(() => setBusy(false));
														},
														children: "验证工具"
													})
												]
											})
										]
									}, `${model.providerId}:${model.modelId}`))
								})]
							}, group.id);
						}),
						!groups.length && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dmm-card dmm-empty dmm-muted",
							children: [
								"没有匹配的模型。调整筛选条件，或点「清除筛选」查看全部 ",
								snapshot.models.length,
								" 个模型。"
							]
						}),
						verifyResult && !preview && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
							className: "dmm-card",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", {
								className: "dmm-composer",
								children: "查看最近一次验证的原始证据"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", { children: JSON.stringify(verifyResult, null, 2) })]
						})
					] }),
					tab === "别名与兜底" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AliasHealthPanel, {}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
							className: "dmm-guide",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "这一页是干什么的？（点开查看说明）" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									style: {
										margin: "6px 0",
										fontSize: 13
									},
									children: "别名 = 好记的名字 + 一串按顺序兜底的具体模型："
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("ul", {
									className: "dmm-steps",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "候选顺序即兜底顺序" }), "：第 1 个请求失败时按规则尝试第 2 个；模型选择器、AUTO 执行档和视觉模型处都能引用 @名字。"] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "推理档位" }), "：每个候选模型只显示自己支持的真实档位；留空使用模型默认。"] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "固定恢复规则" }), "：临时故障每候选最多 5 次，其他错误立即切换；不受三次总上限限制。成功后显示完整回答，已完成的工具操作不重做。"] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "内置别名 @long-context" }), "：供具体模型上下文溢出时使用；其他别名需要自行添加长上下文候选。"] })
									]
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dmm-card",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dmm-row",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									placeholder: "别名，如 fast",
									value: aliasName,
									onChange: (event) => setAliasName(event.target.value)
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									onClick: () => {
										if (!/^[a-z][a-z0-9_-]*$/.test(aliasName) || draft.aliases[aliasName]) return;
										edit((next) => {
											next.aliases[aliasName] = { candidates: [] };
										});
										setAliasName("");
									},
									children: "添加别名"
								})]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dmm-muted",
								children: "候选按顺序尝试；每个别名至少添加一个具体模型后才能保存。"
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AliasRemovalManager, {
							name: removingAlias,
							close: () => setRemovingAlias(null),
							dirty,
							externalBusy: busy,
							onBusyChange: setBusy,
							backupId: snapshot.catalogBackupId,
							notify,
							onApplied: (value) => {
								const next = asSnapshot(value);
								draftRevision.current = next.revision;
								setSnapshot(next);
								setDraft(structuredClone(next.config));
								setOfficial(null);
								setOfficialChecked([]);
								window.dispatchEvent(new Event("dmm:config"));
							}
						}, removingAlias ?? "restore"),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(LegacyPreferencesManager, {
							config: snapshot.config,
							aliasCount: snapshot.legacyAliasReliabilityCount ?? 0,
							dirty,
							externalBusy: busy,
							onBusyChange: setBusy,
							backupId: snapshot.catalogBackupId,
							notify,
							onApplied: (value) => {
								const next = asSnapshot(value);
								draftRevision.current = next.revision;
								setSnapshot(next);
								setDraft(structuredClone(next.config));
								setOfficial(null);
								setOfficialChecked([]);
								window.dispatchEvent(new Event("dmm:config"));
							}
						}),
						aliases.map((alias) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AliasCard, {
							name: alias,
							draft,
							models: snapshot.models,
							edit,
							notify,
							removeAlias: (name) => {
								if (busy) return;
								if (!Object.hasOwn(snapshot.config.aliases, name)) {
									edit((next) => {
										delete next.aliases[name];
									});
									return;
								}
								setRemovingAlias(name);
								setOfficial(null);
								setCatalogEditor(null);
								document.getElementById("dmm-alias-removal")?.scrollIntoView({ block: "nearest" });
							}
						}, alias)),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dmm-card",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "具体模型恢复策略" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dmm-muted",
									children: "仅用于最终目标为具体模型的受管理请求，不控制别名。别名使用上面的固定恢复规则；实际调用可去「日志」页核对。"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dmm-row",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: ["最多实际尝试（1–3） ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											type: "number",
											min: "1",
											max: "3",
											value: draft.reliability.maxAttempts,
											onChange: (event) => edit((next) => {
												next.reliability.maxAttempts = Number(event.target.value);
											})
										})] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											type: "checkbox",
											checked: draft.reliability.retryTransient,
											onChange: (event) => edit((next) => {
												next.reliability.retryTransient = event.target.checked;
											})
										}), "网络失败重试一次"] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											type: "checkbox",
											checked: draft.reliability.parameterDowngrade,
											onChange: (event) => edit((next) => {
												next.reliability.parameterDowngrade = event.target.checked;
											})
										}), "允许推理参数被拒时降级"] })
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dmm-muted",
									children: "已有输出不会重播；认证错误跳过同 Provider，429 暂时冷却；本轮明确指定的参数不会被静默降级。上下文溢出只尝试内置别名 @long-context 的候选。"
								})
							]
						})
					] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						hidden: tab !== "AUTO 自动选模型",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AutoTab, {
							draft,
							models: snapshot.models,
							aliases,
							edit,
							notify
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LegacyPreferencesManager, {
							config: snapshot.config,
							dirty,
							externalBusy: busy,
							onBusyChange: setBusy,
							backupId: snapshot.catalogBackupId,
							notify,
							onApplied: (value) => {
								const next = asSnapshot(value);
								draftRevision.current = next.revision;
								setSnapshot(next);
								setDraft(structuredClone(next.config));
								setOfficial(null);
								setOfficialChecked([]);
								window.dispatchEvent(new Event("dmm:config"));
							}
						})]
					}),
					tab === "视觉" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(VisionSection, {
						draft,
						models: snapshot.models,
						aliases,
						edit
					}),
					tab === "日志" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dmm-card",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dmm-muted",
								children: "查看实际使用的模型、AUTO 选择和看图结果，排查调用失败。"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								onClick: () => void request("/logs").then((result) => setLogs(result.events)).catch((error) => notify("error", String(error))),
								children: "刷新日志"
							}),
							logs.map((event, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dmm-log-row",
								children: [
									event.time ? new Date(String(event.time)).toLocaleString() : "时间未知",
									" · ",
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: event.action === "auto-evaluation" ? "AUTO 评估" : String(event.action ?? "执行调用") }),
									" · ",
									String(event.provider ?? ""),
									"/",
									String(event.model ?? ""),
									" · ",
									String(event.status ?? "完成"),
									" · ",
									event.durationMs == null ? "耗时未知" : `${event.durationMs} ms`,
									event.grade != null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
										" · ",
										String(event.grade),
										"：",
										String(event.reason ?? "")
									] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", {
										className: "dmm-muted",
										children: "详情"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", { children: JSON.stringify(event, null, 2) })] })
								]
							}, index)),
							!logs.length && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dmm-muted",
								children: "暂无记录。"
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dmm-actions",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: "dmm-primary",
								disabled: busy || !dirty,
								onClick: () => void save(),
								children: busy ? "处理中…" : "保存设置"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								disabled: busy,
								onClick: () => void reload(),
								title: "放弃未保存的修改，重新读取已保存的配置",
								children: "重新加载"
							}),
							dirty ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dmm-dirty",
								children: "● 有未保存的修改"
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dmm-muted",
								children: "没有未保存的修改"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dmm-muted",
								children: "「保存设置」把全部标签页的插件配置写入 DSH，下一次请求生效；模型卡片里的「保存到宿主」是另一件事：写入模型来源拥有的声明。"
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dmm-toasts",
						children: notices.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: `dmm-toast dmm-toast-${item.kind}`,
							role: "status",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: item.text }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								"aria-label": "关闭提示",
								onClick: () => dismiss(item.id),
								children: "×"
							})]
						}, item.id))
					}),
					preview && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dmm-modal-mask",
						onClick: () => {
							if (!busy) setPreview(null);
						},
						role: "presentation",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dmm-modal",
							role: "dialog",
							"aria-modal": "true",
							"aria-label": preview.title,
							onClick: (event) => event.stopPropagation(),
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: preview.title }),
								preview.failure && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dmm-error",
									children: preview.failure
								}),
								preview.applied && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
									className: "dmm-note",
									children: [
										"已应用：宿主声明 ",
										preview.applied.hostApplied,
										" 项",
										preview.applied.skipped ? `，${preview.applied.skipped} 项因宿主不可写被跳过` : "",
										"。"
									]
								}),
								!preview.failure && !preview.applied && preview.suggestions.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dmm-muted",
									children: "以下是真实请求得出的结论，高置信项已默认勾选。勾选后点「应用选中项」：「宿主原生图片声明」立即写入宿主，「插件声明」需再点页面底部「保存设置」。"
								}),
								!preview.failure && !preview.applied && preview.suggestions.length === 0 && (preview.verifications?.length || 0) > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dmm-muted",
									children: "本次请求没有产生可直接写入的结论，以下是原始验证证据："
								}),
								preview.elevated && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dmm-note",
									children: "该模型宿主声明为「不支持」，宿主会把图片替换成文字占位，因此探测期间已临时把声明提为「支持」实测，测完已恢复原声明——此处的「支持」结论来自图片真实到达模型的实测。"
								}),
								preview.restoreFailed && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dmm-note",
									children: "探测后未能恢复宿主原声明，请到模型卡片核对「宿主原生图片」的当前值。"
								}),
								(preview.notes ?? []).map((note, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dmm-note",
									children: note
								}, index)),
								preview.model && preview.suggestions.map((item, index) => {
									const blocked = item.field === "hostImage" && !preview.model.nativeEditable;
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dmm-row",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												type: "checkbox",
												disabled: blocked,
												checked: preview.checked[index] && !blocked,
												onChange: (event) => setPreview((current) => current && {
													...current,
													checked: current.checked.map((value, at) => at === index ? event.target.checked : value)
												})
											}),
											probeLabels[item.field],
											"：",
											supportLabels[currentSupport(preview.model, item.field)],
											" → ",
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: supportLabels[item.value] })
										] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "dmm-muted",
											children: [
												item.confidence === "high" ? "高置信" : "低置信",
												" · ",
												item.reason,
												blocked ? ` · 无法写入宿主：${preview.model.nativeEditReason ?? "该 Provider 未公开可写模型字段"}` : ""
											]
										})]
									}, `${item.field}-${index}`);
								}),
								(preview.verifications ?? []).map((item, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dmm-muted",
									children: `${item.kind}: ${item.status}${item.behavior ? ` / ${item.behavior}` : ""}${item.detail ? ` — ${item.detail}` : ""}`
								}, index)),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dmm-row",
									children: [preview.suggestions.length > 0 && !preview.applied && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: "dmm-primary",
										disabled: busy,
										onClick: () => void applyProbe(),
										children: "应用选中项"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										disabled: busy,
										onClick: () => setPreview(null),
										children: "关闭"
									})]
								})
							]
						})
					})
				]
			});
		}
		/** 面板错误边界：渲染异常时显示可重试的错误卡片，而不是让整个设置区白屏。 */
		var PanelBoundary = class extends react.default.Component {
			state = { error: null };
			static getDerivedStateFromError(error) {
				return { error };
			}
			render() {
				if (this.state.error) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dmm-root",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dmm-card",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "模型管理界面出错" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dmm-error",
								children: String(this.state.error)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								onClick: () => this.setState({ error: null }),
								children: "重试"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dmm-muted",
								children: "若反复出现，请重启 DSH 或反馈此错误文本。"
							})
						]
					})
				});
				return this.props.children;
			}
		};
		function apply(ctx) {
			injectStyle();
			ctx.slots.inject("plugins.bundle.config", () => ctx.slots.register({
				name: "plugins.bundle.config",
				key: "dsh-model-manager",
				label: "模型管理",
				inject: () => ({ ctx })
			}, (props) => props.view === "summary" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "管理模型来源、备用候选、AUTO 与图片辅助。" }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PanelBoundary, { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ManagerSection, { ctx }) })));
		}
		//#endregion
		exports.AliasCard = AliasCard;
		exports.SelectModel = SelectModel;
		exports.VisionSection = VisionSection;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
