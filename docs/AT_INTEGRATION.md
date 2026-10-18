# AT 公交数据与票价接入方案

核查日期：2026 年 10 月 9 日。

## 当前结论

可以接入 AT 的公交站点、线路、班次和实时到站信息，但公开 GTFS 并不提供完整的自动票价计算数据。项目现有 `ATFareProvider` 使用官方 2026 票价表，需要用户确认实际跨区数；它不是实时 AT 报价接口。

目前最可靠的具体行程核价入口是 [AT Journey Planner](https://at.govt.nz/bus-train-ferry/journey-planner)。AT 官方说明可在行程详情中查看价格，并选择成人或其他优惠资格。页面中的“到 AT 官方核对公交票价”打开此工具，不会伪称已经取得 AT 报价。

## 应接入哪些数据

| 数据            | 官方入口                                                                                                                                        | 用途                                 | 是否能直接给出票价                     |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------- |
| GTFS Static     | [开发文档](https://dev-portal.at.govt.nz/GTFS-API) / [下载说明](https://at.govt.nz/about-us/at-data-sources/general-transit-feed-specification) | 站点、线路、班次、停站时间、服务日历 | 当前公开文件不能                       |
| Realtime Compat | [实时文档](https://dev-portal.at.govt.nz/realtime-api)                                                                                          | 车辆位置、到站更新、服务警报         | 不能                                   |
| 官方票价规则    | [公交与火车票价](https://at.govt.nz/bus-train-ferry/fares-and-discounts/bus-and-train-fares)                                                    | 已确认跨区数、支付方式及资格后的计费 | 可以按已确认条件计算                   |
| 具体行程报价    | [AT Journey Planner](https://at.govt.nz/bus-train-ferry/journey-planner)                                                                        | 核对特定路线与乘客类型的价格         | 官方网页可以显示；尚未证实公开报价 API |

对官方下载的 GTFS ZIP 做了临时检查，未把数据包提交进项目：当前 `feed_info` 覆盖 2026-09-30 至 2027-01-24；`fare_attributes.txt`、`fare_rules.txt` 只有表头，没有数据行；6,990 条站点记录的 `zone_id` 均为空；没有 GTFS Fares v2 文件。这是当日数据包的检查结果，未来版本需要重新检查。

2026 年 10 月 18 日在 [AT Open GIS](https://data-atgis.opendata.arcgis.com/) 找到官方 [Fare Zones 图层](https://data-atgis.opendata.arcgis.com/datasets/3549d3cc98e7480abb77f436e05a7799)（CC BY 4.0，AT 发布，2026-10-14 最后编辑）：26 个多边形，包括 9 个票价区、Aotea 以及各重叠区（名称为两个区，如 “City, Isthmus”）；重叠区是独立的多边形，与所在两区不重叠。AT 说明该图层用于地图展示，来源沿革不详，区划变动时手动更新。项目以约 2 米简化后打包为 `packages/providers/src/data/at-fare-zones.json`（约 148 KB，gzip 约 38 KB，仅在规划公交时按需加载），可用 `node scripts/update-fare-zones.mjs` 刷新。

## 为什么不能按公里数计算

AT 公交和火车按实际经过的票价区计费，并有边界与重叠区规则。首尾地点或首尾站所在区不足以证明整条路线的跨区数。符合条件的公交/火车转乘也不能逐段重复收费；需考虑同一卡或设备、30 分钟转乘间隔和 4 小时行程限制。支付方式、优惠资格和同一卡既有消费还会影响票价上限。渡轮及非 AT 服务需另行处理。

现行成人 HOP/非接触支付的单程 1、2、3、4+ 区票价分别为 NZ$3.00、4.90、6.50、7.90；$6.50 是 3 区价，普通整合行程的 4+ 区价为 $7.90。CityLink 成人价为 $0.95。详见 [2026 官方票价调整表](https://at.govt.nz/bus-train-ferry/fares-and-discounts/public-transport-fare-changes)。跨区数未确认时显示区间，不声称精确计价；未知票价不会作为零元参加费用比较。

## 已实现的自动区间

网页不再向 Google 请求公交票价（provider 选项 `useGoogleTransitFare: false`，请求字段不含 `travelAdvisory`）；已识别的 AT 公交/火车路线一律按 AT 票价表给出成人 AT HOP／银行卡票价区间。正常整合行程显示 NZ$3.00–7.90，纯 CityLink 显示约 $0.95。换乘时间不明时放宽上界；已知超过 30 分钟换乘或超过 4 小时行程时按分开的行程累加。假设同一卡/设备正确上下车刷卡，未计优惠、补贴或既有封顶消费。超过五次乘车的上界保守地拆分换乘组，这是估算假设，不声称是已核实的现行 AT 限制。按已知实际上车日期检查票价表，2027 年 2 月 1 日起需更新表或核实票价。

**自动计区（2026-10-18 起）：** Google 公交路线的每段车都带行驶轨迹。程序把每段整合行程（30 分钟内换乘、4 小时内）的公交/火车轨迹每约 100 米取一个点，判断所在区或重叠区，取能覆盖全程的最少区数（重叠区按对乘客更便宜的一边算）；火车经过 City 区但不在 City 区上下车时不计 City（重叠区里的刷卡不算在 City 刷卡）。得到区数后按 AT 成人票价表给出具体票价，并记在票价的 `mapZones` 里。实测：Henderson→Britomart 火车 3 区（Waitākere、Isthmus、City），Onehunga→Epsom 公交 1 区，与 AT 官方示例一致；Newmarket→Britomart 火车 1 区；Botany→Britomart（70 路 + 火车）3 区。缺轨迹的行程仍显示 1–4+ 区区间。站点恰好在区界上时可能差一区，假设说明里提示到 AT Journey Planner 核对。

手机端选中一条整合行程的公交路线后，价格摘要里显示 1／2／3／4+ 区，已按区域图预选，并注明“按 AT 区域图：Isthmus → City”；也可点其他区数覆盖：区间收窄为该区数的 AT 成人票价（去程、预估回程按同一区数），旁边链接 AT 票价区地图。这只是本地计算，不发请求、不写入存储；拆成多段行程或纯 CityLink 的路线不显示选区，仍用完整的 AT 票价助手。区数由乘客按 AT 区域图确认，网页不自动判断。

Google 的真实站数、线路和上下车站用于解释路线；站数不当作票价区数。手填整段已确认票价或用已核实跨区数应用 AT 助手，可本地替换区间；清空票价可恢复原区间，地图路线仍来自 Google。费用卡片、比较、明细和周/月预算保持区间，排名按上界并标明假设。未知运营商不套用 AT 上限。底层 provider 通过 `estimateMissingTransitFare` 显式开启，网页已经启用。

AT Mobile 或官方 Journey Planner 显示价格，并不能证明当前公开 GTFS 包含报价；本次检查未找到可直接调用的公开行程票价接口。要缩窄当前区间，仍需官方区域映射或获准使用的行程报价服务。

## 实施路径

1. **现在可用：自动区间与官方核价。** Google 提供 AT 路线，网页自动给出上述成人区间；在 AT Journey Planner 核对实际行程，手填其报价，或确认去程、回程跨区数后使用票价助手缩窄为具体估算。
2. **接站点和实时公交数据。** 在 [AT 开发者门户](https://dev-portal.at.govt.nz/)免费注册并订阅所需产品。门户目前标示 600 次/分钟及 35,000 次/周。API 使用 `Ocp-Apim-Subscription-Key` 请求头认证；公开 GTFS ZIP 可独立下载。
3. **增加后端代理与更新任务。** AT subscription key 放服务器环境变量，前端只访问本项目代理。GitHub Pages 是静态托管，无法保密放进 `VITE_*` 的 Key。后台更新 GTFS、建立站点/班次索引；实时查询需缓存与限流。公开 GTFS 下载页标示 CC BY 4.0，使用时保留来源；API 产品还需核对对应条款。
4. **补齐真正自动计费的数据。** 获取官方站点到票价区/重叠区分配、完整计费规则，或获准使用官方行程报价服务。再结合实际公交停站序列、换乘、支付方式和乘客资格计算。仅申请 GTFS/Realtime Key 不会补齐这些缺失字段。

当前流程已保留 Google 几何来源并分开标明票价来源；区间可以参与保守预算比较，具体报价需要官方核实。GTFS 班次引擎、实时车辆数据及 GIS 自动跨区计算尚未接入。
