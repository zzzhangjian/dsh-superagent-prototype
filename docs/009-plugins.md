# 009 插件：Feature 契约

Source 之外，dsh-superagent 还有第二个插件面：**Feature**。它和 `SourceKind` 平行，都通过同一个宿主注册、都拥有自己的配置、都由设置页保存，区别是 Feature 描述的是「一件工作怎么跑」，而 Source 描述的是「消息从哪来、回到哪去」。

术语沿用 [001 Domain model](001-domain.md) 与 [002 Authorization](002-authorization.md)，组件位置见 [007 Architecture](007-architecture.md)。

## 契约

`src/features/kind.ts` 定义 `Feature<C>`。它是一个纯声明式的描述符，字段全部是数据或函数，不含任何执行入口：

| 字段 | 含义 |
| --- | --- |
| `id` | 稳定标识，也是设置块 `feature:<id>` 的后半段 |
| `title`、`description` | 双语文案，见 `Localized` |
| `schema` | 校验并补全实例配置的 zod schema |
| `fields` | 配置表单的字段描述，复用 Source 的 `FieldSpec` |
| `health` | 该 Feature 独占的健康条目名 |
| `roles?` | 角色：`personaPart` 指向提示词部分，`handoff` 说明工作怎么交回（ready、pr、report） |
| `stages?` | 阶段：进入条件 `entry`、离开条件 `exit`、产出 `produces`、可选重复上限 `loops` |
| `artifacts?` | 产物：`schema`、`fields`、`template`、存放位置 `home`、可选的 `path(value, ticket)` |
| `gates?` | 闸门：所属阶段、`kind`、证据来源 `evidenceSource`、失败时由谁修复 |
| `panels?` | 多轮评审：成员角色、轮数、记录结论的产物、收敛方式 |
| `deployer?` | 发布链，见下节 |
| `environment?` | 该 Feature 向执行环境注册的变量，以及这些变量的取值函数 |

`Localized` 与 `FieldSpec` 不重新定义，直接由 `src/sources/kind.ts` 再导出，因此两个插件面的配置表单和双语文案是同一套类型。

## 注册表

`src/features/registry.ts` 的 `FeatureRegistry` 与 `SourceRegistry` 结构一致：

- `register(feature)` 返回注销函数。重复 `id` 直接抛错。
- 注册时按 `health` 逐个在 `HealthBoard` 上认领条目：名字被别的部件占用就抛错，`sync:` 前缀保留给 Settings，同样拒绝。注销时释放全部条目。
- `instances(settings?)` 返回实例列表：已安装的按 `id` 排序，`installed: true`；设置里存着但对应 kind 未安装的排在后面，`installed: false`，配置原样保留。
- `instance(id)` 取单个实例；`kind(id)` 取 kind；`validate(id, value)` 用 kind 的 schema 校验提交的 `{ enabled, config }`，kind 未安装时抛错。
- 存储的配置校验不通过时，实例被当作禁用，并回退到 schema 的默认值。

构造函数的第三个参数是注册回调，Runtime 用它把新注册的 Feature 接到需要它的地方；默认是空实现。

## 发布链

`DeployerSpec` 是「按顺序经过的环境」：每个环境有 `name`、`branch`、`auto` 和观察窗口 `observe: { minutes, fails }`。

分支是一等配置，由部署自己填，代码里没有写死的分支常量；`develop` 和 `main` 只作为默认值出现，顺序始终以 `environments` 数组为准，因此 `develop → main` 只是其中一种排法，换成任何别的分支组合都同样成立。

`src/features/release.ts` 里的 `releaseKind` 是第一个 Feature kind，也是当前唯一自带配置表单的 Feature：`ReleaseConfigSchema` 校验环境列表，要求至少一个环境、环境名非空、分支名是合法的 git ref（不得以 `-` 或 `/` 开头、不得以 `/` 结尾、不得含 `..`），`auto` 既接受布尔值也接受表单提交的 `'true'`/`'false'` 文本。面板的一行只能填 `name`、`branch`、`auto`；观察窗口保留在配置里，不在表格中编辑。

## 设置块

设置 schema（`src/policy.ts`）新增顶层 `features`：以 kind id 为键、`{ enabled, config }` 为值的记录，默认空。`SettingsBlock` 相应扩展出 `feature:<string>`。

`src/app/settings.ts` 中新增一个 `feature` 块，和 `source` 块一一对应：

- `parse` 委托给 `FeatureRegistry.validate`；
- `merge` 只改写 `settings.features[id]`；
- `guard` 规定只有 `origin === 'panel'` 才能改动 Feature 的配置。

kind 未安装时保存被拒绝；配置不合法时由 schema 抛错；被拒绝的保存不写入任何内容，块的修订号也不前进。`features` 不参与 `policyVersion` 的计算，因此改 Feature 配置不会触发 Policy 变更。Runtime 在装配时构造 `FeatureRegistry` 并传给 `Settings`，与 `SourceRegistry` 的接法相同。

## 尚未实现

本里程碑只落地声明式的契约、注册表、发布链配置与设置块。下列内容明确不属于当前实现，属于后续里程碑：

- **执行**：没有任何代码读取 `roles`、`stages`、`artifacts`、`gates`、`panels` 去驱动工作，也没有对应的状态机、效果或判定。
- **发布执行**：`DeployerSpec` 只是配置面，不会合并分支、不会触发部署、不会观察窗口，也不会因为环境状态改变任何记录。
- **交付清单**：不存在由 Feature 生成的交付清单或产物文件。
- **管理接口**：`src/app/http.ts` 目前仍然只接受 `policy`、`eval`、`executor` 和 `source:<id>`，`feature:<id>` 会被这一层直接拒绝；设置块本身已经可用，等待接口开放。
- **面板**：侧边栏和设置页还没有 Feature 分组或编辑界面，`release` 的字段描述目前只被设置块使用。
- **内置 Feature**：默认不注册任何 Feature kind，`releaseKind` 需要宿主显式注册；因此默认设置里 `features` 为空。
