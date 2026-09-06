# dsh-lavs-integration

DeepSeek Harness（DSH）的**仓外插件集**：LAVS 视图集成 + headless resume runner。
不 fork DSH、不改上游任何文件——全部通过 DSH 官方扩展机制挂载。

## 组成

| 包 | 类型 | 作用 |
|----|------|------|
| `packages/lavs-host` | host 插件 | 发现 lavs.json bundle、同源 serve `/lavs-view/<bundle>/…`、`/lavs` Connection RPC（list/call → lavs-runtime ScriptExecutor）、`lavs_*` agent tools + SSE fan-out |
| `packages/ui-lavs` | client 插件 | conversation.view 里的 "Views" tab：iframe 装载 LAVS bundle，postMessage 桥接 RPC；preset 感知的 bundle 可见性 |
| `packages/ui-tasks` | client 插件 | conversation.view 里的 "Tasks" tab：todo 投影一等视图，交互走普通排队用户消息 |
| `packages/headless-resume` | host 插件 | headless one-shot runner 变体：`--resume <session-id>` / `--print-session-id` |
| `bundles/lavs` | bundle | 把前三个插件 insert 进任意 web profile |
| `bundles/headless-resume` | bundle | disable 原生 `headless-startup`/`headless-runner`，插入我们的变体 |

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

# 4. 启动
dsh --profile lavs --port 3099 --no-open

# headless resume 同理：
dsh plugin --profile headless-rs add file:$PWD/bundles/headless-resume
#   bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless", "dsh-bundle-headless-resume"]
dsh --profile headless-rs --print-session-id "task"   # 捕获 stderr 的 session id，之后 --resume 续跑
```

## 版本锚定（重要）

- **对齐线**：`@deepseek-ai/dsh-*` npm 同步发布到 `0.1.2-rc.1`（latest 标签滞后，装包要显式版本）
- **类型源**：本仓 devDependencies 用 `link:` 指向 dsh git master（0.1.3-alpha.1）的构建产物，
  因为 0.1.3 引入的 `ctx.sessions`、`rpc.handle` 两参签名等尚未发 npm；
  0.1.3-alpha.1 上 npm 后应整体切回 npm 版本
- **单实例要求**：`@deepseek-ai/cordis` 必须与类型源同一物理实例（link 同一处），
  否则 `declare module` 扩增会落到另一实例上全部失效（已踩坑，见 tools/build.ts 附近注释）
- API 漂移台账（相对 fork 基线 0.1.0-rc.5）：`web-react`→`web` 改名、`client-runtime` 删除并入
  `client-store`、`ctx.slots` 合并点迁至 `ui-renderer`、`client-ui-session` 服务更名
  `uiSession`→`sessions`、`rpc.handle` 去掉第三参、`SessionId(...)`→`brandString<SessionId>(...)`、
  headless summary 改 `session.eventAt(SessionSeq)`（session v2）

## 已验证

- [x] 全包 typecheck（对齐 dsh master 类型）+ 8 个构建产物
- [x] `--dump-config`：三个插件进入装配树
- [x] 真实启动：宿主 + client 双半边挂载成功（client-modules 组装含我们的 bundle）
- [x] `/lavs-view/todo-list/view/index.html` → 200（lavs-host 仓外服务视图文件）
- [x] headless-rs profile：`--help` 显示我们的 `--resume`/`--print-session-id`，错误路径为我们代码
- [x] 用户 patch 层热重载（曾用于跳过 onboarding 门）
- [ ] 浏览器端 Views tab 点击级验证（被工作区选择的原生目录选择器挡住，需真人鼠标一次）
