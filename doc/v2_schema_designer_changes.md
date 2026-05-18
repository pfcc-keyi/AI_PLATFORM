# V2 Schema Designer Cockpit — changes & deployment

对比基线: `origin/main` @ `4fcd874` (`chore: sync vendored crewai with upstream a95d26763f47`)

---

## 1. 与远程版本相比的差异

### 1.1 新增文件 (untracked)

#### 后端 (ai_platform/)

| 文件 | 说明 |
|---|---|
| `models/design_models.py` | Pydantic 模型：`ParsedSchema`, `ClusterSpec`, `DomainAnalysis`, `HandlerSketch`, `ClusterDesign`, `ERDLayout`, `DesignIssue`, `DesignCritique`, `FullDesign`, `DesignRevision`, `DesignState` |
| `storage/__init__.py` | 空包标记 |
| `storage/design_store.py` | 文件 JSON store，原子写 + snapshot-based revision 历史 |
| `flows/design_excel.py` | Phase 1 纯 Python: openpyxl 解析 + NetworkX FK 图 + Louvain 聚类 + 3D 布局 |
| `flows/design_flow.py` | `SchemaDesignFlow(Flow[DesignState])` 主流程: parse → analyze → cluster design → synthesize + validate + critic + 重构/按需方法 |
| `crews/design_design_crews.py` | 4 个 crew 工厂：DomainAnalyst / ClusterDesigner / DesignCritic / Refinement (+1 个 FieldHandler) |
| `skills/schema_design_cockpit/SKILL.md` | CrewAI Skill (prompt governance layer) |
| `api/routes/design.py` | `/api/design/*` REST + SSE 路由，含 inline `crewai_event_bus` 桥接 |

#### 新前端 (ai_platform/design_frontend/)

整个 Next.js 15 项目，独立部署。

| 类别 | 文件 |
|---|---|
| Bootstrap | `package.json`, `tsconfig.json`, `next.config.mjs`, `tailwind.config.ts`, `postcss.config.js`, `.gitignore`, `.env.example`, `Dockerfile`, `railway.toml`, `README.md`, `DEPLOYMENT.md` |
| 全局样式 | `styles/globals.css` |
| 路由页面 | `app/layout.tsx`, `app/page.tsx`, `app/design/[id]/page.tsx`, `app/api/health/route.ts` |
| 状态管理 | `store/designStore.ts`, `store/eventsStore.ts` (Zustand) |
| 后端通信 | `lib/api.ts`, `lib/sse.ts`, `lib/types.ts`, `lib/layout3d.ts`, `lib/utils.ts` |
| UI 基础组件 | `components/QueryProvider.tsx`, `components/ui/{button,card,badge,dialog,sheet,input}.tsx` |
| 着陆页 | `components/landing/DesignList.tsx`, `components/upload/UploadDropzone.tsx` |
| 3D 场景 | `components/scene/{Scene3D,TableNode3D,RelationshipEdge3D,ClusterHalo,MiniMap}.tsx` |
| 面板/检查器 | `components/panels/{TableInspector,FieldInspector,StateTransitionPanel,HandlerChipsPanel,AssumptionDrawer,ConfidenceLegend,DesignDiffPanel,ClarificationCard,ReviewBar,AIThinkingStream}.tsx` |
| 设计聊天 | `components/chat/DesignChat.tsx` |

#### 文档

| 文件 | 说明 |
|---|---|
| `doc/schema_designer_frontend_6b69d365.plan.md` | 设计 plan 的快照副本 |
| `doc/v2_schema_designer_changes.md` | 本文档 |

---

### 1.2 修改的文件 (5 个，共 +19 行)

| 文件 | 变更摘要 |
|---|---|
| `app.py` | 注册 `design_router` (`/api/design`)；在 `lifespan` 调用 `register_design_listeners()` 挂载 SSE 事件桥 |
| `config.py` | 新增 `DESIGN_STORAGE_DIR` (默认 `/data/designs`) |
| `entrypoint.sh` | 新增 `mkdir -p ${DESIGN_STORAGE_DIR}` |
| `Dockerfile` | `COPY storage/ skills/`；新增 `ENV DESIGN_STORAGE_DIR=/data/designs` |
| `pyproject.toml` | 新增依赖：`python-multipart>=0.0.9`, `openpyxl>=3.1`, `networkx>=3.2`, `python-louvain>=0.16` |

**所有改动都是新增 / 不破坏现有功能**：`config_flow.py`、`ops_flow.py`、现有 frontend、`knowledge/`、`setup/`、`tools/` 全部未触碰。

---

## 2. 部署清单（Railway）

### 2.1 整体目标

**只新开 1 个 Railway service（新前端），后端 service 不新建。**

| Railway service | 之前 | 之后 |
|---|---|---|
| `ai_platform` 后端 | 1 | 1（同一个，redeploy 拿到新代码） |
| 旧前端 `ai_platform/frontend` | 1 | 1（不动） |
| **新前端 `ai_platform/design_frontend`** | — | **+1（新增）** |
| 持久化 volume | — | 可选 +1（挂在后端 `/data/designs`） |

### 2.2 你需要做的事 (按顺序)

#### Step 1 — 后端 service

仅需 **redeploy 现有 service**。无新增 env 变量是必填的，但可以可选挂 volume：

- **必填环境变量**：无（保持已有的 `OPENAI_API_KEY`, `OPENAI_API_BASE`, `OPENAI_MODEL`, `EMBEDDER_*`, `DATA_PLATFORM_*` 不变即可）。
- **可选**：
  - `DESIGN_STORAGE_DIR=/data/designs` （Dockerfile 已默认设置，不填也行）
  - 在 service Settings → Volumes 新建一个 volume mount 到 `/data/designs`，否则容器重启后 design 会丢（demo 阶段可以不挂）。

#### Step 2 — 新前端 service（唯一新增的 service）

在 Railway 上：

1. **New Service → Deploy from GitHub repo** → 选 `pfcc-keyi/AI_PLATFORM`（同一个 repo）。
2. 进入新 service 的 **Settings**：
   - **Root Directory = `design_frontend`**（关键！让 Railway 只 build 这个子目录）
   - **Builder** 会自动识别 `Dockerfile`（`railway.toml` 已声明）。
3. **Variables** 标签页填入：

   | 变量 | 必填? | 值 |
   |---|---|---|
   | `NEXT_PUBLIC_AI_API_URL` | **必填** | 现有后端 service 的公开 URL，例如 `https://ai-platform-production.up.railway.app`（**无尾斜杠**） |
   | `PORT` | 否 | Railway 自动注入，Dockerfile 默认 3000 |

4. 点击 **Deploy**。

#### Step 3 — 验证

后端：

```bash
curl https://<backend-url>/api/design/
# {"designs": []}
```

前端：访问新 service 的公开 URL → 看到着陆页和拖放区 → 拖入 .xlsx 应跳转到 `/design/<id>` 并开始渲染 3D ERD。

### 2.3 关键提醒

- **NEXT_PUBLIC_AI_API_URL 不能填错**：必须是后端 public URL，不能有尾斜杠，前端代码已自动追加 `/api/design/...`。
- **后端 CORS**：现有 `allow_origins=["*"]` 已经够用，新前端访问 SSE 不需要任何 CORS 调整。
- **同一个 GitHub repo，不要拆 repo**。Railway 用 Root Directory 区分两个 service 的 build 范围。
- **volume 是可选的**：不挂也能正常 demo，重启丢数据；要保留就挂在后端 `/data/designs`。
- **新前端是无状态的**：不需要 volume。
- **代码改动不影响旧 ops/config flow**：现有 `/api/config` 和 `/api/ops` 完全不受影响。

### 2.4 一句话总结

> Railway 上只新开一个 service（design_frontend，Root Directory = `design_frontend`，填一个环境变量 `NEXT_PUBLIC_AI_API_URL`），后端重 deploy 即可，volume 可选。
