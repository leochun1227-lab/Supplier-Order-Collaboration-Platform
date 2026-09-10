// Interface labels use their existing Chinese text as stable translation keys.
export const messages = Object.fromEntries(`
用途待确认|Purpose unconfirmed
已取消|Cancelled
已报发|Reported dispatched
快递|Courier
运输与履约|Transport & fulfillment
已收货值|Received value
已确认 / 未完成行|Confirmed / open lines
运输 / 订单|Transport / order
货值 / 运费|Goods value / freight
运费|Freight
统计口径|Metric definitions
点击指标可查看订单明细|Select a metric to view order details
按 ETA 排序，展示最近 3 批；完整记录见全部物流。|Next 3 batches by ETA. See All shipments for the full list.
履约分析|Fulfillment analysis
回顾历史表现，定位交付问题与改善方向。|Review historical performance and identify delivery improvements.
历史履约分析|Historical fulfillment analysis
当前演示仅包含订单快照，尚不足以计算历史绩效。接入完整记录后，将在这里按月、季度和供应商进行对比。|This demo contains order snapshots, which are not enough to calculate historical performance. Complete records will enable monthly, quarterly and supplier comparisons here.
待接入历史数据|Historical data needed
分析方向|Analysis area
关注的问题|Questions to investigate
所需历史记录|Required historical records
供应商响应效率|Supplier response efficiency
订单多久被确认，哪些供应商响应较慢|How long orders take to confirm and which suppliers respond slowly
订单通知时间、首次响应与确认时间|Order notification, first response and confirmation timestamps
承诺兑现与交期变化|Commitment reliability and date changes
首次承诺是否兑现，交期为何反复调整|Whether first commitments were met and why dates changed repeatedly
承诺版本、变更原因、实际到仓与收货记录|Commitment versions, change reasons, actual arrivals and receipts
运输表现与延期原因|Transport performance and delay causes
运输耗时与 ETA 偏差主要集中在哪些环节|Where transit time and ETA deviations are concentrated
历史运输节点、ETA 版本及异常原因|Historical shipment milestones, ETA versions and exception reasons
当前订单、在途数量和货值请查看总览；数据核对由数据中心负责。|See Overview for current orders, in-transit quantities and values. Reconciliation belongs in Data center.
待核对的数据问题|Data issues to reconcile
采购与供应商协作|Procurement & suppliers
主要导航|Main navigation
SAP + 协作平台|SAP + collaboration
演示环境 · 业务日期 09/08|Demo · business date 08 Sep
预览说明|About this preview
展开导航|Open navigation
供应商协作|Supplier collaboration
功能预览 · 模拟数据|Preview · sample data
切换演示角色|Switch demo role
Regent · 内部采购|Regent · Buyer
Longtree · 供应商|Longtree · Supplier
重置演示|Reset demo
导出当前视图|Export current view
来自总览：|From overview:
行|lines
清除看板范围|Clear overview filter
返回总览|Back to overview
查看待办|View tasks
搜索 PO、物料编码或名称…|Search PO, part number or description…
搜索订单|Search orders
清空搜索|Clear search
订单类型|Order type
全部类型|All types
生产订单|Production
售后配件|Spare parts
运输方式|Transport mode
全部运输|All transport
海运|Sea freight
空运|Air freight
采购员|Buyer
全部采购员|All buyers
个订单行|order lines
订单 / 物料|Order / material
供应商 / 类型|Supplier / type
订购 / 未交|Ordered / outstanding
需求 / 承诺到仓|Required / promised arrival
履约进展|Fulfillment progress
协作状态|Collaboration status
未交|outstanding
晚于需求|Later than required by
天|days
待供应商承诺|Awaiting supplier commitment
查看订单详情|View order details
没有匹配的订单|No matching orders
试试其他关键词或筛选条件。|Try another keyword or filter.
清除筛选|Clear filters
按 PO 订单行展示 · 数量单位：件|PO line items · quantities in units
全部|Total
SAP 订单数据只读；确认、承诺与沟通在平台维护。|SAP orders are read-only. Confirmations, commitments and discussions are managed here.
本次演示操作在刷新后重置。|Demo changes reset on refresh.
项变更待审核|changes awaiting review
行存在交期风险|lines with delivery risk
日期统一表示|All dates refer to
预计到仓|Expected warehouse arrival
交付承诺|Delivery commitments
需求 → 当前承诺 → 变更申请|Required → current commitment → change request
SAP 需求到仓|Required arrival · SAP
当前承诺到仓|Current promised arrival
申请|Requested
延后|Delayed by
起运地|Origin
出发|departure
目的地|Destination
当前位置|Current location
承运信息|Carrier
发运数量|Shipped quantity
件|units
模拟更新|Demo update
更新物流|Update shipment
关联 PO|Linked PO
平台维护运输节点及运输预计到仓时间。正式发货和收货数量由 SAP 同步；物流到港不等于 SAP 已收货。|The platform tracks shipment milestones and expected warehouse arrival. Official shipped and received quantities come from SAP; arrival at port does not mean receipt in SAP.
项待跟进|items to follow up
项已解决|items resolved
每项异常都有责任人与处理记录|Every exception has an owner and an activity record
负责人|Owner
跟进截止|Follow-up due
处理记录：|Resolution notes:
补充说明|Add a note
当前范围：|Scope:
· 全部|· Total
个订单行 · 统计随演示操作更新|order lines · updates with demo activity
订单履约分布|Order fulfillment distribution
按订单行统计|By order line
供应商确认|Supplier confirmation
至少已确认部分数量的订单行占比|Share of lines with at least a partial quantity commitment
已确认|Confirmed
待确认|Awaiting confirmation
查看待确认订单|View unconfirmed orders
数量核对|Quantity reconciliation
订购总量|Total ordered
已收货 · SAP|Received · SAP
在途 · 已发未收|In transit · shipped, not received
尚未发运|Not yet shipped
本演示物料统一为“件”；正式系统需按计量单位分组。准时交付率需真实收货历史后再计算。|All demo materials use units. Production reporting must group by unit of measure. On-time delivery requires actual receipt history.
正式订单 / 发货 / 收货|Official orders / shipments / receipts
协作平台|Collaboration platform
确认 / 交期 / 沟通 / 异常|Confirmations / dates / discussions / exceptions
可信报表|Validated reports
统一口径 / 数据可追溯|Consistent definitions / traceable data
数据运行状态|Data operations
模拟状态|Demo status
SAP 订单同步|SAP order sync
计划持续同步正式业务记录|Continuous synchronization of official records is planned
个演示订单行|sample order lines
示例已载入|Sample loaded
待处理的数据问题|Open data issues
在平台分派、核对和记录修正结果|Assign, reconcile and record corrections in the platform
项|items
查看问题|View issues
平台协作记录|Collaboration activity
供应商确认、交期变更和沟通|Supplier confirmations, date changes and discussions
条事件|events
本次会话内更新|Updated in this session
初始迁移已完成|Initial migration complete
演示场景|Demo scenario
历史 Excel 仅用于初次导入和核对。切换后，日常业务由 SAP 与平台维护。|Historical Excel files are used only for initial import and reconciliation. After cutover, SAP and the platform maintain daily operations.
01 导入历史数据|01 Import historical data
02 核对与业务确认|02 Reconcile and verify
03 切换平台协作 ✓|03 Move to platform collaboration ✓
尚未接入实际文件或 SAP；这里展示未来正式运行后的界面。|No real files or SAP connection yet. This illustrates the future operating interface.
关闭提示|Dismiss notification
示例单价 / AUD|Sample unit price / AUD
/ 件|/ unit
未交货值 / AUD|Outstanding value / AUD
模拟采购价格 · 不含税费与运费|Sample purchase prices · excluding tax and freight
SAP 数据 · 只读|SAP data · read-only
物料描述|Material description
采购员 / 工厂|Buyer / plant
订购数量|Ordered quantity
已收货 / 未交|Received / outstanding
需求到仓日期|Required warehouse arrival
供应商反馈|Supplier update
响应订单|Respond to order
查看交付承诺|View commitments
需求到仓 · SAP|Required arrival · SAP
当前承诺 · 平台|Current commitment · platform
变更待审核|Change awaiting review
申请到仓|Requested arrival
提出 · 当前承诺在审核前不变|submitted · current commitment stays effective until reviewed
退回|Return
接受变更|Accept change
分批交付安排|Split delivery schedule
已承诺|Committed
供应商尚未提交交付承诺|No supplier commitment submitted yet
交付数量|Delivery quantity
交付批次表示数量与到仓承诺；实际发运记录单独跟踪。|Delivery batches describe quantity and arrival commitments. Actual shipments are tracked separately.
响应订单 / 分批确认|Respond / confirm split deliveries
提交交期变更|Request date change
该订单已有发运，运输时间请在发运记录中跟进。|This order has shipped quantities. Track transport dates in shipment records.
暂无发运记录|No shipments yet
供应商反馈生产进展；正式发货记录由 SAP 同步。|Suppliers report production progress. Official shipment records are synchronized from SAP.
集装箱 / 运单号|Container / waybill number
运输预计到仓|Shipment warehouse ETA
更新物流进展|Update shipment progress
订单沟通|Order discussion
补充交期原因、跟进进展或供应商说明…|Add delivery reasons, follow-up progress or supplier notes…
发送留言|Post comment
操作历史|Activity history
件 · 需求到仓|units · required arrival
添加批次|Add batch
第|Batch
批数量|quantity
预计到仓日期|Expected warehouse arrival date
删除此批次|Remove this batch
本次承诺|This commitment
请输入说明，相关人员可在订单历史中追溯。|Add a note for the order history.
提交后等待内部采购审核，当前交付承诺保持不变。|Internal procurement will review the request. The current commitment remains effective.
处理状态|Resolution status
待处理|Open
处理中|In progress
已解决|Resolved
处理记录 / 关闭依据|Action notes / resolution evidence
记录已采取的动作、确认结果和下一步安排。|Record actions, confirmed results and next steps.
关闭待办不会修改 SAP 数据，也不会消除仍存在的交期风险。|Closing a task does not change SAP data or remove an existing delivery risk.
运输节点|Shipment milestone
在途|In transit
已到港|Arrived at port
例如：已抵达墨尔本港，待清关|For example: at Melbourne port, awaiting customs clearance
此操作不更新 SAP 发货、收货数量或供应商原承诺。|This does not change SAP shipment or receipt quantities, or the supplier's original commitment.
退回原因|Reason for return
说明需要供应商重新安排的原因。|Explain why the supplier needs to revise the schedule.
清除本次演示中的确认、变更和留言，恢复最初的模拟订单。不会涉及任何真实业务数据。|Clear demo confirmations, changes and comments and restore the original sample orders. No real business data is affected.
Frappe UI · 交互原型|Frappe UI · Interactive prototype
这是一份使用真实 Frappe UI 组件的前端功能演示，尚未运行 Frappe 后端、接入 SAP 或实施真实账号权限。|This frontend demo uses real Frappe UI components. It has no Frappe backend, SAP integration or actual account access control yet.
切换至|Switch to
，打开待确认订单，提交数量和交付批次。|, open an unconfirmed order and submit quantities and delivery batches.
对已确认、未发运的订单提交交期变更。|Request a date change for a confirmed, unshipped order.
切回|Switch back to
，在“交期与承诺”接受或退回变更。|, then accept or return the change in Delivery commitments.
在“异常与待办”记录处理结果，并查看更新后的报表。|Record the outcome in Exceptions & tasks and view the updated reports.
所有数据为虚构样本；操作仅在本次页面会话中有效，刷新即可恢复。|All data is fictional. Changes last only for this session and reset on refresh.
查看 Frappe UI 开源项目 ↗|View the Frappe UI open-source project ↗
当前订单快照|Current order snapshot
· 演示业务日|· demo business date
总览供应商筛选|Filter overview by supplier
全部供应商|All suppliers
总览订单分类筛选|Filter overview by order category
全部分类|All categories
AUD · 件|AUD · units
未完成订单|Open orders
张 PO|POs
行订单 ·|order lines ·
件未交|units outstanding
未交货值|Outstanding value
在途数量|In-transit quantity
个关联批次 · 已发货，待收货|linked batches · shipped, awaiting receipt
在途货值|In-transit value
包含待确认、生产中与待发运|Awaiting confirmation, in production or ready to ship
未发货值|Unshipped value
交期风险|Delivery risk
当前承诺到仓晚于需求日期|Current promised arrival is later than required
另有|Also
尚待确认|awaiting confirmation
供应链履约总览|Supply chain fulfillment
中国供应端 → 澳大利亚收货端|Suppliers in China → receiving in Australia
件订购总量|units ordered
供应商|Supplier
发货|Dispatch
国际运输|International transit
已发未收|Shipped, not received
到仓收货|Warehouse receipt
Regent 仓库|Regent warehouse
SAP 已收货|Received in SAP
未发|Unshipped
已收|Received
未来 7 天预计到仓|Expected in the next 7 days
批 /|batches /
跟踪物流|Track shipments
在途运输分布|In-transit transport mix
仅统计已发未收货物|Shipped goods awaiting receipt only
运输图表统计方式|Transport chart measure
数量|Quantity
货值|Goods value
个关联运输批次|linked shipment batches
在途批次运费|Freight for in-transit batches
示例费用 · 与货值分开统计|Sample costs · separate from goods value
订单分类|Order categories
未完成订单 · 货值按未交数量计算|Open orders · values based on outstanding quantities
行 ·|lines ·
其中在途|In transit:
点击分类查看订单行、物料与交付安排。|Select a category to view order lines, materials and delivery schedules.
未完成订单账龄|Open order ageing
从下单日至演示业务日 · 账龄不等于延期|Order date to demo date · age does not imply delay
账龄|Age
生产|Production
售后|Spare parts
合计 / 行|Total / lines
合计|Total
在途到仓计划|Inbound shipment schedule
按运输批次 ETA 排序 · 可展开查看关联订单|Sorted by shipment ETA · open the linked order for details
全部物流|All shipments
运输 / 运单|Transport / waybill
关联订单 / 物料|Linked order / material
当前位置 → 目的地|Current location → destination
货值 / AUD|Goods value / AUD
运费 / AUD|Freight / AUD
当前筛选范围没有在途运输批次。|No in-transit shipments match these filters.
供应商协作概况|Supplier collaboration
当前未完成订单；确认包含部分数量承诺|Current open orders; confirmation includes partial commitments
行 · 未交货值|lines · outstanding value
确认及时率与准时交付率，待接入完整历史记录后计算。|Confirmation timeliness and on-time delivery require complete historical records.
需要关注|Needs attention
从看板直接进入协作处理|Go directly from the overview to action
待供应商确认|Awaiting supplier confirmation
承诺晚于需求|Commitment later than required
当前筛选未关闭异常|Open exceptions in this scope
异常入口展示当前角色的全部待办。|The exceptions page shows all tasks for the current role.
模拟数据 · 所有金额为 AUD 示例采购货值，按数量 × 单价计算，不含运费及税费；全部物料暂统一为“件”。本页随当前角色、筛选和演示操作更新，未接入 SAP 或实际价格。|Sample data · Values are fictional AUD purchase values, calculated as quantity × unit price, excluding freight and tax. All quantities use units. This page responds to the current role, filters and demo activity. No SAP connection or actual prices are used.
总览看板|Overview
订单工作台|Order workbench
交期与承诺|Delivery commitments
发运与物流|Shipments & logistics
异常与待办|Exceptions & tasks
履约报表|Fulfillment reports
数据中心|Data center
从订单确认到交付，所有协作在这里发生。|Manage collaboration from order confirmation to delivery.
关注交付变化，保留每一次承诺。|Track delivery changes and retain every commitment.
按批次跟进运输，连接订单与到货。|Track shipment batches from orders to arrival.
把风险交给明确的责任人，持续跟进结果。|Assign ownership and follow exceptions through to resolution.
基于当前演示订单，实时汇总协作进展。|Collaboration progress based on current demo orders.
SAP 持续同步，平台维护协作数据。|SAP syncs official records; the platform manages collaboration.
掌握订单、在途货物与交付风险。|Monitor orders, goods in transit and delivery risks.
等待数量与交期承诺|Awaiting quantity and delivery commitments
预计到仓晚于需求日期|Expected arrival later than required
已收货|Received
部分发运|Partially shipped
供应商订单响应|Supplier order response
处理异常|Resolve exception
重置演示数据|Reset demo data
如何体验这个预览|How to use this preview
退回交期变更|Return date change
协作操作|Collaboration action
生产中|In production
待发运|Ready to ship
Longtree 专属视图|Longtree only
Regent · 采购|Regent · Buyer
请切换到 Longtree 供应商视角进行响应。|Switch to the Longtree supplier role to respond.
该订单已确认，请使用交期变更。|This order is confirmed. Use a date change request.
请填写原因，便于采购跟进。|Enter a reason so procurement can follow up.
无法供货|Unable to supply
请求调整|Adjustment requested
供应商响应|Supplier response
高|High
部分确认时，请说明剩余数量的处理计划。|For a partial confirmation, explain the plan for the remaining quantity.
部分确认|Partially confirmed
部分|Partially
中|Medium
响应已记录，采购视角已同步更新。|Response recorded. The buyer view has been updated.
仅支持对已确认且未发运订单提交变更。|Changes are supported only for confirmed, unshipped orders.
已有一项交期变更等待采购审核。|A date change is already awaiting buyer review.
请填写交期变更原因。|Enter a reason for the date change.
Regent 代录|Entered by Regent
变更已提交；采购接受前，原承诺保持有效。|Change submitted. The original commitment remains effective until accepted.
已接受变更，交期视图和报表已更新。|Change accepted. Delivery views and reports are updated.
请填写退回原因。|Enter a reason for returning the request.
已退回变更，保留原交付承诺。|Change returned. The original commitment is retained.
添加了订单沟通记录|Added an order comment
留言已加入订单记录。|Comment added to the order.
请填写处理记录或关闭依据。|Enter action notes or resolution evidence.
处理记录已更新。订单事实与交期风险按实际数据计算。|Action notes updated. Order facts and delivery risks still use the actual data.
请补充当前位置与预计到仓日期。|Enter the current location and warehouse ETA.
预计到仓日期不能早于演示业务日期。|Warehouse ETA cannot be earlier than the demo business date.
物流进展已更新；正式发货与收货记录仍以 SAP 为准。|Shipment progress updated. SAP remains authoritative for dispatch and receipt records.
订单行|Order line
物料编码|Part number
已收数量|Received quantity
未交数量|Outstanding quantity
需求日期|Required date
承诺到仓|Promised arrival
状态|Status
Regent-演示订单.csv|Regent-demo-orders.csv
已导出当前筛选范围的演示订单。|Demo orders in the current filter have been exported.
演示已恢复初始状态。|Demo restored to its initial state.
已切换：Longtree 供应商，只展示本供应商的模拟订单。|Switched to Longtree supplier. Only its sample orders are shown.
已切换：Regent 内部采购，可审核变更和处理异常。|Switched to Regent buyer. You can review changes and resolve exceptions.
供应商提出了新的交付安排，原承诺在审核前继续有效。|The supplier proposed a new schedule. The original commitment remains effective pending review.
优先关注交期延误、物料编码与待订舱订单。|Prioritize delivery delays, part-number issues and orders awaiting booking.
全部订单|All orders
已完成|Completed
交期正常|On schedule
生产完成|Production complete
尚未开始|Not started
按计划|On schedule
审核变更|Review change
查看安排|View schedule
待出发|Awaiting departure
已离港|Departed
优先级|priority
重新跟进|Reopen
数据问题|Data issue
订单详情|Order details
订单概览|Order overview
发运记录|Shipment records
沟通与历史|Discussion & history
生产已完成|Production completed
正在生产|In production
尚未开始生产|Production not started
供应商响应可在右上角切换到供应商视角体验。|Switch to the supplier role at the top right to try an order response.
请确认数量和预计到仓日期，或说明无法供货的原因。|Confirm quantities and warehouse arrival dates, or explain why supply is not possible.
以 Regent 采购身份留言|Commenting as Regent buyer
以 Longtree 供应商身份留言|Commenting as Longtree supplier
确认供货|Confirm supply
新的交付安排|New delivery schedule
交付安排|Delivery schedule
变更原因（必填）|Reason for change (required)
说明 / 剩余数量处理计划|Notes / plan for remaining quantity
原因（必填）|Reason (required)
开始体验|Start exploring
取消|Cancel
确认重置|Confirm reset
提交变更申请|Submit change request
提交响应|Submit response
保存记录|Save record
在途订单|In-transit orders
尚未发运订单|Unshipped orders
交期风险订单|Orders with delivery risk
有收货记录的订单|Orders with receipts
在途 / 件|In transit / units
在途货值 / AUD|In-transit value / AUD
按首次 ETA|On original ETA
无已知交期风险|No known delivery risk
请添加至少一个交付批次。|Add at least one delivery batch.
每批数量必须是大于 0 的整数。|Each batch quantity must be a whole number greater than zero.
请填写有效的预计到仓日期。|Enter a valid expected warehouse arrival date.
新的交付承诺不能早于演示业务日期 2026-09-08。|New commitments cannot be earlier than the demo business date, 2026-09-08.
承诺数量不能超过订单未交数量。|Committed quantity cannot exceed the outstanding order quantity.
纱门帘 · 中门|Mosquito net curtain · middle door
纱门帘 · 后门|Mosquito net curtain · rear door
底盘总成 · 2400|Chassis assembly · 2400
左侧推拉窗|Sliding window · left
12V 室内照明组件|Interior LED light kit · 12V
隔膜水泵 · 45 PSI|Diaphragm water pump · 45 PSI
橡木色吊柜模块|Overhead cabinet · oak finish
车轴组件 · 2500 kg|Axle assembly · 2500 kg
不锈钢门铰链|Stainless steel hinge
锂电池安装支架|Battery mounting bracket
门框密封条|Door frame sealing strip
Longtree · 陈经理|Longtree · Manager Chen
表面处理工序排期延后，预计 10 月 2 日到仓，请采购确认能否接受。|Surface treatment has been delayed. Expected warehouse arrival is 2 October. Please confirm whether this is acceptable.
SAP 同步|SAP sync
历史订单行已同步至协作平台|Historical order line synchronized to the platform
底盘交付晚于需求 8 天|Chassis delivery is 8 days later than required
供应商预计到仓 10/02，SAP 需求日期 09/24。需确认生产安排或替代交付方案。|Supplier arrival is 2 October; SAP requires 24 September. Confirm the production plan or an alternative delivery arrangement.
物料编码待核对|Part number needs reconciliation
SAP 编码 P135-01999 与已迁移的供应商编码 P135-01998 不一致。需采购确认正确编码，并跟踪 SAP 修正。|SAP code P135-01999 differs from migrated supplier code P135-01998. Procurement must verify the correct code and track the SAP correction.
发运跟进|Shipment follow-up
吊柜已备货，待确认订舱|Cabinets ready; booking confirmation needed
生产进度已完成。请供应商补充订舱信息和预计离港日期。|Production is complete. The supplier needs to provide booking details and the expected departure date.
已联系供应商确认本周船期。|Contacted the supplier to confirm this week's sailing.
宁波|Ningbo
墨尔本仓|Melbourne warehouse
新加坡中转|Transshipment in Singapore
上海|Shanghai
悉尼仓|Sydney warehouse
国际运输中|In international transit
待匹配运输|Transport not matched
> 90 天|> 90 days
语言切换|Language
`.trim().split('\n').map(line=>line.split('|')))

// Whole-message templates preserve parameters; no global word substitutions.
export const patterns = [
  [/^(\d+) 个订单行$/, '$1 order lines'],
  [/^(\d+) 个发运批次$/, '$1 shipment batches'],
  [/^(\d+) 项交期变更等待审核$/, '$1 date changes awaiting review'],
  [/^(\d+) 项协作事项需要跟进$/, '$1 collaboration items need attention'],
  [/^生产 (.+)%$/, 'Production $1%'],
  [/^(\d+)–(\d+) 天$/, '$1–$2 days'],
  [/^较首次 ETA 延后 (\d+) 天$/, '$1 days later than original ETA'],
  [/^(\d+) 行交期风险$/, '$1 lines with delivery risk'],
  [/^查看订单 (.+)$/, 'View order $1'],
  [/^数量构成：未发 (.+) 件，在途 (.+) 件，已收 (.+) 件$/, 'Quantity mix: $1 unshipped, $2 in transit, $3 received'],
  [/^已确认交付安排，预计到仓 (.+)$/, 'Delivery confirmed; expected warehouse arrival $1'],
  [/^采购接受交期变更，新预计到仓日期 (.+)$/, 'Buyer accepted date change; new warehouse arrival $1'],
  [/^剩余 (.+) 件待承诺$/, '$1 units still need a commitment'],
]

export function translate(value, language='zh') {
  if(value&&typeof value==='object'&&'zh' in value&&'en' in value)return language==='en'?value.en:value.zh
  if(language!=='en'||typeof value!=='string')return value
  const key=value.trim()
  let result=messages[key]
  if(result===undefined)for(const [regex, replacement] of patterns){if(regex.test(key)){result=key.replace(regex,replacement);break}}
  if(result===undefined){
    if(key.endsWith(' · 未完成'))result=translate(key.slice(0,-6),'en')+' · Open orders'
    else if(key.startsWith('账龄 '))result='Age: '+translate(key.slice(3),'en')
    else if(key.endsWith('在途订单'))result=translate(key.slice(0,-4),'en')+' in-transit orders'
    else if(key.endsWith('优先级'))result=translate(key.slice(0,-3),'en')+' priority'
    else if(key.endsWith(' / 供应商'))result=key.slice(0,-6)+' / Supplier'
  }
  return result===undefined?value:value.replace(key,()=>result)
}
