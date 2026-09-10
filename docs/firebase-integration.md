# Firebase 保存与 SAP 同步

## 当前实现边界

新增代码提供**内部样本工作区的 Firebase 保存**和**内网 SAP 原始快照同步脚本**。尚未连接用户项目、发布数据库规则、上传真实数据、创建定时任务。页面会明确显示未连接，不会把会话缓存称为云端保存。

真实 SAP 快照目前进入独立的原始数据区。将其投影为网页订单还需正式确认 PO/SO 关联、料号及单位映射、价格口径、跨公司链路和实际业务日期；代码主动拒绝将原始快照当成演示订单加载。供应商账户当前被规则拒绝；在形成按供应商隔离的数据投影与经过服务端验证的命令接口前，只开放指定内部采购人员试用。

## 数据路径与写入方式

| 路径 | 内容 | 写入方 |
| --- | --- | --- |
| `supplierCollaboration/sap/runs/{run}` | 一轮完整的 PO、SO、交货、交期行、历史原始记录 | 内网同步端 |
| `supplierCollaboration/sap/current` | 最新完整快照指针 | 内网同步端 |
| `supplierCollaboration/sync` | 同步成功检查时间及运行结果 | 内网同步端 |
| `supplierCollaboration/workspaces/{workspace}/source` | 经确认的网页基础数据；当前仅支持虚构样本 | 管理端 |
| `supplierCollaboration/workspaces/{workspace}/versions/r{n}` | 平台协作状态、修改者、服务端时间、操作类型和变化记录 | 指定内部登录用户 |
| `supplierCollaboration/members/{uid}` | 内部试用成员及工作区 | 管理端 |

协作记录采用追加版本，已存在的版本不可修改或删除。两个人从相同版本提交时争用同一下一版本，只有一个成功，另一个收到冲突提示。每个版本保存完整的协作状态 JSON，保留空字符串、null、空数组等“清空字段”的含义。适合当前小规模试用；真实生产量级需要改为服务端校验命令、实体级版本及独立审计，避免每次保存整个协作工作区。

SAP 同步从不写 `workspaces` 或 `versions`。网页投影允许的协作字段采用白名单，SAP 数量、价格、过账和收货事实不从协作存档还原。SO 引用作为平台核实关联保留，不能当成对 SAP 原单的修改。

删除尚未过账的业务报发：留删除时间和原因、回退报发数量、从正常列表隐藏，可在数据中心恢复。已关联 SAP 的发运禁止直接删除。清空 ETA、箱号、快递号等会写入新版本，旧值仍在历史版本中。

## 启用内部试用的步骤

1. 让当前管理账户能够访问 Firebase 项目。检查现有 RTDB 规则和其他使用者；本仓库 `firebase/database.rules.json` 是**独立应用的完整候选规则**，不能未经检查直接覆盖其他应用的规则。父级公开读写会让子级保护失效。
2. 使用 Firebase Authentication 为指定人员创建账号，启用 Email/Password。将成员 UID 加入受保护的成员目录；不要给任意注册者默认业务权限。
3. 从 Firebase 项目 Web 应用配置取得 API key，配置本地 `.env.local` 中的 `VITE_FIREBASE_API_KEY`，再重新构建网页。API key 是公开配置，管理端服务账户私钥绝不能放入任何 `VITE_` 变量。
4. 在受信机器上设置 `GOOGLE_APPLICATION_CREDENTIALS` 指向项目专用服务账户文件，并确认匿名无法读取业务路径。执行 `node scripts/initialize-firebase-pilot.mjs <UID>`，只初始化虚构样本和内部成员。初始化拒绝覆盖已有工作区。
5. 在网页数据中心登录；修改 ETA、延期和运输号码、刷新后重新登录，验证重载、第二个会话同步、冲突拒绝、删除恢复及历史版本。身份凭据由 Firebase SDK 管理，应用不保存用户密码。

管理端使用专用服务账户，不使用开发者 Firebase CLI 刷新令牌作为长期同步凭据。

## 内网 SAP 同步

1. 把 `scripts/sap-sync.config.example.json` 复制到受控的本地配置目录。密码不写 JSON。使用 Windows `Get-Credential | Export-Clixml` 保存为只限当前 Windows 用户解密的 SAP 凭据，并填入路径。
2. 指定 Firebase 服务账户文件路径、Node 路径和公司/工厂/供应商范围。当前默认范围来自已核对链路：采购公司 3110、工厂 3111、供应商 3060；SO 销售组织 3090、客户 3060。不是笼统将所有 SO 当成 3110。
3. 先运行 `scripts/sync-sap.ps1 -ConfigFile <path> -DryRun`：只读 SAP，落本地快照并验证，不上传。
4. 权限收紧并确认范围后运行一次不带 `-DryRun` 的同步。同步端会再次检查匿名访问；公开可读或检测结果不明确时拒绝上传。每张表最多 50,000 行，超限或任何查询失败不推进最新指针。
5. 单次验证成功后执行 `scripts/register-sap-sync.ps1 -ConfigFile <path> -IntervalMinutes 30`。该脚本只负责注册系统任务，当前尚未执行。任务名固定，拒绝覆盖已有任务；失败最多重试两次，同步进程用互斥锁防止重入。

这个任务运行于当前 Windows 用户已登录、电脑开机且能连接 SAP 内网时。持续运行需要公司服务器或固定同步主机。网页关闭不影响系统任务；电脑关机则无法同步。

快照是同一轮多个只读查询的结果，不是数据库跨表事务时间点快照。记录轮次开始、结束时间；冲销保留 SAP 原值，不在此层猜测净数量。缺失记录只意味着不在本轮查询结果中，不能自动认定业务删除。

## 尚需完成的上线检查

### 四份 Excel 的完整初始化

`scripts/prepare-excel-import.py` 只读四份原件，生成带文件 SHA-256、工作表、行号、原始字段、辅助表关联、SAP 候选关联和差异任务的导入包。主台账记录全部保留；其他三份表只附加证据，不重复累计采购数量。缺 PO 行号、多候选匹配、同一 SAP 行对应多个台账记录均进入待核对，不猜测合并。

`scripts/publish-excel-import.mjs <本地导入包>` 默认只验证；加 `--commit` 后向 `supplierCollaboration/imports/{内容标识}` 写入只读初始化批次。同一内容重复执行不重复导入，也不覆盖网页已保存的协作操作。批次以 `payloadJson` 保留空值、原始行和所有来源信息。匿名读取未被拒绝时，上传程序会终止。该暂存导入本身不会自动把公开演示切换成真实订单；还需受保护的数据读取及业务确认流程。

当前已生成的实际导入包在被 Git 忽略的 `outputs/excel-initialization-20260910/`，不进入网站静态资源。图片尚未提取；源文件的图片单元格文本/公式作为证据保留。

- 项目管理访问、实际 RTDB 规则、Auth 设置、服务账户以及单次真实读写测试。
- 供应商隔离、服务端业务校验、真实 PO/SO 映射和数据投影、当前日期口径切换。
- 同步快照/审计保留期、告警接收人和长期主机部署。
- Firebase Emulator 规则测试通过后，再做受保护测试工作区端到端联调。单元测试和构建通过不能代替真实连接验证。

参考：[Firebase REST 认证](https://firebase.google.com/docs/database/rest/auth)、[RTDB 规则](https://firebase.google.com/docs/database/security)、[写入和条件请求](https://firebase.google.com/docs/database/rest/save-data)。
