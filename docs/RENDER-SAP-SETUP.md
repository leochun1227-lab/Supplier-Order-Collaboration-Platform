# Render 网页与 Windows SAP 同步部署

网页和 SAP 同步分别部署。Render 发布 Vue 静态网页，浏览器直接读取和保存 Firebase 协作记录；公司内网电脑运行 Python，只读 SAP，再把完整原始快照写入 Firebase。

## 1. 另一台 Windows 电脑：一次性配置

使用同步压缩包或复制项目中的 `run.bat`、`setup-sap-sync.bat`、`scripts` 和本说明，保持目录结构。同步电脑不需要安装 Node 或启动网页。

1. 安装 **64 位 Python 3.11 或以上**，以及公司的 **64 位 SAP HANA Client（HDBODBC 驱动）**。
2. 确认电脑能连接 SAP 内网 `10.11.2.25:30241`，并能通过 HTTPS 访问 Firebase。
3. 双击 `setup-sap-sync.bat`。它会检查 Python 的 pyodbc 依赖，缺少时才安装。已保存的地址和加密凭据会自动复用，不再提示输入；只有首次缺少凭据时才要求填写一次。
4. 在此目录打开终端，先执行 `run.bat -DryRun`：读取并验证 SAP，不写 Firebase。成功时输出 `status: dry_run` 和五类表的数量。
5. 再执行 `run.bat`：读取 SAP，上传并回读验证；`published` 表示新快照成功，`unchanged` 表示本次数据与上次一致。失败退出码为 1，成功为 0。

本地配置在 `secrets/sap-sync.config.json`，密码在 `secrets/sap.credential.xml`。密码由 Windows 保护，仅供创建它的 Windows 用户在同一电脑解密。换电脑必须重新运行配置入口。主动更换地址或账号时使用 `setup-sap-sync.bat -Reconfigure`；日常只运行 `run.bat`。不要把这些文件放入 Render 或 GitHub。

日志：`outputs/firebase-sync/sync.log`。最近一次成功提取的本地快照：`outputs/firebase-sync/latest-extraction.json`。日志只记录阶段、结果和数量，不输出密码或原始数据库错误。此轮任何查询失败或 PO 为空，都不发布不完整快照。

默认范围沿用已有核对范围：客户端 800、采购公司 3110、工厂 3111、供应商 3060；销售组织 3090、客户 3060。配置文件中的编码保留前导零，其他查询条件在 `scripts/sap-queries`。网页用途分类与这些 SAP 组织编号是不同概念。

## 2. Windows 任务计划程序：每天两次

在目标电脑创建一个任务，例如 `Regent Supplier SAP to Firebase`，使用执行过配置入口的同一个 Windows 用户。

- 添加两个“每天”触发器，例如 **08:00** 和 **16:00**，按该电脑当地时区执行。
- 操作 → 启动程序：`C:\Windows\System32\cmd.exe`。
- 参数（假设解压到 `C:\SupplierSync`）：`/d /c ""C:\SupplierSync\run.bat""`。
- 起始于：`C:\SupplierSync`，这个字段不要加引号。
- 设置：任务已运行时“不启动新实例”；错过计划时间后尽快启动；失败后每 5 分钟重试，最多 2 次；运行超过 25 分钟停止。
- 电脑需开机、保持唤醒并接入公司网络。若选择“不管用户是否登录都运行”，使用该 Windows 用户的密码登录方式，不勾选“不要存储密码”。先点击“运行”，确认最近运行结果为 `0x0`。

也提供可选的注册脚本：在 PowerShell 中执行 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/register-sap-sync.ps1`，默认每天 08:00 / 16:00。这个快捷方式只在该 Windows 用户已登录时运行。需要无人登录运行时，请在任务计划程序中配置上面的用户登录方式。

**配置入口和 run.bat 都不会自行创建定时任务。** 本次未在开发电脑注册任务。

## 3. Firebase 中会更新什么

- `supplierCollaboration/sap/runs/{run}`：PO、SO、交货、计划行、采购历史的完整原始快照。
- `supplierCollaboration/sap/current`：指向最近成功发布的快照，包含数量和时间。
- `supplierCollaboration/sync/lastSuccessfulCheck`：最近成功检查时间，包括没有数据变化的检查。
- `supplierCollaboration/sync/runs/{run}`：新快照发布结果。

只有完整抓取并回读验证成功才切换最新快照；相同数据不重复创建快照；较早运行不能覆盖较新的结果。脚本仅允许经过校验的 SELECT 查询，使用只读 SAP 账号，不提交 SAP 修改，并在结束时回滚、关闭连接。HDBODBC 不支持的只读连接属性不再传入；可选超时属性仅在驱动支持时启用。

**此同步脚本更新的是 SAP 原始数据区，不会自动重建现有 1,253 条网页台账，也不会自动将所有收货、在途和异常判定更新到订单。** 后续需要接入已经核实的 PO/SO、单位、冲销和分批映射。平台维护的 ETA、延期、报发、快递号、集装箱号及历史版本不会被本脚本覆盖。

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
