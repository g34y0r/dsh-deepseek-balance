# 更新日志

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

> 0.x 系列是**回溯整理**的：开发期间版本号一直停在 `1.0.0`，从未发布过带版本号的中间产物。
> 真实发布过的只有 `1.0.0` 起的版本。

---

## [1.1.0]

为发布到 GitHub 做准备：新增许可与仓库元数据，并全面改名。**无功能改动。**

### 新增

- `LICENSE`：GPL-3.0-or-later 全文 + 版权声明。此前 `package.json` 虽标注 MIT，但仓库里没有许可文件。
- `.gitignore`：排除 `dist/`、`node_modules/` 等。
- `.gitattributes`：统一换行为 LF，避免跨平台 clone 后文件差异。
- `repository` 与 `keywords` 字段，指向 `github.com/BinGuinie/dsh-deepseek-balance`。
- package.json 的 description 改为中英双语的功能描述，替换原先的架构描述（后者假设读者了解 host/client 两半区的内部结构）。README 安装命令改为 Git 方式（`git+https://github.com/BinGuinie/dsh-deepseek-balance.git`），本地开发仍可用 `link:`。

### 变更

- **许可由 MIT 改为 GPL-3.0-or-later**（`package.json` 与 `manifest.json`）。选 GPL 是为了要求衍生作品同样开源。
- **包名 `dsh-plugin-api-usage` → `dsh-deepseek-balance`**。同步 `package.json` 的 `name`、`manifest.json` 的 `id`、`cordis.patch.yml` 的 `name`、`lib/` 两半区的模块身份、测试断言与文档。
- **行 id 与端点路径同步改名**：`ds-api-usage` → `deepseek-balance`。涉及 `cordis.patch.yml` 的 `- id:`、端点 `/deepseek-balance/state`、locale 命名空间、样式标签与 `localStorage` 键。包名、清单 id、模块 id、行 id 四处现已对齐。

### 打包

- **只发布 `.tgz`，不再生成 `-offline.zip`**。两个产物内容相同时只保留标准格式，不必让用户选择。
- **安装包只含运行时文件**（10 个）。`tests/` 与 `sync-profiles.ps1` 是开发用的，只存在于仓库，不随安装包发布。此前 zip 多带了这两类文件，占了体积七成，而下载者不会运行它们。
- 版本号 `1.0.3` → `1.1.0`。改用次版本号是因为改名属于破坏性变更。

### 升级说明

旧包不会被自动替换，需手动迁移：

```powershell
& $dsh plugin --profile <name> remove dsh-plugin-api-usage
& $dsh plugin --profile <name> add "link:<新路径>/dsh-deepseek-balance"
```

**行 id 变了**，profile 的 `cordis.patch.yml` 里若曾有 `- id: ds-api-usage` 的覆盖项，需改为 `- id: deepseek-balance` 或删除。

**端点路径变了**：`/ds-api-usage/state` → `/deepseek-balance/state`。有脚本调用旧路径的需同步更新。

**自动刷新设置会重置**（`localStorage` 键随包名改变），默认回到关闭状态。

---

## [1.0.3]

文档重整，无代码改动。

### 变更

- 文档由 5 份合并为 2 份，1005 行 → 714 行。删除 `DEVELOPMENT.md` 与 `OFFLINE-INSTALL.md`，内容并入 README。
- README 新增「设计理念」章节，经多轮压缩后定稿为一段话：只讲「为什么常驻」，具体方案（颜色、缩进、不补零）移出理念，交给代码与各章节说明。
- README「功能」章节补充零花费说明：不调用模型、不往上下文里加内容，放着不动不花钱。
- **本文件精简**：367 行 → 154 行。删去论证过程与自我说明，只保留「改了什么」；移除信息重复的版本对照表。
- 验证于 dsh `0.2.1-rc.5`（此前 `0.2.1-rc.3`）。
- 版本号 `1.0.2` → `1.0.3`。

### 修复

- `check-compatibility.mjs` 引用的 `OFFLINE-INSTALL.md` 已删除，改为只检查 README。

---

## [1.0.2]

文档与代码一致性修订，无代码改动。

### 修复

- README 文件结构图：`check-compatibility.mjs` 标为 6 项，实际 9 项。
- README 文件结构图：漏列 `OFFLINE-INSTALL.md`。
- README 测试章节：标为 4 项，实际 9 项。
- `OFFLINE-INSTALL.md`：产物差异写「多带 3 个文件」，实际 4 个。

### 变更

- 版本号 `1.0.1` → `1.0.2`；文档中的 `allow-version` 命令与离线包文件名同步更新。

---

## [1.0.1]

放宽版本门禁，允许任何 dsh 用户安装。

### 变更

- **`engines.dsh` 由 `^0.2.0-rc.1` 放宽为 `*`**。此前版本不符会在安装阶段被拒；现在任何版本都能装，由用户自行判断是否放行。

  代价：dsh 的**安装**与**加载**是两道关卡。非 0.2.x 上安装能通过，但启动时 bundle 会被跳过，症状是插件页有卡片、输入框旁没有控件、接口 404。用 `dsh plugin allow-version` 授权精确版本可解决。

- 离线包文件名恢复标准格式（曾尝试把适用版本写进文件名，过于冗长且方括号会被 PowerShell 当通配符）。

### 新增

- `sync-profiles.ps1`：把插件重新安装到所有已装过它的 profile，自动发现、重装并核对版本。不随 tgz 发布。

### 测试

- `check-compatibility.mjs` 增至 9 项，新增 `engines.dsh` 校验与文档风险提示检查。全量 34 项。

---

## [1.0.0] — 首发

### 新增

- 离线安装包：`.tgz` 与 `-offline.zip`。
- 卡片本地化：`locale/en.json` + `locale/zh.json`。
- `CHANGELOG.md`。
- 实测支持 dsh 0.2.x（验证于 `0.2.1-rc.3`）。

### 变更

- **改为单包 bundle 结构**：`package.json` 增加 `dsh.bundle.patch`，由自带的 `cordis.patch.yml` 挂载自身。`dsh plugin add` 会自动写入 profile 的 `dsh.profile.bundles`。
- 删除短暂的 `dsh-deepseek-balance-bundle` 配套包（改为单包后多余）。

### 修复

- 插件页开关不生效：手工 `- insert:` 挂载的行不属于任何 bundle，开关写不进 `disabled`。
- 卡片标题与介绍为英文：补 `locale/` 后按界面语言显示。

---

## [0.5.0]

### 新增

- 插件出现在侧边栏「插件」页面，可在卡片上单独开关。

### 修复

- 插件页看不到插件：该页只管理 bundle，无 `dsh.bundle` 的普通依赖不会出现。

---

## [0.4.0]

### 新增

- 悬停面板显示充值 / 赠金构成，缩进子行，充值在前，同色。
- 字段缺失时整行隐藏，不显示 `¥0.00`。

### 修复

- **`TypeError: Cannot read properties of undefined (reading 'validate')`** —— 插件静默不激活的根因。Cordis 用 `Config["~standard"].validate(config)` 解析配置，`Config` 曾是普通函数。表现为界面控件正常但接口 404。修复：给 `Config` 挂上 `"~standard"`，`validate` 同步返回 `{ value }`，对任何输入都不抛错。

---

## [0.3.0]

### 移除

今日花费、今日 Token、用量进度条、剩余百分比、每日额度，以及差值法基线和持久化状态文件。插件自此完全无状态。

> 差值法废弃的原因：官方余额结算有延迟，110 万 token 只反映 ¥0.02 的变化，算出的数字是错的。

### 变更

- 悬停面板只保留四项：余额、更新时间、自动刷新开关、手动刷新。
- `normalizeConfig()` 静默忽略废弃键，旧配置不会导致加载失败。

---

## [0.2.0]

### 变更

- 余额构成改为直接读取官方字段 `topped_up_balance` / `granted_balance`，不做推算。
- 移除「总额度（每日）」及其进度条与百分比。

### 修复

- **四舍五入抹平小额**：每次请求 `round(cost, 2)` 使 `0.0011` 变成 `0`。改为累积原始浮点数，仅在显示时格式化。

---

## [0.1.0]

### 新增

- 输入框工具栏右侧显示余额、用量进度条、今日花费、今日 Token、每日额度。
- 点击刷新；自动刷新开关（默认关闭，5 分钟）。
- 毛玻璃风格，纯 CSS，适配深浅主题，无过渡动画。
- 双语界面；三层密钥解析，密钥不出 host 进程。

### 设计约束（至今未变）

- **零运行时依赖**：host 半区不 import 任何 `@deepseek-ai/*`，只用 `node:` 内置模块。
- **配置校验手写**：不用 schemastery。
- **零 token 成本**：不发起 LLM 请求，不注册 prompt / tool / context。
