# dsh-lavs-integration

DeepSeek Harness（DSH）的**仓外插件集**：LAVS 视图集成 + headless resume runner。
不 fork DSH、不改上游任何文件——全部通过 DSH 官方扩展机制挂载。

## 组成

| 包 | 类型 | 作用 |
|----|------|------|
| `packages/lavs-host` | host 插件 | 发现 lavs.json bundle、同源 serve `/lavs-view/<bundle>/…`、`/lavs` Connection RPC（list/call → lavs-runtime ScriptExecutor）、loopback CLI 端点（`~/.dsh/lavs-host.json` 发现文件）；`lavs_*` agent tools 为 **opt-in**（`registerAgentTools: true`），默认关闭 |
| `packages/ui-lavs` | client 插件 | conversation.view 里的 "Views" tab：iframe 装载 LAVS bundle，postMessage 桥接 RPC；preset 感知的 bundle 可见性 |
| `packages/ui-tasks` | client 插件 | conversation.view 里的 "Tasks" tab：todo 投影一等视图，交互走普通排队用户消息 |
| `packages/headless-resume` | host 插件 | headless one-shot runner 变体：`--resume <session-id>` / `--print-session-id` |
| `packages/lavs-cli` | CLI | `lavs list / schema / call` 三动词，零依赖薄客户端，经宿主 loopback 端点读写——**MCP 工具的上下文经济替代**（CLI + Skill 按场景加载，替代 N×M 常驻工具 schema） |
| `bundles/lavs` | bundle | 插入 lavs-host / ui-lavs / ui-tasks，并携带 CLI 进 profile `node_modules/.bin/lavs` |
| `bundles/headless-resume` | bundle | disable 原生 `headless-startup`/`headless-runner`，插入我们的变体 |
| `skills/lavs` | skill | Agent 场景知识：三动词工作流；装到 `~/.dsh/skills/lavs/`（dsh 原生 skill 发现路径） |

## Agent 工具策略：CLI + Skill 优先

mutation 记录内聚在 `service.call`：**不管哪个面**（浏览器 RPC / CLI / opt-in 工具）驱动写入，
都走同一条审计流 + SSE fan-out，挂载的视图自动刷新。CLI 绝不直写存储——那会让视图变陈旧。

## 依赖的官方机制（上游 `packages/boot/app-boot/README.md`）

- **Profile**：`~/.dsh/profiles/<name>/`，`package.json` 里 `dsh.profile.bundles` 有序 bundle 层 + 用户 `cordis.patch.yml`（bundle 层之后应用，支持 HMR）
- **Bundle**：任何声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` 的 npm 包
- **Client module**：插件包声明 `"dsh": { "client": { "inject": [...], "platform": "web" } }`，宿主运行时经 `/plugins/<id>/client.js` 动态 serve，前端无需重新构建

## 快速开始

```sh
# 1. 构建插件（类型对齐 dsh master；见下方“版本锚定”）
pnpm install && pnpm run typecheck && pnpm run build

# 2. 建 profile 并装 bundle（任一 dsh 安装）
dsh plugin --profile lavs add file:$PWD/bundles/lavs
# 编辑 ~/.dsh/profiles/lavs/package.json 的 dsh.profile.bundles：
#   ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-bundle-lavs"]

# 3. 指定 LAVS bundle 目录（可选，默认扫 ./bundles 与 ~/.dsh/lavs-bundles）
echo 'LAVS_BUNDLES_DIR=/path/to/lavs/bundles' >> ~/.dsh/.env

# 4. 装 Agent skill（dsh 原生发现路径）
mkdir -p ~/.dsh/skills && cp -R skills/lavs ~/.dsh/skills/

# 5. 启动
dsh --profile lavs --port 3099 --no-open

# Agent 侧（或人手）即可：
~/.dsh/profiles/lavs/node_modules/.bin/lavs list
lavs schema todo-list
lavs call todo-list addTodo --input '{"text":"…","priority":1}'

# headless resume 同理：
dsh plugin --profile headless-rs add file:$PWD/bundles/headless-resume
#   bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless", "dsh-bundle-headless-resume"]
dsh --profile headless-rs --print-session-id "task"   # 捕获 stderr 的 session id，之后 --resume 续跑
```

## 版本锚定（重要）

- **类型源**：pnpm 依赖保持纯 npm（真实可发布形态）；`@deepseek-ai/dsh-*` 与 vendored
  cordis/schemastery/loader 的**类型**经 `tsconfig.base.json` 的 `paths` 直指 dsh git master
  工作树的 `lib/types/*.d.ts`（0.1.3-alpha.1）。不使用 npm dsh 包做 devDep——npm `latest`
  标签滞留在 0.0.1-rc.1（其依赖的 `dsh-type-meta` 从未发布，安装即 404），显式版本也不必：
  0.1.3 上 npm 后把 paths 换回普通 devDeps 即可
- **单实例要求**：cordis/schemastery/plugin-loader 必须与 dsh 包的 d.ts 同一物理实例
  （paths 统一指到同一棵树），否则 `declare module` 扩增会落到另一实例上全部失效（已踩坑）
- **peerDependencies 一律 `*`**：运行时由 dsh 安装树供给（profile node_modules 父目录
  parent-walk），范围声明只会引来错误解析
- API 漂移台账（相对 fork 基线 0.1.0-rc.5）：`web-react`→`web` 改名、`client-runtime` 删除并入
  `client-store`、`ctx.slots` 合并点迁至 `ui-renderer`、`client-ui-session` 服务更名
  `uiSession`→`sessions`、`rpc.handle` 去掉第三参、`SessionId(...)`→`brandString<SessionId>(...)`、
  headless summary 改 `session.eventAt(SessionSeq)`（session v2）

## 已验证

- [x] 全包 typecheck（paths→dsh master lib/types）+ 9 个构建产物
- [x] `--dump-config`：三个插件进入装配树
- [x] 真实启动：宿主 + client 双半边挂载成功；CLI 发现文件 `~/.dsh/lavs-host.json` 落盘
- [x] `/lavs-view/todo-list/view/index.html` → 200（lavs-host 仓外服务视图文件）
- [x] **CLI 往返**：`lavs call todo-list addTodo` → listTodos 读回 → todos.json 落盘 ✓；
  mutation 经宿主记录 agent-action 并 SSE fan-out（视图自动刷新链路保持）
- [x] headless-rs profile：`--help` 显示我们的 `--resume`/`--print-session-id`，错误路径为我们代码
- [x] 用户 patch 层热重载（曾用于跳过 onboarding 门）
- [ ] 浏览器端 Views tab 点击级验证（被工作区选择的原生目录选择器挡住，需真人鼠标一次）
