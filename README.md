# dsh-lavs-integration

DeepSeek Harness（DSH）的**仓外插件集**：LAVS 视图集成 + headless resume runner（**已废弃**，见下）。
不 fork DSH、不改上游任何文件——全部通过 DSH 官方扩展机制挂载。

## 组成

| 包 | 类型 | 作用 |
|----|------|------|
| `packages/lavs-host` | host 插件 | 按**会话工作目录**发现 `.lavs/bundles/` 下的 lavs.json bundle、同源 serve `/lavs-view/<bundle>/…`、`/lavs` Connection RPC（list/call → lavs-runtime ScriptExecutor）、loopback CLI 端点（`~/.dsh/lavs-host.json` 发现文件）；`lavs_*` agent tools 为 **opt-in**（`registerAgentTools: true`），默认关闭 |
| `packages/ui-lavs` | client 插件 | **原生右侧栏 tab**（`ctx.sidebarRightTabs` 两段式注册，`keepMounted`）：iframe 装载 LAVS bundle，postMessage 桥接 RPC；视图严格跟随会话工作目录——项目没有 bundle 就显示空态引导 |
| `packages/ui-tasks` | client 插件 | **[待移植，不随 bundle 发布]** conversation.view 里的 "Tasks" tab：todo 投影一等视图。写就于 fork（0.1.0-rc.5）时代的 `ctx.sessions.binding()` API，0.1.7-rc.2 上不存在，需按 `SessionStore.get` + client 源注册表重写 |
| `packages/headless-resume` | host 插件 | **[已废弃]** headless one-shot runner 变体：`--resume <session-id>` / `--print-session-id`——上游 ≥ 0.1.6-alpha.1 原生 `--session-id`(adopt)+ `--json` 已取代,仅留档给 0.1.0-rc.x 旧版 |
| `packages/lavs-cli` | CLI | `lavs list / schema / call` 三动词，零依赖薄客户端，经宿主 loopback 端点读写——**MCP 工具的上下文经济替代**（CLI + Skill 按场景加载，替代 N×M 常驻工具 schema） |
| `bundles/lavs` | bundle | 插入 lavs-host / ui-lavs，并携带 CLI 进 profile `node_modules/.bin/lavs` |
| `bundles/headless-resume` | bundle | **[已废弃]** disable 原生 `headless-startup`/`headless-runner`，插入我们的变体——同上,仅留档 |
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
# 渠道一：npm（推荐——插件已发布，pnpm 自动替换 workspace 版本）
# 1. 建 profile 并装视图层（web-app 必须与 dsh 运行时同版本；latest 标签停留在
#    上游 0.0.x 时代，务必用显式版本）
dsh plugin --profile lavs add dsh-bundle-lavs
dsh plugin --profile lavs add @deepseek-ai/dsh-web-app@<你的 dsh 版本>
# 2. 视图是项目属性：在 Agent 的工作目录下放 .lavs/bundles/<bundle>/lavs.json
#    （lavs init 可生成脚手架）；无 bundle 的项目显示空态引导
# 3. 装 Agent skill（dsh 原生发现路径）
mkdir -p ~/.dsh/skills && cp -R skills/lavs ~/.dsh/skills/
# 4. 启动
dsh --profile lavs --port 3099 --no-open
~/.dsh/profiles/lavs/node_modules/.bin/lavs list --workspace <项目目录>

# 渠道二：本仓开发（clone 后）
pnpm install && pnpm typecheck && pnpm test && pnpm build
# workspace:^ 依赖只在仓内 pnpm workspace 里有意义——装 profile 用打包产物：
pnpm --filter dsh-plugin-lavs-host pack   # 等三个插件 + bundle
# 然后按「渠道一」安装 tarball；跨包改动用 profile package.json 的
# pnpm.overrides 把包名指向本地 tarball（见 git 历史里的 e2e 配方）
```

## 与上游 dsh 的版本关系

- **类型与构建**：根 package.json 以 **npm devDeps 精确锁 `@deepseek-ai/dsh-*@0.1.7-rc.2`**
  （cordis ~4.0.4 / schemastery ~3.18.4 / loader ^1.0.5），类型来自 npm 包自带的
  `lib/types/**/*.d.ts`——曾经「npm dsh 不可安装（latest 滞留 0.0.x、依赖未发布的
  dsh-type-meta 装了就 404） hence tsconfig paths 锚定 git 工作树」的做法已退役
  （2026-09-27 实测 npm 安装+运行全通）。`latest` 不可信的只剩上游自己的包
  （dsh-web-app 的 latest 仍是 0.0.1-rc.1，插件安装时会被兼容门拒绝——用显式版本）。
- **单实例要求**：cordis/schemastery/loader 的 d.ts 必须与消费它的 dsh 包类型同处
  一棵依赖树，`declare module` 增强才生效。现在由 pnpm 保证：这些包只出现在**根**
  devDeps，各插件包不得再声明自己的副本（版本范围不一致会产生两个物理实例，
  增强 全部落空——已踩坑，包级 devDeps 已删）。
- **peerDependencies**：`@deepseek-ai/dsh-*` 一律 `^0.1.7-rc.2`——发布形态下这是
  dsh 兼容门的输入（`dsh plugin add` 在 pnpm 运行**前**预检 peer 范围，不匹配直接
  拒绝；启动时 bundle 级再查一次，不匹配进 `skippedBundles`）。cordis/schemastery
  保持 `*`（由 dsh 安装树 parent-walk 供给，且不在 dsh 的 peer 检查范围）。
- API 漂移台账（fork 基线 0.1.0-rc.5 → 0.1.7-rc.2）：`web-react`→`web`、`client-runtime`
  并入 `client-store`、`ctx.slots` 合并点迁至 `ui-renderer`、`rpc.handle` 去掉第三参
  （外部通道不可用→本插件自挂 webServer prefix 路由）、`SessionId(...)`→
  `brandString<SessionId>(...)`、headless summary 改 `session.eventAt(SessionSeq)`、
  **`ctx.sessions` 语义变化**：rc.2 的 `SessionStore`（dsh-session 提供）只有
  `get/list/create` 等方法，master 时代的 `list` observable 与 `binding()` 不存在——
  ui-tasks 即卡在这。

## 发布

```sh
# 前置：npm 已登录（npm whoami）；@jeffkit scope 归属你的账号/组织
pnpm --filter "dsh-plugin-lavs-host" publish   # 先插件（workspace:^ 自动替换为 ^0.1.0）
pnpm --filter "dsh-plugin-lavs-cli" publish
pnpm --filter "dsh-plugin-ui-lavs" publish
pnpm --filter "dsh-bundle-lavs" publish        # 后 bundle
# 版本推进：改各包 version + bundle 的 workspace:^ 会自动带出新版本范围
```

## 已验证

- [x] 全包 typecheck（paths→dsh master lib/types）+ 9 个构建产物
- [x] `--dump-config`：三个插件进入装配树
- [x] 真实启动：宿主 + client 双半边挂载成功；CLI 发现文件 `~/.dsh/lavs-host.json` 落盘
- [x] `/lavs-view/todo-list/view/index.html` → 200（lavs-host 仓外服务视图文件）
- [x] **CLI 往返**：`lavs call todo-list addTodo` → listTodos 读回 → todos.json 落盘 ✓；
  mutation 经宿主记录 agent-action 并 SSE fan-out（视图自动刷新链路保持）
- [x] **workspace 作用域**：`lavs list --workspace <dir>` 只见该项目的 `.lavs/bundles/`；
  不带 workspace 不可见 ✓；workspace 视图文件 `/lavs-view/<bundle>/` 服务 200 ✓
- [x] headless-rs profile：`--help` 显示我们的 `--resume`/`--print-session-id`，错误路径为我们代码
- [x] 用户 patch 层热重载（曾用于跳过 onboarding 门）
- [x] **npm 发布形态端到端**（2026-09-27，tarball 预种 +verdaccio 等价物）：`dsh plugin add`
  tarball → peer 预检通过 → bundle 选中 → `--dump-config` 三个插件入装配树 → 真实启动
  web 200 → `lavs list/schema/call` 全链路往返 → `/lavs-view/<bundle>/view/` 同源 200；
  顺带抓到并修复 cordis.patch.yml 裸 `@scope/...` 值的 YAML 语法错误（scoped 名必须加引号）
- [ ] 浏览器端 header 按钮与抽屉的点击级验证（建会话需原生目录选择器，需真人一次；
  自动化已验证到 /lavs-view 200 与 CLI 全链路）

## 视图作用域语义（v3：纯项目作用域）

- **视图是项目属性**：一个会话能看到的 bundle，就是它工作目录下
  `.lavs/bundles/` 里声明的那些——没有全局根、没有部署级 bundlesDir。
  换个项目 = 换一组视图；目录不存在 = 空态引导（提示在项目下建 bundle）
- **热更新**：`.lavs/bundles/` 被 fs.watch 盯着，项目里新写/修正的
  manifest 不重启即可出现在切换器里
- **挂载形态**：dsh 0.1.7+ 的原生右侧栏——`ctx.sidebarRightTabs` 注册
  `keepMounted` 的 `lavs` page 类型 + guide 入口，布局（宽度/分屏/持久化）
  全部交还 dockkit，本插件只负责内容
- 历史：v1 为 conversation.view tab，v2 为自绘右侧抽屉（含 preset/部署级
  三级作用域）——均随上游演进废弃；preset 作用域随上游 AgentPreset 去目录化一并移除
