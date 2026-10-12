# 本项目已确认的 SAP 同步规则

以下是用户确认的长期口径。后续修改、维护或迁移时沿用；除非用户明确变更口径，不得退回“Excel 没有的全部 SAP PO 都追加”的逻辑。详细部署说明见 `docs/RENDER-SAP-SETUP.md`，业务联动见 `docs/sap-workbook-comparison.md`。

## 数据范围与显示

- SAP 只读，沿用已配置范围：客户端 800、公司 3110、工厂 3111、供应商 0000003060。保留 SELECT 校验；不得向 SAP 写回或扩大查询范围。
- 最新中国 Excel 是基准。原行、公式、NG／OK／澳洲取消订单、备注和人工处理不被 SAP 更新覆盖。
- SAP 自动补充行必须同时满足：订单日期严格晚于最新 Excel 的最早有效订单日期；排除 `70000` 开头 PO；排除去空格、转大写后 `D14` 开头物料；头和行删除标识不是 `L`；行交货完成标识不是 `X`；至少一条 EKET 计划满足订购数量大于 0 且订购数量减已收货数量大于 0。
- 同日、更早或日期无效的 SAP 补充不显示、不新增。Excel 没有有效日期时也不补充；每次导入重新计算下限。不要使用固定 2026-05-07 日期，也不要只看导入时间。
- 未收货数量按符合条件的交货计划汇总；保留 ETENR，不允许多个计划互相覆盖。不将未收货等同于未发运，不覆盖原 PO 订购数量。
- 完整 SAP 参考快照仍保留供 Excel 已完成／取消行比对。上述过滤只针对 SAP 补充；历史补充隐藏时保留其单元格、公式和人工记录，重新符合条件后可恢复显示。
- SAP 新增默认蓝色待处理，不默认 NG；人工处理或后续 Excel 收录后按 NG 红色／OK 深绿等状态显示。NEW 在序号左上角，按前后快照新增标记。
- 错物料号和错 SAP PO 单独进入异常，即使 Excel 已 OK；待办与异常分开。不得用隐藏完成订单来取消 Excel 原行的差异检查。
- 生产／售后用途按 SAP `EKGRP` 采购组查 `purchasing_group_mapping`：`purchaser = mapping[group] || group`，严格匹配 `Karen A.` 为生产订单、`Nishi A.` 为售后配件，其他或未关联 SAP 的行保持用途待确认。不能用 Excel 采购员文字、料号或“外购／自制”猜用途，也不覆盖 Excel 原采购员单元格。当前参考映射是 E01 → Karen A.、E03 → Nishi A.，运行时读映射表，不写死采购组对应关系。

## 执行与交付

- `run.bat` 和 Windows 任务计划程序统一调用 `scripts/run-supplier-update.ps1`：只读 SAP → Firebase 原始快照 → Firebase 总表更新。数据写到既有 `supplierCollaboration`，日常刷新不执行 Git push 或重新部署网站。
- 定时执行安排在用户指定的另一台 Windows 电脑，每天悉尼时间 17:00。使用 Windows Task Scheduler，不使用 Codex 自动任务；不要在当前开发电脑注册任务。
- 迁移目标电脑时提供完整最新程序，重新配置本机运行环境和加密凭据。未在目标电脑验证时，不声称已在目标电脑成功运行。线上网页使用新显示逻辑仍需单独发布新版代码。
- 新增口径：`scripts/sync_sap.py` 的 `open_po_facts`；日期和可见范围：`src/parts-workbook-scope.mjs`；补充合并：`src/sap-workbook-sync.mjs`。手动、后台及页面更新必须保持一致。
- 采购组映射：`scripts/sync-purchasing-groups.mjs` 只读参考项目 `partssr` 的 `app_admin/purchasing_group_mapping`，复制到本项目 `supplierCollaboration/config/purchasingGroupMapping`。每日／手动总表同步先更新映射；网页轮询本项目副本，即使 SAP 快照未变也应用映射变化。映射读取失败应报错并保留上次结果，不能用姓名猜测替代。

## 验证

修改以上逻辑时，运行适用的回归测试：

```powershell
node --test --test-isolation=none tests/*.test.mjs
python -m unittest discover -s tests -p test_sap_sync.py
npm run build
```

重点保护严格日期边界、无效日期、D14／70000 排除、删除及完成标识、多计划汇总、Excel 完成行异常比对，以及隐藏／恢复过程中人工记录不丢失。文档修改无需重新抓取 SAP。
