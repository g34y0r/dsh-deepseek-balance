# dsh-deepseek-balance

在 **dsh**（`dsh web` 与 DeepSeek Harness 桌面版通用）的输入框工具栏右侧常驻显示
DeepSeek API **账户余额**。

---

## 设计理念

我们认为，余额是个你不需要主动去问、但也随时会想知道的东西。所以我们把它常驻在输入框旁边，而不是藏在设置里。

---

## 功能

在输入框工具栏右侧常驻显示余额。**点击**余额数字刷新；**悬停**显示明细：

```
账户余额              ¥5.49
 · 充值               ¥3.32
 · 赠金               ¥2.16
 ─────────────────────────
更新时间         14:23:51
自动刷新              关      ← 默认关闭，开启后每 5 分钟刷新
```

数据来自官方 `GET /user/balance`，复用 dsh 已有的 `DEEPSEEK_API_KEY`，零配置。

它不调用模型，不往上下文里加任何东西——放着不动不花钱。

---

## 适用的 dsh 版本

**实测支持 dsh 0.2.x**（验证于 `0.2.1-rc.3`、`0.2.1-rc.5`）。查看版本：`dsh --version`

`engines.dsh = "*"` 是故意的放宽策略——任何版本都能**安装**。但**加载**仍受门禁约束：
非 0.2.x 上 dsh 会打印 `skipping profile bundle ... incompatible`，插件页有卡片、
输入框旁没有控件、接口 404。**这不是安装失败，是版本不兼容。**

要继续用，授权该精确版本后重启：

```powershell
dsh plugin --profile web allow-version dsh-deepseek-balance@1.1.0 --dsh-version <你的版本> --accept-risk
```

不行则用 `revoke-version` 撤销并 `remove` 卸载。授权**逐版本、逐插件**，升级后不继承。
插件不 import 任何 `@deepseek-ai/*`，在新版本上**很可能**可用，但那是推测不是验证。

---

## 安装

```powershell
$dsh = "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd"
& $dsh plugin --profile web add "git+https://github.com/BinGuinie/dsh-deepseek-balance.git"
```

桌面版把 `--profile web` 换成 `desktop`，然后**右键托盘图标完全退出**再启动（关窗口不够）。

**三个容易踩的点**：

- `--profile` 必须紧跟 `plugin` 之后 —— `plugin --profile web add <spec>` ✅ /
  `plugin add --profile web <spec>` ❌
- 装完**不要**手工编辑 `cordis.patch.yml`。本包自带 `dsh.bundle`，CLI 会自动写入
  `dsh.profile.bundles`；再手工 insert 会注册两遍。该文件保持 `[]` 即可
- 首次安装需要网络（从 GitHub 拉取），之后无需联网

**本地开发安装**：克隆后改用 `link:` 指向本地目录，改动即时生效：

```powershell
& $dsh plugin --profile web add "link:C:/path/to/dsh-deepseek-balance"
```

**离线安装**：`dist/` 下的 `.tgz`（10 个文件）与 `-offline.zip`（14 个文件，多带
`tests/` 与 `sync-profiles.ps1`）运行时内容相同，零依赖零网络请求：

```powershell
& $dsh plugin --profile web add "<路径>\dsh-deepseek-balance-1.1.0.tgz"
```

---

## 验证

### 接口

```powershell
Invoke-RestMethod http://127.0.0.1:3080/deepseek-balance/state | ConvertTo-Json -Depth 5
```

web 版端口 `3080`，桌面版 `19387`（也可能以 `--profile web` 启动而监听 3080，
先用 `Get-NetTCPConnection -LocalPort 3080,19387 -State Listen` 确认）。

```json
{
  "ok": true,
  "configured": true,
  "balance": { "currency": "CNY", "total": 5.03, "granted": 0, "toppedUp": 5.03 },
  "balanceError": null,
  "updatedAt": 1787...
}
```

| 状态码 | 含义 |
|---|---|
| `200` | 正常 |
| `404` | host 半区没加载 —— 检查 `bundles` 是否含本包、是否已重启、开关是否被关掉 |
| `401` | 被桌面版信任围栏拦下，加 `-Headers @{Host='127.0.0.1:19387'}` 重试 |

### 加载器树

应**恰好出现一次**，来源标注为本包：

```powershell
& $dsh --profile web --dump-config | Select-String 'deepseek-balance' -Context 2,2
```

```yaml
  # == dsh-deepseek-balance
- id: deepseek-balance
  name: dsh-deepseek-balance
  config: {}
```

### 界面

输入框右侧应出现 `¥余额` + 开关。侧边栏「插件」页应有一张 **DeepSeek 余额** 卡片，
里面一行 `deepseek-balance`，可单独开关。

---

## 配置项

在 patch 的 `config:` 下可选覆盖：

| 字段 | 默认 | 说明 |
|---|---|---|
| `baseURL` | `https://api.deepseek.com` | API 基地址，余额端点 = `<baseURL>/user/balance` |
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | 要解析的凭据引用名 |

其余字段一律忽略，旧配置不会导致加载失败。

**密钥解析顺序**（取第一个命中）：

1. `ctx.credentials.resolve(ref)` —— dsh 凭据服务（通过注入拿到，不 import）
2. `process.env[apiKeyEnv]`
3. `$DSH_HOME/.credentials.yaml` → `refs.<apiKeyEnv>`

密钥只存在于 host 进程，**永不出现在响应里**；全部未命中时报 `MISSING_CREDENTIAL`，不抛异常。

---

## 已知限制

- **无按 API Key 分账** —— DeepSeek 官方 API **没有**用量/花费查询接口，
  `GET /user/balance` 只返回整个账户的余额快照。想知道分 key 花费只能自行记账。
- **余额有结算延迟** —— 官方余额反映**已结算**金额，可能滞后于实际用量。
- **仅会话 composer** —— `conversation.input.right` 是 session 作用域插槽，无会话的英雄态不渲染。
- **插件页卡片只有一行** —— 插件页以 bundle 为单位组织，这是必然结果。

---

## 文件结构

```
dsh-deepseek-balance/
├── package.json                # 清单：main / dsh.client / dsh.bundle / exports
├── cordis.patch.yml            # bundle patch：插入并挂载自身（id: deepseek-balance）
├── locale/{en,zh}.json         # 插件页卡片标题与介绍（en.json 是本地化入口）
├── lib/
│   ├── index.js                # host 半区：密钥解析 → /user/balance → JSON 端点
│   └── client.js               # 浏览器半区：输入框工具栏毛玻璃小组件
├── manifest.json               # 给 DSH 读的元数据（非人类文档）
├── tests/                      # 34 项零依赖自检
├── CHANGELOG.md                # 版本变动
├── sync-profiles.ps1           # 开发用：同步到多个 profile（不随 tgz 发布）
└── README.md
```

---

## 测试

```powershell
node tests\smoke-host.mjs          # 16 项 —— host 半区逻辑
node tests\smoke-client.mjs        #  9 项 —— bundle 契约 + SSR 渲染
node tests\check-compatibility.mjs #  9 项 —— 清单 / bundle / 本地化 / 兼容性
```

合计 **34 项**，均以退出码表示结果（`0` 通过）。

---

## 卸载

```powershell
& $dsh plugin --profile web remove dsh-deepseek-balance
```

确认 profile 的 `package.json` 里 `bundles` 已不含本包、`cordis.patch.yml` 里没有残留的
`deepseek-balance` 覆盖项，然后重启。

---

## 技术约束

改代码前必读。这些不是建议，是**违反就会静默失败**的硬性约束。

### 1. `Config` 必须带 Standard Schema 的 `~standard.validate` ⚠️ 最容易踩

Cordis 用 `runtime.Config["~standard"].validate(config)` 解析插件配置。
把 `Config` 写成普通函数（无 `~standard`）会抛
`TypeError: Cannot read properties of undefined (reading 'validate')`。

**后果特别隐蔽**：该行**静默不激活**，client 半区照样显示（它的 `inject` 是数组、
不走配置校验），只有 host 半区从未注册路由 → 表现为「界面有控件，但接口 404」。

`~standard.validate` 必须：**同步**返回、返回 `{value}` 而非 `{issues}`、
对任何输入都不报错（旧配置里的废弃字段也要容忍）。

### 2. host 半区必须零 `@deepseek-ai` 依赖

`lib/index.js` 只 import `node:fs` / `node:path` / `node:os`。原因：profile 的
`node_modules` 与真正执行代码的宿主运行时，会把同一裸模块名解析到**不同版本**副本
（桌面版运行时封在 `app.asar` 内，而 `profiles/node_modules` 可能暴露另一版本）。
跨这个边界 import 会导致加载失败。

配置校验因此是**手写的**，不引入 `schemastery`。

### 3. `inject` 是服务名数组

```js
export const inject = ["credentials", "webServer"];   // ✅
// { required: [...], optional: [...] }              // ❌ 不支持的写法
```

### 4. 端点路径两侧硬编码

`lib/index.js` 的 `ENDPOINT_PATH` 与 `lib/client.js` 的 `ENDPOINT` 各写一次，
改一处必须同步另一处。

### 5. 静态测试全绿 ≠ 插件能加载

34 项测试都**不经过** `resolveConfig`，这正是第 1 条能藏很久的原因。
改过 `Config` 或 `inject` 后**必须**真启动 profile 抓 stderr：

```powershell
& $dsh --profile web --no-open 2>&1 | Select-String -Pattern 'did not activate|pending|import failed' -Context 0,6
```

桌面端不把启动日志落盘（Host 的 stderr 被 Electron 收进内存缓冲），只能用 CLI 启动等价
profile 看输出。注意 `node.exe` **读不到 `app.asar` 内部**，直接跑里面的文件会失败。

### 已确认的死路

- ❌ **给 host 半区加 `@deepseek-ai/dsh-credentials` 依赖** ——
  曾以为是版本混用导致 404，改完仍然 404；真正原因是第 1 条。
- ❌ **把 profile 的 `cordis.patch.yml` 写成注释-only** ——
  会被解析成 `null` 而非数组，需显式 `[]` 或 `- insert:` 条目。
- ❌ **手改 `app.asar` 内文件** —— 更新会被覆盖，且 asar 只读。
- ❌ **用 `--profile desktop` 启动** —— 被 Electron 独占，
  只有 `plugin --profile desktop` 允许。

---

## 发版

用户说「写更新日志，版本号 X」时，一起做完：

**① 写 CHANGELOG** —— 顶部插入 `## [X]`，只记上一个版本之后的改动，不重复历史。

**② 改版本号** —— `package.json` 与 `manifest.json` 的 `version`。

**③ 打包** —— 重打 `dist/` 下的 tgz 与 zip。

**④ 存档** —— 复制到 `Desktop\dsh-deepseek-balance\<X>\`（每版一子目录，只放这两个文件）。

**⑤ 同步 profile** —— `powershell -NoProfile -ExecutionPolicy Bypass -File .\sync-profiles.ps1`

核对三处易漂移的数字：`engines.dsh` 实际值、测试项数、产物文件数。
`--profile` 必须紧跟在 `plugin` 之后；`.ps1` 必须带 UTF-8 BOM。

---

## 版本变动

见 [CHANGELOG.md](./CHANGELOG.md)。

## 许可

[GPL-3.0-or-later](./LICENSE)。你可以自由使用、修改、分发，但基于它的衍生作品也必须以同样的协议开源。
