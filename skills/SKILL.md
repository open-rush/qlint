---
name: qlint
description: Observability query linter — build, validate, and lint queries for Datadog, Elasticsearch, Octopus, and other platforms
version: 0.1.0
tags:
  - observability
  - query
  - logs
  - datadog
  - elasticsearch
  - octopus
  - loki
user-invocable: true
argument-hint: "validate 'service = payment AND level = ERROR'"
allowed-tools: Bash(*)
trigger: "qlint, log query, 查日志, 查指标, observability query, datadog query, elasticsearch query, loki query"
---

# qlint — Observability Query Linter

帮你为目标可观测平台生成语法正确的查询。

## 工作流程

1. 确认用户绑定的平台：`cat ~/.qlint/config.json`（未配置则问用户）
2. 用户说自然语言 → 你理解意图 → 用平台语法构建查询
3. 用 `qlint validate` 检查语法 → 有错就修
4. 用平台工具执行查询（如 `octo-cli`、Datadog API 等）

## 快速开始

```bash
# 配置默认平台（一次性）
qlint config -p octopus

# 校验查询
qlint validate "service = payment AND level = ERROR"

# 从条件构建查询
qlint build -f "service=payment" -f "level=ERROR" -f "latency>500"

# 查看支持的平台
qlint platforms
```

## 命令参考

| 命令 | 说明 |
|------|------|
| `qlint config -p <platform>` | 绑定默认平台 |
| `qlint validate "<query>"` | 校验查询语法 |
| `qlint build -f "field=value" ...` | 从条件构建查询 |
| `qlint translate --from <p> "<query>"` | 跨平台翻译 |
| `qlint platforms` | 列出支持的平台 |
| `qlint mcp` | 启动 MCP server |

所有命令支持 `-p <platform>` 覆盖默认平台。

---

## 平台语法速查

### Octopus (OctopusLogQL)

**基础语法：**
```
field = value
field != value
field > 500
field >= 500
field < 100
field <= 100
```

**逻辑运算符：**
```
service = payment AND level = ERROR
service = payment OR service = order
NOT level = DEBUG
(service = payment OR service = order) AND level = ERROR
NOT (service = test AND level = DEBUG)
```

**IN 运算符：**
```
log_type in (app, clog, alog)
NOT status in (200, 201)
```

**全文搜索：**
```
"connection refused"
"timeout" AND service = payment
```

**通配符：**
```
service = costa-*
host = prod-*
```

**值包含特殊字符时用双引号包裹：**
```
msg = "hello world"
state = "整理"
token = "abc123=="
```

**字段名支持点号：**
```
k8s.container.name = http-server
user.geo.ip.city = "北京"
```

**注意 — 以下语法 API 不支持（仅前端 UI 支持）：**
- ❌ `field regexp "pattern"` → 改用通配符 `field = pattern*`
- ❌ `... | stats count(*) by (field)` → 改用 `octo-cli logs aggregate -a "*:count" -g "field"`

### Elasticsearch / Kibana (Lucene)

```
service:payment AND level:error
service:payment OR service:order
NOT level:debug
status:>400
status:(200 OR 201 OR 204)
message:"connection refused"
host:prod-*
```

与 Octopus 的差异：
- 用 `:` 代替 `=`
- `!=` 写成 `NOT field:value`
- `in (a,b)` 写成 `field:(a OR b)`
- `>500` 写成 `:>500`

### Datadog

```
service:payment @latency:>500 status:error
-status:ok
service:(payment OR order)
```

与 Octopus 的差异：
- 内置字段用 `field:value`，自定义字段用 `@field:value`
- 空格 = AND（不写 AND）
- NOT 写成 `-field:value`
- `in` 写成 `field:(a OR b)`
- 内置字段：service, host, status, source, env, version, trace_id

### 阿里云 SLS

```
service: payment and level: error
service: payment or service: order
not level: debug
status > 400
status in (200, 201)
"connection refused"
```

接近 Octopus 语法，差异：
- 运算符小写（and/or/not）
- `:` 分隔 field 和 value（有空格）

---

## 查询策略

### 先宽后窄
1. 先用 `service + timerange` 查，看结果量
2. 结果太多 → 追加 `level = ERROR` 或缩短时间范围
3. 结果为空 → 检查字段名是否正确，放宽条件

### 构建复杂查询时用 qlint build
```bash
# 比手拼字符串更安全，自动处理引号和转义
qlint build -f "service=payment" -f "level!=INFO" -f "latency>500"
# → service=payment AND level!=INFO AND latency>500
```

### 值含特殊字符时
- 空格、括号、逗号、引号 → 用双引号包裹
- 值本身含双引号（如 JSON）→ 转义 `\"` 或用单引号包裹
- Base64 末尾的 `==` → 用双引号包裹

### 常见错误
- ❌ `service == payment` → 用 `=` 不是 `==`
- ❌ `service payment` → 缺运算符，应该写 `service = payment`
- ❌ `service = foo AND` → 尾部不完整
- ❌ `field regexp ".*"` → API 不支持 regexp
- ❌ `... | stats count(*)` → API 不支持管道，用聚合参数

---

## 与 octo-cli 配合（Octopus 用户）

```bash
# 1. 构建查询
QUERY=$(qlint build -f "service=payment" -f "level=ERROR")

# 2. 搜索日志
octo-cli logs search -q "$QUERY" -l 15m

# 3. 聚合统计（不要用管道语法，用 -a/-g 参数）
octo-cli logs aggregate -q "service = payment" -a "*:count" -g "level" -l 1h

# 4. 如果不确定语法对不对，先 validate
qlint validate "service = payment AND latency > 500"
```

## MCP Tools

安装到 Claude Code：
```bash
qlint mcp-install
```

Agent 自动获得 3 个工具：
- `qlint_validate` — 校验查询语法
- `qlint_build` — 从结构化条件生成查询
- `qlint_platforms` — 列出支持的平台
