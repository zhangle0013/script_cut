# ScriptCut：AI 生成用 JSON 规范 + 时间预估标准

本文档供 **AI 直接生成可导入 ScriptCut 时间轴 UI 的工程 JSON**，并统一 **各类元素的时长预估规则**。人类可把本文整体作为系统提示或约束附件。

---

## 〇、与 Seedance「film-production」技能包的关系（可选增强）

**景别与运镜的 code 以本文 §5.2、§5.3 为唯一标准**（与 `src/filmVocabulary.ts` 一致，并与 OpenClaw **`seedance-video-creator/film-production`** 中 `camera.md` / `cinematography.md` 概念对齐）。

若使用上述技能包，可把它当作 **灯光、构图、景深、导演叙事** 的补充词库；写入 JSON 时：

| 技能文件 | 主要内容 | 写入 ScriptCut 时的落点 |
|----------|----------|--------------------------|
| `SKILL.md` / `directing.md` | 叙事、节奏、分镜 | `project.meta`、`group`；**表演/走位节拍见 §5.7，勿堆进 `description`** |
| `camera.md` | 画幅、构图、景深、焦距、色彩 | `description`（摄影/构图句）；**景别 code 只用 §5.2** |
| `cinematography.md` | 运镜叙事 | **`cameraMove` 只用 §5.3**；细节写入 `camera` / `description` |
| `lighting.md` | 布光与光效 | `description` 中结构化光效句 |

**约定**：JSON 管 **时间线与枚举字段**；`description` 管 **Seedance 可执行的画面提示**（构图/光影/空间/氛围为主，**不含**表演动词链，见 §5.7）。生成顺序：**先 Timing Spec 排口播、镜长与 `trk_action` → 再润色 `description`**。

---

## 一、输出格式（硬性）

- 顶层必须为：`{ "project": { ... } }`
- **只输出合法 JSON**：无注释、无尾逗号、可被 `JSON.parse` 解析
- **时间一律为全局秒数**（`number`），禁止 `0:05.5` 字符串
- **禁止分段重置时间**：若分多段撰写（如每段 15s），第二段必须在写入 JSON 前整体 **加 offset**（例如 +15），使全片时间线连续

---

## 二、`project` 对象结构

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `version` | string | 是 | 建议固定 `"0.1"` |
| `inputPath` | string | 是 | 追溯用，如 `"ai://generated"` |
| `meta` | object | 是 | 键值对；可 `{}`；建议含 `title`、`targetDurationSec` |
| `tracks` | array | 是 | 轨道定义 |
| `cuts` | array | 是 | 切点时间集合 |
| `visualSegments` | array | 是 | 画面段落（镜头段落） |
| `clips` | array | 是 | 对白/旁白/动作/音效/环境/信息等时间片段 |

---

## 三、`tracks[]`（轨道）

每条：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 唯一，如 `trk_dialogue` |
| `type` | string | 是 | 见下表 |
| `name` | string | 否 | 显示名 |

**`type` 取值：**

- `visual`：画面段落
- `dialogue`：对白
- `narration`：旁白
- `action`：动作/节拍（可选）
- `sfx`：音效 / 环境声 / 拟音（可选，与对白分离）
- `info`：说明/提示词/参考（可选，通常不占口播时长）
- `environment`：场景信息（地点、时段、空间、氛围等，可选；时间轴上位于 `info` 与画面轨之间）
- `subtitle`：字幕（可选）

**最低配置（必须包含）：**

- `trk_visual` → `visual`
- `trk_dialogue` → `dialogue`
- `trk_narration` → `narration`

**完整工程推荐（含音效，与 ScriptCut 默认解析器一致）：**

- 在上述三条之外，可声明 `trk_environment`、`trk_action`、`trk_sfx`、`trk_info`、`trk_subtitle`（`id` 建议与类型前缀一致，如 `trk_environment`）。

---

## 四、`cuts[]`（切点）

每条：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 唯一 |
| `t` | number | 是 | 切点时刻（秒） |
| `kind` | string | 否 | 如 `hard` / `fade` |
| `note` | string | 否 | 备注 |

**约束：**

- 必须包含 **0** 与 **全片结束时刻**（如 30）
- 应包含所有 `visualSegments` 的 `start`、`end`（去重后按 `t` 升序）

---

## 五、`visualSegments[]`（画面段落）

每条表示时间轴上一段连续画面，可与对白/旁白 **时间重叠**（对白在独立轨道）。

**专业词汇已融入 JSON**：`framingStart` / `framingEnd` / `cameraMove` 必须使用 **第五节列出的枚举 code**（与 `film-production` 中 `camera.md`、`cinematography.md` 体系一致；工程内校验列表见 `src/filmVocabulary.ts`）。

### 5.1 字段表

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 唯一 |
| `start` | number | 是 | 开始秒 |
| `end` | number | 是 | 结束秒，须 `start < end` |
| `label` | string | 是 | 短标签，如 `S01` |
| `framingStart` | string | 否 | **景别 code**，见 §5.2；段落起始画幅 |
| `framingEnd` | string | 否 | **景别 code**，见 §5.2；与 `framingStart` 相同表示本段内景别不变 |
| `cameraMove` | string | 否 | **运镜 code**，见 §5.3 |
| `moveAmplitude` | string | 否 | **`S` \| `M` \| `L`**，与 §7.5 时长带对应 |
| `moveDurationHint` | number | 否 | 运动建议最短秒数；与 `end-start` 取 max 做自检 |
| `framing` | string | 否 | **兼容旧数据**：自由文本（如 `WIDE` 英文提示词），**勿与枚举混用为唯一依据** |
| `camera` | string | 否 | **兼容旧数据**：自由文本；`cameraMove` 为 `Combo` 时**必须**写清组合 |
| `description` | string | 否 | 画面/光影/构图叙述（可含 Seedance 可用英文 prompt） |
| `group` | string | 否 | 如 `segment1`、`auto` |

### 5.2 景别枚举 `framingStart` / `framingEnd`（必须使用下列 code）

| Code | 英文术语 | 中文 | 叙事功能（摘要） |
|------|-----------|------|------------------|
| `EWS` | Extreme Wide Shot | **极远景** | 大环境、人物渺小；建立时空与氛围 |
| `WS` | Wide / Long Shot | **远景** | 全身+环境关系；建立场景、群体与场面 |
| `FS` | Full Shot | **全景** | 人物全身与动作；舞蹈/走位 |
| `MS` | Medium Shot | **中景** | 膝上/腰上；对话与叙事主力景别 |
| `MCU` | Medium Close-Up | **中近景** | 胸上；表情+少许环境 |
| `CU` | Close-up | **特写** | 面部或关键物体；情感与信息强调 |
| `ECU` | Extreme Close-up | **极特写** | 眼/唇/细节；高潮或符号 |

**给 AI**：`framing` 自由字段可写 `WIDE` 等与 `WS`/`EWS` 近义的英文，但 **结构化字段请只用上表 code**，避免解析歧义。

### 5.3 镜头运动枚举 `cameraMove`（必须使用下列 code）

| Code | 英文/行业用语 | 中文 | 说明 |
|------|----------------|------|------|
| `Fixed` | Static / Fixed shot | **固定** | 机位与角度不变；画面动感来自演员/光影 |
| `SlowPush` | Slow dolly in / push in | **慢推** | 轴向靠近主体；关注、压迫、进入叙事 |
| `FastPush` | Fast push / crash in | **急推** | 快速靠近；冲击、震惊 |
| `SlowPull` | Slow dolly out | **慢拉** | 轴向远离；揭示环境、疏离、收束 |
| `FastPull` | Fast pull out | **快拉** | 快速远离；突然展示全貌或断裂感 |
| `Pan` | Pan (horizontal) | **摇（水平）** | 水平扫视空间；跟随横向运动 |
| `Tilt` | Tilt (vertical) | **摇（垂直）** | 垂直扫视；建筑高度、起立等 |
| `CraneUp` | Boom up / crane up | **升** | 垂直升高机位；由低到高揭示 |
| `CraneDown` | Boom down / crane down | **降** | 垂直降低机位；由高聚焦到低 |
| `Truck` | Truck / lateral track | **横移** | 与光轴垂直平移；跟拍侧面、掠过环境 |
| `Follow` | Follow / tracking / stabilizer follow | **跟拍** | 跟随主体移动；临场、连贯动作 |
| `Orbit` | Orbit / 360 | **环绕** | 绕主体旋转；展示关系与空间 |
| `Handheld` | Handheld | **手持** | 轻微或明显晃动；纪实、紧张、主观 |
| `WhipPan` | Swish pan / whip pan | **甩镜** | 极速摇镜；转场、冲击 |
| `Combo` | Combined move | **组合运镜** | 推拉+摇、移+推等；**须在 `camera` 或 `description` 写明组合** |

### 5.4 `moveAmplitude`

- **`S`**：小幅（角度小、位移短、或轻微推拉的幅度）
- **`M`**：中幅
- **`L`**：大幅（大角度摇、长距离跟移、大跨度景别渐变等）

### 5.5 景别与运动配合（给 AI）

- **跳变景别**：两段 `visualSegments` 相接；每段 `framingStart === framingEnd`，`cameraMove: Fixed`（或极短插入镜 + 硬切）
- **同镜渐变景别**：单段 `framingStart !== framingEnd`，且 `cameraMove` 通常为 `SlowPush` / `SlowPull`；**镜长 ≥ max(口播, §7.5 该运动时长带)**

### 5.6 画面段落衔接

- 建议相邻段首尾相接（误差 ≤0.02s），覆盖 `0 → targetDuration`

### 5.7 画面 `description` 与动作轨：职责切分（**硬性**）

**问题**：若把演员走位、手势、递接物品、跑跳、表情节拍等 **表演信息** 全文写进 `visualSegments[].description`，时间轴上 **动作轨会空**，口播/画面对齐与后期检索都会变差。

| 写入位置 | 应放内容 | 不应放 |
|----------|----------|--------|
| `visualSegments[].description` | **静态画面**：场景/空间、主体轮廓、构图、光影、色彩、氛围、关键静物；可含 Seedance 英文 prompt | **过程性表演**：谁抬手、谁转身、几步走到哪、对视、递东西、摔倒起身的节拍 |
| `clips[]` 且 `trackId → trk_action` | **可执行的表演/节拍**：一句一 beat；`text` 写动作；`meta` 可写强度档如 `intensity:M`（对应 §7.2）；`start/end` 与镜内时间对齐 | 整段笼统叙事（应拆成多条或合并为一条但勿放回 description） |

**反例（禁止）**：`description` 里写「骑手刹车停稳，单脚撑地，抬头看镜头，抬手敲门三下」——应拆成 **1～N 条** `action` clip，或至少一条覆盖该镜主要节拍；`description` 只保留如「废土街道，热浪，骑手与车在前景剪影」等 **画面** 信息。

**生成 JSON 时的最低要求**：

- 凡剧本/分镜里出现 **可被表演的动词链**（走、停、递、看、转身、点头等），优先在 **`trk_action`** 上落 **带时间的** `clips`，不要把它们只藏在 `description` 长句里。
- 若一镜内有多拍动作，按时间顺序多条 `action` clip，`start/end` **可重叠对白**，与同镜 `visualSegments` 时间范围一致或为其子区间。

**与 Markdown 导入对齐（可选）**：在 Shot 描述行使用前缀 **`动作：`**、**`表演：`**、**`Action:`**、**`【动作】`** 等，ScriptCut 解析器会把这些行从 `description` 拆出并生成对应 `trk_action` clip（时间与该镜相同）；见 `src/parser.ts` 中 `partitionShotDescriptionLines`。

### 5.8 轨间去重与视听分工（避免画面轨「一锅粥」）

以下对应 **常见错误 JSON**（例如：画面轨长段里既有景又有表演又有声又有 UI 字，与其它轨重复）。

| 现象 | 问题 | 正确做法 |
|------|------|----------|
| `visualSegments[].description` 里写 **拟声 / 听感**（如「机械关节嘎吱作响」「刹车尖叫」） | 那是 **声音事件**，不是纯画面 | 写入 **`trk_sfx`** 的 `clips`（§7.7）；画面只保留 **可见** 状态（锈蚀、灯亮、关节形态等） |
| 同一时间段内，**画面描述**与 **`trk_action` 的 `text` 复述同一串动词**（急刹、狗跳开、沙尘） | 双轨 **全文重复**，时间轴臃肿且难改 | **二选一为主**：动作进 `action` 则画面只写 **静帧构图/环境/光影**；或画面只写一句总览，动作轨写拆条 **不要复制整段** |
| **订单号 / HUD / 屏幕 UI 字**（如「ML-…，状态：配送中」）同时出现在 **画面 `description`、info、第三条 overlay** | **三处粘贴**，语义单一却占满多轨 | **单一权威落点**：优先 **`trk_subtitle`**（观众可见字）或 **一条** `trk_info`（文档/场记）；其它轨 **引用同一时间** 即可，**勿全文重复** |
| 相邻两镜 **`description` 几乎相同**、仅时长不同 | 往往是切镜/数据错误或未重写镜内容 | 每段 `visualSegment` 应对应 **该镜独有** 的画面信息；重复粘贴视为 **未过自检** |

**一句话**：画面轨 = **看见什么（静态或可画）**；动作轨 = **谁在动**；音效轨 = **听见什么（非对白）**；屏上字 = **subtitle / 单条 info**。宁可在轨之间 **分工**，也不要在同一镜的 `description` 里 **叙事大满贯**。

---

## 六、`clips[]`（对白 / 旁白 / 动作 / 环境等）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 唯一 |
| `trackId` | string | 是 | 必须存在于 `tracks[].id` |
| `start` | number | 是 | 开始秒 |
| `end` | number | 是 | 结束秒，`start < end` |
| `speaker` | string | 否 | 说话人 |
| `meta` | string | 否 | 语气、表演提示 |
| `text` | string | 是 | 台词或动作描述等 |
| `source` | string | 否 | 建议 `ai` 或 `ai.segment2` |

**约束：**

- 对白/旁白可重叠（抢话、打断）；若输出「排队版」则同一 `trackId` 内应避免重叠
- `trackId` 与 `type` 一致：旁白内容建议走 `trk_narration`，对白走 `trk_dialogue`
- 场景/时空/氛围（地点、日夜、气候、空间关系等）建议走 **`trk_environment`** 的 `clips`，与 `trk_info`（策略/参考）及画面 `description`（本镜可见内容）区分

---

## 七、时间预估标准（Timing Spec）

所有预估均以 **秒** 为单位；生成 JSON 时应用下列规则得到 `start/end` 或先算 `duration` 再落位。

### 7.1 对白 / 旁白（口播）

记 `visibleChars` = 去掉空白后的字符数。

**基础时长：**

\[
T_\text{base} = \frac{\text{visibleChars}}{\text{baseCps}}
\]

- **对白** `baseCps = 7.5`
- **旁白** `baseCps = 8.5`  
（更快节奏可提高到 9–11，但易「赶」。）

**标点停顿（累加）：**

| 标点 | 单处停顿（秒） |
|------|----------------|
| `，` `,` | 0.18 |
| `。` `.` | 0.32 |
| `？` `?` | 0.36 |
| `！` `!` | 0.36 |
| `……` / `...` | 0.42 |
| `——` / `-` | 0.12 |
| `：` `:` | 0.22 |
| `；` `;` | 0.26 |

**数字 / 英文惩罚：**

- 每个英文字符：`+0.015s`
- 每个数字字符：`+0.020s`

**最短句长：**

\[
T_\text{speech} = \max(0.6,\; T_\text{base} + T_\text{pause} + T_\text{extra})
\]

**超速参考（用于自检 / UI 标红）：**

- `cps = visibleChars / (end - start)`
- `cps > 12`：偏紧；`cps > 16`：建议延长或拆句

### 7.2 动作 / 表演（**必须**使用 `trk_action` 的 `clips`，勿只写在 `description`）

不按字数；用 **强度档位** 默认时长（`meta` 中标注 `intensity:S` 等便于自检）：

| 档位 | 含义 | 建议时长（秒） |
|------|------|----------------|
| S | 微动作（点头、回头） | 0.6–1.2 |
| M | 中动作（递物、走两步） | 1.2–2.5 |
| L | 大动作（跑、明显调度） | 2.5–5.0 |
| XL | 复杂调度 | 5.0–8.0 |

AI 应为动作块标 `intensity`，并取区间中值作为默认时长。

### 7.3 信息 / 场景大段描述（`info` 轨）

- **默认不占叙事主时长**：`duration = 0` 或占位 `0.1s`（仅定位）
- 若必须占时：显式给 `intentDuration`（由剧情约定），**不得**按字数线性拉长

### 7.4 画面段落时长与「快切密度」

- **快切策略**：平均镜头 **1.5–3.5s**（适合对白密集）
- **长运动 / 氛围镜**：允许 **>3.5s**，但须对应第七节 7.5 中的运动类型，且满足该运动最小时长

**与口播同镜时：**

\[
\text{segmentDuration} \ge \max(T_\text{speech 覆盖该镜的部分},\; T_\text{move})
\]

（多句跨镜时，按实际覆盖关系拆分估算。）

### 7.5 镜头运动节奏（`cameraMove` + `moveAmplitude`）

单镜内完成一次「可读」运动的建议时长带（秒）；**code 与 §5.3 完全一致**。

| `cameraMove` | S（小幅） | M（中幅） | L（大幅） |
|--------------|-----------|-----------|-----------|
| `Fixed` | 由内容定 | — | — |
| `SlowPush` | 2.0–3.5 | 3.5–5.5 | 5.5–8.0 |
| `SlowPull` | 2.0–3.5 | 3.5–5.5 | 5.5–8.0 |
| `FastPush` | 0.8–1.5 | 1.2–2.0 | 1.5–2.5 |
| `FastPull` | 0.8–1.5 | 1.2–2.0 | 1.5–2.5 |
| `Pan` | 1.5–2.5 | 2.5–4.0 | 4.0–6.0 |
| `Tilt` | 1.5–2.5 | 2.5–4.0 | 4.0–6.0 |
| `CraneUp` / `CraneDown` | 3.0–5.0 | 5.0–8.0 | 8.0–12.0 |
| `Truck` | 2.0–3.5 | 3.5–5.5 | 5.5–9.0 |
| `Follow` | 2.0–3.5 | 3.5–5.5 | 5.5–9.0 |
| `Orbit` | 3.0–5.0 | 5.0–8.0 | 8.0–12.0 |
| `Handheld` | 1.0–2.0 | 2.0–3.5 | 3.5–5.0 |
| `WhipPan` | 0.3–0.8 | — | — |
| `Combo` | 取组合中各 code 对应行的 **最大值**；无法估算则 **拆成多段** `visualSegments` | | |

**规则：**

- 先定 `cameraMove` 与 `moveAmplitude`，取区间中值作为 `moveDurationHint`
- **景别跨档渐变**（如 `MS`→`CU`）配 `SlowPush` 时，幅度倾向 **M~L**，时长取较长档
- 若快切上限 3.5s 与某运动 **S 档最小值**冲突：要么 **加长该镜**，要么 **改 `Fixed` + 硬切** 或 **拆成两镜**

### 7.6 景别与运动配合（摘要）

- **固定机位**：`framingStart === framingEnd`，`cameraMove: Fixed`
- **同镜渐变景别**：`framingStart !== framingEnd` + `SlowPush` / `SlowPull` 等，**镜长 ≥ 运动时长带下限**
- **硬切换景别**：两段 `visualSegments` 均为 `Fixed`，靠 cut 衔接

### 7.7 音效轨（`sfx`）

- **用途**：环境声、硬效、拟音、UI/机械提示音等；**不走口播 cps 模型**，`text` 写「声音内容简述」即可（如「电动车急刹」「风沙」「屏幕提示音」）。
- **时长**：**不按字数**。按事件类型取默认区间（可与 §7.2 动作档类比，略短、允许重叠）：

| 类型（写入 `meta` 建议关键词） | 建议时长（秒） |
|--------------------------------|----------------|
| 点状硬效（点击、短 beep、一拍） | 0.15–0.5 |
| 短环境/一层（风声底层、远处嗡鸣） | 1.0–4.0（可跨多镜，一条长 clip） |
| 动作耦合（刹车、金属摩擦、脚步） | 与画面对齐：`duration ≈` 动作可见时长，通常 **0.5–3.0** |
| 长氛围（持续引擎、警报循环） | 按剧情；注意与对白 **ducking** 在混音阶段处理，时间轴上允许与口播重叠 |

- **轨道约束**：`trackId` 必须指向 `type: "sfx"` 的轨道（如 `trk_sfx`）。
- **与对白关系**：音效可与对白 **时间重叠**；生成 JSON 时不必为音效「让出」整条静音，除非剧本要求留白。

---

## 八、自检清单（AI 输出前）

- [ ] 仅 JSON，顶层 `{ "project": ... }`
- [ ] 所有时间为 **number 秒**，全局连续，无分段从 0 重置
- [ ] 每条 `clip.trackId`、`visualSegment.id` 合法；`start < end`
- [ ] `cuts` 含 **0**、**终点**，且覆盖主要画面边界
- [ ] 口播 `cps` 不过度离谱；重要对白已预留停顿
- [ ] 画面段 `framingStart`/`framingEnd`/`cameraMove` 均为 **§5.2 / §5.3 枚举 code**；`Combo` 已写清组合
- [ ] 景别 / 运镜 / 镜长一致；`SlowPush` 等已给够时长
- [ ] 若使用音效：每条 `sfx` clip 的 `trackId` 正确，`start/end` 与画面/动作意图一致
- [ ] **动作已拆轨**：表演/走位/节拍在 `trk_action` 的 `clips` 中有落点；**未**把大量动词链只堆在 `visualSegments[].description`（见 §5.7）
- [ ] **视听分离**：拟声、机械摩擦、环境声等不在画面 `description` 里冒充「画面」，已落到 **`trk_sfx`**（见 §5.8、§7.7）
- [ ] **无跨轨全文复制**：屏显/UI 字、场记句不在 `description` + `info` + 其它轨 **重复粘贴**；有 **单一权威轨**（见 §5.8）

---

## 九、各类元素时长建议（中文版附录）

本节把 **§7** 浓缩为「按类型怎么估时长」，供人类审阅或作为 AI 系统提示片段；**口播与画面、音效逻辑不同，不可混用同一套公式**。

| 元素 | 时长怎么定 | 能否用「对白那种」字速模型 |
|------|------------|----------------------------|
| **对白** | §7.1：`baseCps` + 标点停顿 + 数字/英文惩罚 + 最短句长；单镜画面 ≥ 落该镜的口播时长 | ✅ 即用 §7.1 / `estimateSpeech` 同类思路 |
| **旁白** | 同 §7.1，可把 `baseCps` 略调高（如 8.5） | ✅ 同对白，参数可区分 |
| **画面段** | §7.4 快切 1.5–3.5s；长镜须满足 §7.5 运镜时长带；与同镜口播取 **max(口播, 运镜)** | ❌ 不按 `description` 字数当口播 |
| **运镜** | §7.5 按 `cameraMove` + `moveAmplitude` 查表；`moveDurationHint` 可取区间中值自检 | ❌ 查表，不是 cps |
| **动作轨** | §7.2 按强度档 S/M/L/XL 区间 | ❌ 按档位，不按字数 |
| **音效轨** | §7.7 按事件类型区间；可与对白重叠 | ❌ 不按字数；`text` 仅描述 |
| **信息轨** | §7.3 默认不占时或 0.1s；特殊占用用显式意图时长 | ❌ 禁止按字数线性拉长 |
| **字幕** | 规范未单列；工程上可套用 **略快于对白** 的阅读 cps（如 8–10）估「最短显示时长」，避免一屏字过短 | ⚠️ 可与口播 **同类启发式**，参数单独调 |

**原则**：凡「人要听完/读完」的 **线性文本**（对白、旁白、字幕），可共享 **cps + 停顿** 这一类模型；凡 **事件/运动/声音/镜头运动**，用 **档位表或 §7.5/7.7**，并与口播取 **max** 或 **对齐关键帧**，不要拿画面描述字数当口播秒数。

---

## 十、极简示例（结构示意）

```json
{
  "project": {
    "version": "0.1",
    "inputPath": "ai://generated",
    "meta": { "title": "示例", "targetDurationSec": "30" },
    "tracks": [
      { "id": "trk_visual", "type": "visual", "name": "画面段落" },
      { "id": "trk_dialogue", "type": "dialogue", "name": "对白" },
      { "id": "trk_narration", "type": "narration", "name": "旁白" },
      { "id": "trk_action", "type": "action", "name": "动作/节拍" },
      { "id": "trk_sfx", "type": "sfx", "name": "音效" }
    ],
    "cuts": [
      { "id": "cut_001", "t": 0 },
      { "id": "cut_002", "t": 2.0 },
      { "id": "cut_999", "t": 30.0 }
    ],
    "visualSegments": [
      {
        "id": "vs_001",
        "start": 0,
        "end": 2.0,
        "label": "S01",
        "framingStart": "WS",
        "framingEnd": "WS",
        "cameraMove": "Fixed",
        "moveAmplitude": "S",
        "description": "Establishing wide — wasteland street, heat haze, silhouettes only (no blocking)."
      }
    ],
    "clips": [
      {
        "id": "clip_act_001",
        "trackId": "trk_action",
        "start": 0,
        "end": 1.2,
        "meta": "intensity:M",
        "text": "骑手捏闸减速，单脚落地撑车，抬头扫视门牌。",
        "source": "ai"
      },
      {
        "id": "clip_001",
        "trackId": "trk_narration",
        "start": 0,
        "end": 2.0,
        "speaker": "角色A",
        "meta": "旁白，平静",
        "text": "这是第一句旁白。",
        "source": "ai"
      },
      {
        "id": "clip_sfx_001",
        "trackId": "trk_sfx",
        "start": 1.2,
        "end": 2.0,
        "speaker": "",
        "meta": "短硬效",
        "text": "远处引擎嗡鸣渐强",
        "source": "ai"
      }
    ]
  }
}
```

---

*文档版本：`TrackType` 含 `sfx`（音效轨）、`environment`（环境/场景轨，UI 顺序在 `info` 与 `visual` 之间）；`VisualSegment` 已包含 `framingStart` / `framingEnd` / `cameraMove` / `moveAmplitude` / `moveDurationHint`（见 `src/types.ts`、`src/filmVocabulary.ts`）；枚举与 `film-production` 技能包术语对齐。*
