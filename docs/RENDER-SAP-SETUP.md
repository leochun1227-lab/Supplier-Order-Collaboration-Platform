# Render 网页与 Windows SAP 同步部署

网页和 SAP 同步分别部署。Render 发布 Vue 静态网页，浏览器直接读取和保存 Firebase 协作记录；公司内网电脑运行 Python，只读 SAP，再把完整原始快照写入 Firebase。随后 Node 使用与网页相同的比对逻辑更新总表。每日数据更新不需要 git commit、git push 或重新部署网站。

## 每日 17:00 更新

当前日常入口是 `run.bat`：SAP 只读提取 → Firebase 原始快照 → Firebase 总表补充。关闭网页也能完成。Excel 已有行及人工修改不会被 SAP 刷新覆盖；SAP 缺失于总表的记录追加为蓝色待处理，后续导入与人工处理仍按既定状态规则执行。

SAP 补充记录的订单日期必须严格晚于最新导入 Excel 的最早有效订单日期：同一天、更早或日期不明的 SAP 记录不追加，也不在总表、待办、异常及工作台显示；已存原单元格、公式和人工记录仍保留。Excel 自身的行不受此限制。Excel 没有有效订单日期时，暂不显示或新增 SAP 补充行。下一次 Excel 导入会重新计算日期下限。该规则同时需要更新后的网页代码和同步程序；仅运行数据更新不会发布旧网站的新代码。

SAP 补充还须符合未收货 PO 口径：排除 `70000` 开头 PO、去空格并转大写后 `D14` 开头物料、订单头或行删除标识 `L`、行交货完成标识 `X`。至少有一条 EKET 交货计划满足 `MENGE > 0` 且 `MENGE - COALESCE(WEMNG,0) > 0`。未收货量按符合条件的计划行求和，保留全部 `ETENR`，不会用 PO＋行号覆盖多条计划；PO 原始订购数量不改写。这里的未收货不等于未发运。订单头状态或计划数据不足时不生成 SAP 补充行。

原始 PO 参考快照仍完整保留，以便核对 Excel 中已 OK／取消的行及错料号、错 PO；只有 SAP 自动补充行按上述口径显示。后续完成或删除的补充行会隐藏，人工记录留存，重新开放时可恢复显示。查询仍是原客户端 800、公司 3110、工厂 3111、供应商 3060 范围的五类 SELECT；仅在 PO 投影中补充头删除标识，利用已有计划快照计算资格，不扩大到所有供应商。没有采用参考网站固定的 2026-05-07 分界或覆盖人工取消的规则。

生产／售后分类使用 PO 的 SAP 采购组 `EKGRP`，按 `purchaser = mapping[group] || group` 解析：`Karen A.` 为生产订单，`Nishi A.` 为售后配件，其他为用途待确认。映射来自 `https://partssr-default-rtdb.asia-southeast1.firebasedatabase.app/app_admin/purchasing_group_mapping.json`，后台在每次总表同步前读入并条件保存到本项目 `supplierCollaboration/config/purchasingGroupMapping`。网页读取并轮询此副本；SAP 快照不变时也能应用新的映射。Excel 采购员原值和外购／自制类别保留。映射无法读取时，更新报错且不覆盖已有映射。

日常计划使用**目标电脑上的 Windows 任务计划程序**，任务名为 `Regent Supplier SAP to Firebase`，每天电脑当地时间 17:00 执行（悉尼时间请设置 `AUS Eastern Standard Time`）。当前开发电脑上的临时任务已撤销，Codex 定时任务已停用；目标电脑需按下方步骤安装。无需打开 Codex 或网页；目标电脑需开机、保持唤醒、该 Windows 用户已登录（锁屏可以），并可连接公司内网。错过计划时间后会尽快补跑。

成功结果还会记录到 `supplierCollaboration/sync/workbookLastCheck`。本地分别查看 `outputs/firebase-sync/sync.log`（SAP 提取与快照）和 `outputs/firebase-sync/workbook-last-run.log`（总表保存）。总表写入冲突最多重试三次，不重新抓 SAP；更新入口有跨进程锁，避免两次并发提取。

## 1. 另一台 Windows 电脑：一次性配置

同步电脑需要完整项目、Python、Node 22.13 或以上及项目依赖（首次运行 `npm ci`）。不需要启动网页。只想提取原始快照的旧独立入口 `scripts/run-sap-python.ps1` 仍可单独使用。

把完整项目放到目标电脑的固定目录，例如 `C:\SupplierSync`。不要复制本机的 `secrets`、`outputs`、`node_modules`；目标电脑重新安装依赖并保存自己的加密凭据。打开目标电脑的项目目录终端执行 `npm ci`。脚本会根据项目所在目录设置路径，不依赖本机的用户名或目录；安装任务后若移动项目，需更新任务的执行路径。

1. 安装 **64 位 Python 3.11 或以上**，以及公司的 **64 位 SAP HANA Client（HDBODBC 驱动）**。
2. 确认电脑能连接 SAP 内网 `10.11.2.25:30241`，并能通过 HTTPS 访问 Firebase。
3. 双击 `setup-sap-sync.bat`。它会检查 Node 版本、总表模块依赖、Python 版本及 HDBODBC 驱动，并安装缺少的 pyodbc 依赖。首次输入 SAP 只读账号；后续复用本机加密凭据。误复制其他电脑的凭据时，会提示在目标电脑重新输入。Node 和 Python 路径会保存到本机配置，定时任务无需依赖 Codex 的运行环境。
4. 在此目录打开终端，先执行 `run.bat -DryRun`：读取并验证 SAP，不写 Firebase。成功时输出 `status: dry_run` 和五类表的数量。
5. 再执行 `run.bat`：读取 SAP，上传并回读验证；`published` 表示新快照成功，`unchanged` 表示本次数据与上次一致。失败退出码为 1，成功为 0。
6. 确认 `outputs/firebase-sync/workbook-last-run.log` 显示 `status: complete`，再双击 `install-daily-task.bat` 注册每天 17:00 的任务。打开任务计划程序，右键该任务“运行”；等待结束并确认“上次运行结果”为 `0x0`，日志时间更新。这一步必须在目标电脑验证。

本地配置在 `secrets/sap-sync.config.json`，密码在 `secrets/sap.credential.xml`。密码由 Windows 保护，仅供创建它的 Windows 用户在同一电脑解密。换电脑必须重新运行配置入口。主动更换地址或账号时使用 `setup-sap-sync.bat -Reconfigure`；日常只运行 `run.bat`。不要把这些文件放入 Render 或 GitHub。

日志：`outputs/firebase-sync/sync.log`。最近一次成功提取的本地快照：`outputs/firebase-sync/latest-extraction.json`。日志只记录阶段、结果和数量，不输出密码或原始数据库错误。此轮任何查询失败或 PO 为空，都不发布不完整快照。

默认范围沿用已有核对范围：客户端 800、采购公司 3110、工厂 3111、供应商 3060；销售组织 3090、客户 3060。配置文件中的编码保留前导零，其他查询条件在 `scripts/sap-queries`。网页用途分类与这些 SAP 组织编号是不同概念。

## 2. Windows 任务计划程序每天 17:00

在目标电脑创建一个任务，例如 `Regent Supplier SAP to Firebase`，使用执行过配置入口的同一个 Windows 用户。

- 添加一个“每天”触发器 **17:00**，并确认电脑时区为悉尼（AUS Eastern Standard Time，自动跟随夏令时）。
- 操作 → 启动程序：`C:\Windows\System32\cmd.exe`。
- 参数（假设解压到 `C:\SupplierSync`）：`/d /c ""C:\SupplierSync\run.bat""`。
- 起始于：`C:\SupplierSync`，这个字段不要加引号。
- 设置：任务已运行时“不启动新实例”；错过计划时间后尽快启动；失败后每 5 分钟重试，最多 2 次；运行超过 25 分钟停止。
- 电脑需开机、保持唤醒并接入公司网络。若选择“不管用户是否登录都运行”，使用该 Windows 用户的密码登录方式，不勾选“不要存储密码”。先点击“运行”，确认最近运行结果为 `0x0`。

推荐在目标电脑双击 `install-daily-task.bat`；也可执行 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/register-sap-sync.ps1`，默认每天 17:00。注册前检查 Node 依赖和本机凭据能否解密。操作直接调用隐藏窗口的 PowerShell，执行 `scripts/run-supplier-update.ps1`，与双击 `run.bat` 使用相同更新流程。任务允许使用电池时运行，只在该 Windows 用户已登录时执行。需要无人登录运行时，请在任务计划程序中配置上面的用户登录方式。不要重复启用其他相同更新计划。

**配置入口和 run.bat 都不会自行创建定时任务。** 只有在目标电脑执行注册入口才会创建任务；以后手动更新仍双击 `run.bat`，修改时间或停用则在 Windows 任务计划程序中操作。

## 3. Firebase 中会更新什么

- `supplierCollaboration/sap/runs/{run}`：PO、SO、交货、计划行、采购历史的完整原始快照。
- `supplierCollaboration/sap/current`：指向最近成功发布的快照，包含数量和时间。
- `supplierCollaboration/sync/lastSuccessfulCheck`：最近成功检查时间，包括没有数据变化的检查。
- `supplierCollaboration/sync/runs/{run}`：新快照发布结果。
- `supplierCollaboration/workspaces/excel-20260904/partsWorkbook`：追加 SAP 缺失订单后的完整总表，通过版本条件写入。
- `supplierCollaboration/sync/workbookLastCheck`：总表更新验证结果、快照轮次及 NG／OK／SAP 待处理数量。

只有完整抓取并回读验证成功才切换最新快照；相同数据不重复创建快照；较早运行不能覆盖较新的结果。脚本仅允许经过校验的 SELECT 查询，使用只读 SAP 账号，不提交 SAP 修改，并在结束时回滚、关闭连接。HDBODBC 不支持的只读连接属性不再传入；可选超时属性仅在驱动支持时启用。

**网页已读取 `sap/current` 中的 PO 表，刷新 PO／行、料号、单位及价格参考，并重新计算对应异常。** 每 15 秒检查新指针，关联及顺序编号规则见 [SAP 与总表比对](sap-workbook-comparison.md)。它不会重建现有台账；收货、在途、SO、冲销和分批数量仍需经过核实的映射后接入。平台维护的 ETA、延期、报发、快递号、集装箱号及历史版本不会被本脚本覆盖。

当前 Firebase 沿用用户确认的公开读写测试模式，因此同步端不需要 Firebase 服务账号。以后收紧权限时，必须同时升级同步端和网页的身份认证配置；不要把数据库管理凭证写进网页。

## 4. Render 配置

先将当前最新项目代码提交并推送到 **Render 连接的 GitHub 仓库和分支**。在线预览网站发布成功，不代表该 GitHub 分支已经更新。

Render → New → **Static Site** → 连接上述仓库，填写：

| 项目 | 内容 |
| --- | --- |
| Branch | 保存最新代码的分支，例如 main |
| Root Directory | 留空（package.json 位于仓库根目录） |
| Build Command | `npm ci && npm run build` |
| Publish Directory | `dist` |
| Environment Variable | `NODE_VERSION` = `24` |
| Start Command | Static Site 无需填写 |

不要用项目中遗留的 `npm start` 作为 Render 启动命令，它不是这个 Vue 静态网页的部署入口。目前使用 `#/` 路由，不需要另设 SPA rewrite。

仓库根目录也提供 `render.yaml`，可以选择 Render Blueprint 自动读取同样的配置。它仅声明一个静态网站，不创建 SAP 服务、数据库或付费后台任务。

Firebase 数据库地址已配置在网页代码中。此公开测试模式不需要在 Render 填写 SAP 密码、Firebase 管理密钥或 Python 环境变量。Render 只公开 `dist` 构建产物。

## 5. 上线检查

打开 Render 地址，确认加载 1,253 条当前台账及生产/售后分类。用一条业务允许的测试记录修改备注或 ETA，保存后刷新，确认保存版本和数据仍存在；再从另一台电脑打开同一个网页检查。检查后恢复测试值。

在同步电脑手工运行一次 `run.bat`，确认日志成功且 Firebase `sap/current` 和 `sync/lastSuccessfulCheck` 已更新。两边检查分别验证“网页保存”和“SAP 定时取数”，不能用其中一个成功代替另一个。

2026-09-11 已在当前 Windows 用户下验证加密凭据复用及 `run.bat -DryRun` 真实 SAP 抓取成功：PO 8,031、SO 7,868、交货 5,841、计划行 8,031、采购历史 10,161。本次测试不写 Firebase；其他电脑仍需各自配置 Windows 加密凭据。

参考：[Render Static Sites](https://render.com/docs/static-sites)、[Node 版本配置](https://render.com/docs/node-version)、[Blueprint 配置](https://render.com/docs/blueprint-spec)。
