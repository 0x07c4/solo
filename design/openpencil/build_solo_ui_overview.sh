#!/usr/bin/env bash
set -euo pipefail

id() {
  python3 -c 'import json,sys; print(json.load(sys.stdin)["nodeId"])'
}

insert() {
  local parent="$1"
  local json="$2"
  op insert --parent "$parent" "$json" | id
}

insert_quiet() {
  local parent="$1"
  local json="$2"
  op insert --parent "$parent" "$json" >/dev/null
}

clear_root() {
  op read-nodes root-frame --depth 1 | python3 -c '
import json, subprocess, sys
data = json.load(sys.stdin)
nodes = data.get("nodes", data if isinstance(data, list) else [])
root = nodes[0] if nodes else data
for child in root.get("children", []):
    node_id = child.get("id") or child.get("nodeId")
    if node_id:
        subprocess.run(["op", "delete", node_id], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
'
}

clear_root

op update root-frame '{"name":"Solo UI Overview · Workstream Cockpit","width":1920,"height":1180,"layout":"vertical","padding":[20,22],"gap":12,"fill":[{"type":"solid","color":"#151714"}]}' >/dev/null

TOPBAR=$(insert root-frame '{"type":"rectangle","name":"Topbar · Global Control Boundary","width":"fill_container","height":66,"layout":"horizontal","gap":12,"justifyContent":"space_between","alignItems":"center","padding":[10,14],"cornerRadius":16,"fill":[{"type":"solid","color":"#1e211c"}],"stroke":{"thickness":1,"fill":[{"type":"solid","color":"#3a3f35"}]}}')

BRAND=$(insert "$TOPBAR" '{"type":"frame","name":"Brand and Workspace","width":500,"height":"fill_container","layout":"horizontal","gap":14,"alignItems":"center"}')
insert_quiet "$BRAND" '{"type":"rectangle","name":"Solo Mark","width":42,"height":42,"cornerRadius":12,"fill":[{"type":"solid","color":"#3a2f19"}],"stroke":{"thickness":1,"fill":[{"type":"solid","color":"#d79921"}]}}'
TITLE_BLOCK=$(insert "$BRAND" '{"type":"frame","name":"Title Block","width":"fill_container","height":"fit_content","layout":"vertical","gap":2}')
insert_quiet "$TITLE_BLOCK" '{"type":"text","content":"solo / control plane","fontSize":15,"fontWeight":700,"fontFamily":"Noto Sans SC","fill":[{"type":"solid","color":"#e8e1d2"}]}'
insert_quiet "$TITLE_BLOCK" '{"type":"text","content":"workspace: ~/workspace/solo · branch: ui-ddd","fontSize":15,"fontFamily":"Noto Sans Mono CJK SC","fill":[{"type":"solid","color":"#8e8576"}]}'

HEALTH=$(insert "$TOPBAR" '{"type":"frame","name":"Global Health Cards","width":770,"height":"fill_container","layout":"horizontal","gap":10,"alignItems":"center","justifyContent":"center"}')

metric() {
  local parent="$1"
  local label="$2"
  local value="$3"
  local note="$4"
  local color="$5"
  local bg="$6"
  local card
  card=$(insert "$parent" "{\"type\":\"rectangle\",\"name\":\"Metric · $label\",\"width\":180,\"height\":46,\"layout\":\"vertical\",\"gap\":2,\"padding\":[7,10],\"cornerRadius\":10,\"fill\":[{\"type\":\"solid\",\"color\":\"$bg\"}],\"stroke\":{\"thickness\":1,\"fill\":[{\"type\":\"solid\",\"color\":\"#535a4d\"}]}}")
  insert_quiet "$card" "{\"type\":\"text\",\"content\":\"$label\",\"fontSize\":10,\"fontWeight\":700,\"fontFamily\":\"Noto Sans Mono CJK SC\",\"letterSpacing\":1.2,\"fill\":[{\"type\":\"solid\",\"color\":\"#c9bfae\"}]}"
  insert_quiet "$card" "{\"type\":\"text\",\"content\":\"$value  $note\",\"fontSize\":14,\"fontWeight\":700,\"fontFamily\":\"Noto Sans SC\",\"fill\":[{\"type\":\"solid\",\"color\":\"$color\"}]}"
}

pill() {
  local parent="$1"
  local name="$2"
  local width="$3"
  local height="$4"
  local content="$5"
  local bg="$6"
  local stroke="$7"
  local color="$8"
  local font_family="${9:-Noto Sans Mono CJK SC}"
  local font_size="${10:-12}"
  local node
  node=$(insert "$parent" "{\"type\":\"rectangle\",\"name\":\"$name\",\"width\":$width,\"height\":$height,\"layout\":\"horizontal\",\"justifyContent\":\"center\",\"alignItems\":\"center\",\"cornerRadius\":9,\"fill\":[{\"type\":\"solid\",\"color\":\"$bg\"}],\"stroke\":{\"thickness\":1,\"fill\":[{\"type\":\"solid\",\"color\":\"$stroke\"}]}}")
  insert_quiet "$node" "{\"type\":\"text\",\"content\":\"$content\",\"fontSize\":$font_size,\"fontWeight\":700,\"fontFamily\":\"$font_family\",\"fill\":[{\"type\":\"solid\",\"color\":\"$color\"}]}"
}

metric "$HEALTH" "WORKSTREAMS" "2 active" "/ 1 waiting" "#a9b665" "#29311d"
metric "$HEALTH" "EXCEPTIONS" "1 blocked" "/ needs review" "#ea6962" "#3a1f1d"
metric "$HEALTH" "RESOURCES" "3 bound" "/ 1 external" "#7daea3" "#1f3130"
metric "$HEALTH" "CHECKPOINTS" "2 pending" "/ approve" "#d8a657" "#3a2b18"

CONTROL=$(insert "$TOPBAR" '{"type":"frame","name":"Control Boundary","width":430,"height":"fill_container","layout":"horizontal","gap":8,"justifyContent":"end","alignItems":"center"}')
pill "$CONTROL" "Codex Auth" 106 36 "CODEX 已登录" "#262a23" "#535a4d" "#e8e1d2" "Noto Sans SC" 12
pill "$CONTROL" "Managed Badge" 124 36 "managed 2" "#29311d" "#a9b665" "#a9b665"
pill "$CONTROL" "Observe Only Badge" 142 36 "observe-only 1" "#1f3130" "#7daea3" "#7daea3"

BODY=$(insert root-frame '{"type":"frame","name":"Body · Three Column Cockpit","width":"fill_container","height":830,"layout":"horizontal","gap":12,"alignItems":"stretch"}')

LEFT=$(insert "$BODY" '{"type":"rectangle","name":"Left Rail · Object Navigation","width":292,"height":"fill_container","layout":"vertical","gap":12,"padding":12,"cornerRadius":18,"fill":[{"type":"solid","color":"#1e211c"}],"stroke":{"thickness":1,"fill":[{"type":"solid","color":"#3a3f35"}]}}')

section_title() {
  local parent="$1"
  local eyebrow="$2"
  local title="$3"
  local count="$4"
  local block
  block=$(insert "$parent" '{"type":"frame","name":"Section Title","width":"fill_container","height":"fit_content","layout":"horizontal","justifyContent":"space_between","alignItems":"end"}')
  local textblock
  textblock=$(insert "$block" '{"type":"frame","name":"Section Copy","layout":"vertical","gap":1,"width":"fit_content","height":"fit_content"}')
  insert_quiet "$textblock" "{\"type\":\"text\",\"content\":\"$eyebrow\",\"fontSize\":10,\"fontWeight\":700,\"fontFamily\":\"Noto Sans Mono CJK SC\",\"letterSpacing\":1.4,\"fill\":[{\"type\":\"solid\",\"color\":\"#8e8576\"}]}"
  insert_quiet "$textblock" "{\"type\":\"text\",\"content\":\"$title\",\"fontSize\":18,\"fontWeight\":700,\"fontFamily\":\"Noto Sans SC\",\"fill\":[{\"type\":\"solid\",\"color\":\"#e8e1d2\"}]}"
  insert_quiet "$block" "{\"type\":\"text\",\"content\":\"$count\",\"fontSize\":12,\"fontWeight\":700,\"fontFamily\":\"Noto Sans Mono CJK SC\",\"fill\":[{\"type\":\"solid\",\"color\":\"#c9bfae\"}]}"
}

section_title "$LEFT" "WORKSTREAMS" "任务流" "3"

workstream_card() {
  local parent="$1"
  local name="$2"
  local mode="$3"
  local meta="$4"
  local color="$5"
  local stroke="$6"
  local card
  card=$(insert "$parent" "{\"type\":\"rectangle\",\"name\":\"Workstream · $name\",\"width\":\"fill_container\",\"height\":112,\"layout\":\"horizontal\",\"gap\":10,\"padding\":10,\"cornerRadius\":13,\"fill\":[{\"type\":\"solid\",\"color\":\"#262a23\"}],\"stroke\":{\"thickness\":1,\"fill\":[{\"type\":\"solid\",\"color\":\"$stroke\"}]}}")
  insert_quiet "$card" "{\"type\":\"rectangle\",\"name\":\"State Bar\",\"width\":4,\"height\":\"fill_container\",\"cornerRadius\":99,\"fill\":[{\"type\":\"solid\",\"color\":\"$color\"}]}"
  local copy
  copy=$(insert "$card" '{"type":"frame","name":"Workstream Copy","width":"fill_container","height":"fill_container","layout":"vertical","gap":5}')
  insert_quiet "$copy" "{\"type\":\"text\",\"content\":\"$name\",\"fontSize\":14,\"fontWeight\":700,\"fontFamily\":\"Noto Sans SC\",\"lineHeight\":1.2,\"textGrowth\":\"fixed-width\",\"width\":\"fill_container\",\"fill\":[{\"type\":\"solid\",\"color\":\"#e8e1d2\"}]}"
  insert_quiet "$copy" "{\"type\":\"text\",\"content\":\"$mode\",\"fontSize\":11,\"fontWeight\":700,\"fontFamily\":\"Noto Sans Mono CJK SC\",\"fill\":[{\"type\":\"solid\",\"color\":\"$color\"}]}"
  insert_quiet "$copy" "{\"type\":\"text\",\"content\":\"$meta\",\"fontSize\":11,\"fontFamily\":\"Noto Sans Mono CJK SC\",\"lineHeight\":1.35,\"textGrowth\":\"fixed-width\",\"width\":\"fill_container\",\"fill\":[{\"type\":\"solid\",\"color\":\"#8e8576\"}]}"
}

workstream_card "$LEFT" "Solo UI redesign" "managed · active run" "2 tasks · 1 checkpoint · 4 artifacts" "#a9b665" "#a9b665"
workstream_card "$LEFT" "cocoa build supervision" "observe-only · external" "pid 3160996 · ~/workspace/cocoa" "#7daea3" "#7daea3"
workstream_card "$LEFT" "agent config cleanup" "waiting · user review" "1 task · blocked by decision" "#d8a657" "#535a4d"

section_title "$LEFT" "EXCEPTIONS" "异常收件箱" "1"
EXC=$(insert "$LEFT" '{"type":"rectangle","name":"Incident Card","width":"fill_container","height":88,"layout":"vertical","gap":5,"padding":10,"cornerRadius":13,"fill":[{"type":"solid","color":"#3a1f1d"}],"stroke":{"thickness":1,"fill":[{"type":"solid","color":"#ea6962"}]}}')
insert_quiet "$EXC" '{"type":"text","content":"BLOCKED · OpenPencil export","fontSize":15,"fontWeight":700,"fontFamily":"Noto Sans Mono CJK SC","fill":[{"type":"solid","color":"#ea6962"}]}'
insert_quiet "$EXC" '{"type":"text","content":"需要确认是否进入代码导出，避免把设计稿当生产实现。","fontSize":15,"fontFamily":"Noto Sans SC","lineHeight":1.35,"textGrowth":"fixed-width","width":"fill_container","fill":[{"type":"solid","color":"#e8e1d2"}]}'

section_title "$LEFT" "RESOURCES" "附加资源" "4"
RES=$(insert "$LEFT" '{"type":"rectangle","name":"Resource Stack","width":"fill_container","height":166,"layout":"vertical","gap":8,"padding":10,"cornerRadius":13,"fill":[{"type":"solid","color":"#203322"}],"stroke":{"thickness":1,"fill":[{"type":"solid","color":"#89b482"}]}}')
insert_quiet "$RES" '{"type":"text","content":"workspace solo · managed","fontSize":15,"fontWeight":700,"fontFamily":"Noto Sans Mono CJK SC","fill":[{"type":"solid","color":"#89b482"}]}'
insert_quiet "$RES" '{"type":"text","content":"OpenPencil canvas · artifact","fontSize":15,"fontFamily":"Noto Sans Mono CJK SC","fill":[{"type":"solid","color":"#c9bfae"}]}'
insert_quiet "$RES" '{"type":"text","content":"external codex · observe-only","fontSize":15,"fontWeight":700,"fontFamily":"Noto Sans Mono CJK SC","fill":[{"type":"solid","color":"#7daea3"}]}'
insert_quiet "$RES" '{"type":"text","content":"scope: src/App.css + design docs","fontSize":15,"fontFamily":"Noto Sans Mono CJK SC","textGrowth":"fixed-width","width":"fill_container","fill":[{"type":"solid","color":"#8e8576"}]}'

CENTER=$(insert "$BODY" '{"type":"rectangle","name":"Center · Workstream Cockpit","width":1084,"height":"fill_container","layout":"vertical","gap":12,"padding":14,"cornerRadius":18,"fill":[{"type":"solid","color":"#1e211c"}],"stroke":{"thickness":1,"fill":[{"type":"solid","color":"#3a3f35"}]}}')

HEADER=$(insert "$CENTER" '{"type":"rectangle","name":"Workstream Header","width":"fill_container","height":154,"layout":"vertical","gap":12,"padding":16,"cornerRadius":16,"fill":[{"type":"solid","color":"#262a23"}],"stroke":{"thickness":1,"fill":[{"type":"solid","color":"#535a4d"}]}}')
H_COPY=$(insert "$HEADER" '{"type":"frame","name":"Header Copy","width":"fill_container","height":"fit_content","layout":"vertical","gap":6}')
insert_quiet "$H_COPY" '{"type":"text","content":"WORKSTREAM COCKPIT","fontSize":15,"fontWeight":700,"fontFamily":"Noto Sans Mono CJK SC","letterSpacing":1.5,"fill":[{"type":"solid","color":"#d79921"}]}'
insert_quiet "$H_COPY" '{"type":"text","content":"Solo UI redesign · Signal Workshop","fontSize":24,"fontWeight":700,"fontFamily":"Noto Sans SC","fill":[{"type":"solid","color":"#e8e1d2"}]}'
insert_quiet "$H_COPY" '{"type":"text","content":"当前目标：从 chat-first 收束为可监督、可介入、可追溯的 workstream cockpit。","fontSize":15,"fontFamily":"Noto Sans SC","lineHeight":1.35,"textGrowth":"fixed-width","width":"fill_container","fill":[{"type":"solid","color":"#c9bfae"}]}'

HEADER_METRICS=$(insert "$HEADER" '{"type":"frame","name":"Workstream Header Metrics","width":"fill_container","height":46,"layout":"horizontal","gap":10,"alignItems":"center"}')
metric "$HEADER_METRICS" "CURRENT RUN" "active" "/ design" "#a9b665" "#29311d"
metric "$HEADER_METRICS" "NEXT INTENT" "overview" "/ approve" "#d8a657" "#3a2b18"
metric "$HEADER_METRICS" "ARTIFACTS" "3" "/ design" "#89b482" "#203322"

MID=$(insert "$CENTER" '{"type":"frame","name":"Cockpit Middle","width":"fill_container","height":500,"layout":"horizontal","gap":12}')

BOARD=$(insert "$MID" '{"type":"rectangle","name":"Task Board","width":412,"height":"fill_container","layout":"vertical","gap":10,"padding":14,"cornerRadius":16,"fill":[{"type":"solid","color":"#262a23"}],"stroke":{"thickness":1,"fill":[{"type":"solid","color":"#3a3f35"}]}}')
insert_quiet "$BOARD" '{"type":"text","content":"TASK BOARD / 任务治理","fontSize":15,"fontWeight":700,"fontFamily":"Noto Sans Mono CJK SC","letterSpacing":1.1,"fill":[{"type":"solid","color":"#c9bfae"}]}'

task_lane() {
  local parent="$1"
  local title="$2"
  local count="$3"
  local color="$4"
  local lane
  lane=$(insert "$parent" "{\"type\":\"rectangle\",\"name\":\"Lane · $title\",\"width\":\"fill_container\",\"height\":132,\"layout\":\"vertical\",\"gap\":8,\"padding\":10,\"cornerRadius\":12,\"fill\":[{\"type\":\"solid\",\"color\":\"#1e211c\"}],\"stroke\":{\"thickness\":1,\"fill\":[{\"type\":\"solid\",\"color\":\"#3a3f35\"}]}}")
  insert_quiet "$lane" "{\"type\":\"text\",\"content\":\"$title  $count\",\"fontSize\":11,\"fontWeight\":700,\"fontFamily\":\"Noto Sans Mono CJK SC\",\"fill\":[{\"type\":\"solid\",\"color\":\"$color\"}]}"
  echo "$lane"
}

IN_PROGRESS=$(task_lane "$BOARD" "IN PROGRESS" "1" "#a9b665")
insert_quiet "$IN_PROGRESS" '{"type":"text","content":"OpenPencil overview 主屏","fontSize":15,"fontWeight":700,"fontFamily":"Noto Sans SC","fill":[{"type":"solid","color":"#e8e1d2"}]}'
insert_quiet "$IN_PROGRESS" '{"type":"text","content":"状态：正在生成设计稿 · managed","fontSize":15,"fontFamily":"Noto Sans Mono CJK SC","fill":[{"type":"solid","color":"#8e8576"}]}'
WAITING=$(task_lane "$BOARD" "WAITING APPROVAL" "2" "#d8a657")
insert_quiet "$WAITING" '{"type":"text","content":"确认 ops-dark + layout","fontSize":15,"fontWeight":700,"fontFamily":"Noto Sans SC","fill":[{"type":"solid","color":"#e8e1d2"}]}'
insert_quiet "$WAITING" '{"type":"text","content":"下一步：是否进入 App.css token","fontSize":15,"fontFamily":"Noto Sans Mono CJK SC","fill":[{"type":"solid","color":"#8e8576"}]}'
DONE=$(task_lane "$BOARD" "DONE" "1" "#89b482")
insert_quiet "$DONE" '{"type":"text","content":"DDD 裁决文档","fontSize":15,"fontWeight":700,"fontFamily":"Noto Sans SC","fill":[{"type":"solid","color":"#e8e1d2"}]}'
insert_quiet "$DONE" '{"type":"text","content":"design/solo-ui-ddd.md","fontSize":15,"fontFamily":"Noto Sans Mono CJK SC","fill":[{"type":"solid","color":"#8e8576"}]}'

RUN=$(insert "$MID" '{"type":"rectangle","name":"Active Run and Timeline","width":"fill_container","height":"fill_container","layout":"vertical","gap":12,"padding":14,"cornerRadius":16,"fill":[{"type":"solid","color":"#262a23"}],"stroke":{"thickness":1,"fill":[{"type":"solid","color":"#3a3f35"}]}}')
insert_quiet "$RUN" '{"type":"text","content":"ACTIVE RUN / Run 监督","fontSize":15,"fontWeight":700,"fontFamily":"Noto Sans Mono CJK SC","letterSpacing":1.1,"fill":[{"type":"solid","color":"#c9bfae"}]}'

RUN_SUMMARY=$(insert "$RUN" '{"type":"rectangle","name":"Run Summary","width":"fill_container","height":92,"layout":"horizontal","gap":12,"padding":12,"cornerRadius":12,"fill":[{"type":"solid","color":"#29311d"}],"stroke":{"thickness":1,"fill":[{"type":"solid","color":"#a9b665"}]}}')
insert_quiet "$RUN_SUMMARY" '{"type":"rectangle","name":"Run State Bar","width":4,"height":"fill_container","cornerRadius":99,"fill":[{"type":"solid","color":"#a9b665"}]}'
RUN_COPY=$(insert "$RUN_SUMMARY" '{"type":"frame","name":"Run Summary Copy","width":"fill_container","height":"fill_container","layout":"vertical","gap":5}')
insert_quiet "$RUN_COPY" '{"type":"text","content":"managed codex · generating OpenPencil artifact","fontSize":15,"fontWeight":700,"fontFamily":"Noto Sans SC","fill":[{"type":"solid","color":"#e8e1d2"}]}'
insert_quiet "$RUN_COPY" '{"type":"text","content":"next intent: save overview .op, then wait for visual approval before code changes","fontSize":15,"fontFamily":"Noto Sans Mono CJK SC","textGrowth":"fixed-width","width":"fill_container","fill":[{"type":"solid","color":"#c9bfae"}]}'

timeline_row() {
  local parent="$1"
  local type="$2"
  local title="$3"
  local meta="$4"
  local color="$5"
  local row
  row=$(insert "$parent" "{\"type\":\"rectangle\",\"name\":\"Timeline · $type\",\"width\":\"fill_container\",\"height\":58,\"layout\":\"horizontal\",\"gap\":10,\"padding\":[8,10],\"cornerRadius\":10,\"fill\":[{\"type\":\"solid\",\"color\":\"#1e211c\"}],\"stroke\":{\"thickness\":1,\"fill\":[{\"type\":\"solid\",\"color\":\"#3a3f35\"}]}}")
  insert_quiet "$row" "{\"type\":\"rectangle\",\"name\":\"Event Dot\",\"width\":8,\"height\":8,\"cornerRadius\":99,\"fill\":[{\"type\":\"solid\",\"color\":\"$color\"}]}"
  local rowcopy
  rowcopy=$(insert "$row" '{"type":"frame","name":"Event Copy","width":"fill_container","height":"fit_content","layout":"vertical","gap":3}')
  insert_quiet "$rowcopy" "{\"type\":\"text\",\"content\":\"$type · $title\",\"fontSize\":12,\"fontWeight\":700,\"fontFamily\":\"Noto Sans SC\",\"fill\":[{\"type\":\"solid\",\"color\":\"#e8e1d2\"}]}"
  insert_quiet "$rowcopy" "{\"type\":\"text\",\"content\":\"$meta\",\"fontSize\":11,\"fontFamily\":\"Noto Sans Mono CJK SC\",\"textGrowth\":\"fixed-width\",\"width\":\"fill_container\",\"fill\":[{\"type\":\"solid\",\"color\":\"#8e8576\"}]}"
}

timeline_row "$RUN" "summary" "DDD decisions consolidated" "design/solo-ui-ddd.md · chair decision" "#89b482"
timeline_row "$RUN" "command" "build overview canvas" "op insert/update · live OpenPencil canvas" "#a9b665"
timeline_row "$RUN" "checkpoint" "Visual approval required" "approve layout + color before App.css token phase" "#d8a657"
timeline_row "$RUN" "resource" "External Codex observed" "~/workspace/cocoa · observe-only · no controls" "#7daea3"
timeline_row "$RUN" "exception" "Export not production-ready" "code export blocked until design is coherent" "#ea6962"

ARTIFACTS=$(insert "$CENTER" '{"type":"rectangle","name":"Artifact Strip","width":"fill_container","height":146,"layout":"vertical","gap":10,"padding":14,"cornerRadius":16,"fill":[{"type":"solid","color":"#262a23"}],"stroke":{"thickness":1,"fill":[{"type":"solid","color":"#3a3f35"}]}}')
insert_quiet "$ARTIFACTS" '{"type":"text","content":"ARTIFACTS","fontSize":15,"fontWeight":700,"fontFamily":"Noto Sans Mono CJK SC","letterSpacing":1.2,"fill":[{"type":"solid","color":"#8e8576"}]}'
ARTIFACT_ROW=$(insert "$ARTIFACTS" '{"type":"frame","name":"Artifact Cards Row","width":"fill_container","height":"fill_container","layout":"horizontal","gap":10,"alignItems":"stretch"}')
artifact_card() {
  local parent="$1"
  local title="$2"
  local meta="$3"
  local color="$4"
  local card
  card=$(insert "$parent" "{\"type\":\"rectangle\",\"name\":\"Artifact · $title\",\"width\":238,\"height\":\"fill_container\",\"layout\":\"vertical\",\"gap\":5,\"padding\":11,\"cornerRadius\":12,\"fill\":[{\"type\":\"solid\",\"color\":\"#1e211c\"}],\"stroke\":{\"thickness\":1,\"fill\":[{\"type\":\"solid\",\"color\":\"$color\"}]}}")
  insert_quiet "$card" "{\"type\":\"text\",\"content\":\"$title\",\"fontSize\":13,\"fontWeight\":700,\"fontFamily\":\"Noto Sans SC\",\"fill\":[{\"type\":\"solid\",\"color\":\"#e8e1d2\"}]}"
  insert_quiet "$card" "{\"type\":\"text\",\"content\":\"$meta\",\"fontSize\":11,\"fontFamily\":\"Noto Sans Mono CJK SC\",\"lineHeight\":1.35,\"textGrowth\":\"fixed-width\",\"width\":\"fill_container\",\"fill\":[{\"type\":\"solid\",\"color\":\"#8e8576\"}]}"
}
artifact_card "$ARTIFACT_ROW" "DDD Document" "design/solo-ui-ddd.md" "#89b482"
artifact_card "$ARTIFACT_ROW" "OpenPencil Overview" "design/openpencil/solo-ui-overview.op" "#7daea3"
artifact_card "$ARTIFACT_ROW" "Token Draft" "ops-dark semantic map" "#d79921"
artifact_card "$ARTIFACT_ROW" "Implementation Plan" "App.css first · no runtime change" "#d8a657"

INSPECTOR=$(insert "$BODY" '{"type":"rectangle","name":"Inspector · Evidence Layer","width":470,"height":"fill_container","layout":"vertical","gap":12,"padding":14,"cornerRadius":18,"fill":[{"type":"solid","color":"#1e211c"}],"stroke":{"thickness":1,"fill":[{"type":"solid","color":"#3a3f35"}]}}')
insert_quiet "$INSPECTOR" '{"type":"text","content":"INSPECTOR / 按需证据层","fontSize":15,"fontWeight":700,"fontFamily":"Noto Sans Mono CJK SC","letterSpacing":1.2,"fill":[{"type":"solid","color":"#c9bfae"}]}'

TABS=$(insert "$INSPECTOR" '{"type":"frame","name":"Inspector Tabs","width":"fill_container","height":38,"layout":"horizontal","gap":8}')
pill "$TABS" "Tab Evidence" 104 34 "Evidence" "#3a2f19" "#d79921" "#d79921"
pill "$TABS" "Tab Files" 78 34 "Files" "#262a23" "#3a3f35" "#8e8576"
pill "$TABS" "Tab Resources" 116 34 "Resources" "#262a23" "#3a3f35" "#8e8576"

CHECKPOINT=$(insert "$INSPECTOR" '{"type":"rectangle","name":"Checkpoint Card","width":"fill_container","height":178,"layout":"vertical","gap":9,"padding":14,"cornerRadius":14,"fill":[{"type":"solid","color":"#3a2b18"}],"stroke":{"thickness":1,"fill":[{"type":"solid","color":"#d8a657"}]}}')
insert_quiet "$CHECKPOINT" '{"type":"text","content":"CHECKPOINT · 需要用户确认","fontSize":15,"fontWeight":700,"fontFamily":"Noto Sans Mono CJK SC","letterSpacing":1.1,"fill":[{"type":"solid","color":"#d8a657"}]}'
insert_quiet "$CHECKPOINT" '{"type":"text","content":"是否接受 Workstream Cockpit + ops-dark 作为第一版整体方向？","fontSize":16,"fontWeight":700,"fontFamily":"Noto Sans SC","lineHeight":1.3,"textGrowth":"fixed-width","width":"fill_container","fill":[{"type":"solid","color":"#e8e1d2"}]}'
insert_quiet "$CHECKPOINT" '{"type":"text","content":"影响：下一步会进入 App.css token layer，不改 runtime。","fontSize":15,"fontFamily":"Noto Sans SC","lineHeight":1.4,"textGrowth":"fixed-width","width":"fill_container","fill":[{"type":"solid","color":"#c9bfae"}]}'

BTNS=$(insert "$CHECKPOINT" '{"type":"frame","name":"Checkpoint Actions","width":"fill_container","height":36,"layout":"horizontal","gap":8}')
pill "$BTNS" "Approve" 88 34 "Approve" "#d79921" "#d79921" "#151714"
pill "$BTNS" "Revise" 78 34 "Revise" "#262a23" "#535a4d" "#e8e1d2"
pill "$BTNS" "Inspect" 86 34 "Inspect" "#262a23" "#535a4d" "#c9bfae"

EVIDENCE=$(insert "$INSPECTOR" '{"type":"rectangle","name":"Evidence Details","width":"fill_container","height":196,"layout":"vertical","gap":8,"padding":12,"cornerRadius":14,"fill":[{"type":"solid","color":"#262a23"}],"stroke":{"thickness":1,"fill":[{"type":"solid","color":"#3a3f35"}]}}')
insert_quiet "$EVIDENCE" '{"type":"text","content":"Evidence Summary","fontSize":15,"fontWeight":700,"fontFamily":"Noto Sans SC","fill":[{"type":"solid","color":"#e8e1d2"}]}'
insert_quiet "$EVIDENCE" '{"type":"text","content":"1. DDD 裁决：Workstream Cockpit\\n2. 视觉系统：Signal Workshop / ops-dark\\n3. 工程路径：App.css token first\\n4. 控制边界：observe-only disabled controls","fontSize":15,"fontFamily":"Noto Sans Mono CJK SC","lineHeight":1.55,"textGrowth":"fixed-width","width":"fill_container","fill":[{"type":"solid","color":"#c9bfae"}]}'

RESOURCE_DETAIL=$(insert "$INSPECTOR" '{"type":"rectangle","name":"External Resource Detail","width":"fill_container","height":166,"layout":"vertical","gap":8,"padding":12,"cornerRadius":14,"fill":[{"type":"solid","color":"#1f3130"}],"stroke":{"thickness":1,"fill":[{"type":"solid","color":"#7daea3"}]}}')
insert_quiet "$RESOURCE_DETAIL" '{"type":"text","content":"EXTERNAL CODEX · observe-only","fontSize":15,"fontWeight":700,"fontFamily":"Noto Sans Mono CJK SC","letterSpacing":1.1,"fill":[{"type":"solid","color":"#7daea3"}]}'
insert_quiet "$RESOURCE_DETAIL" '{"type":"text","content":"workspace: ~/workspace/cocoa\\npid: 3160996\\nstate: running\\ncontrols: disabled · can convert to local task","fontSize":15,"fontFamily":"Noto Sans Mono CJK SC","lineHeight":1.5,"textGrowth":"fixed-width","width":"fill_container","fill":[{"type":"solid","color":"#c9bfae"}]}'

COMMAND=$(insert root-frame '{"type":"rectangle","name":"Command Bar · State-Aware Control","width":"fill_container","height":118,"layout":"horizontal","gap":14,"alignItems":"center","padding":14,"cornerRadius":18,"fill":[{"type":"solid","color":"#1e211c"}],"stroke":{"thickness":1,"fill":[{"type":"solid","color":"#3a3f35"}]}}')

CMD_LABEL=$(insert "$COMMAND" '{"type":"frame","name":"Command Label","width":250,"height":"fill_container","layout":"vertical","gap":5,"justifyContent":"center"}')
insert_quiet "$CMD_LABEL" '{"type":"text","content":"COMMAND BAR","fontSize":15,"fontWeight":700,"fontFamily":"Noto Sans Mono CJK SC","letterSpacing":1.3,"fill":[{"type":"solid","color":"#8e8576"}]}'
insert_quiet "$CMD_LABEL" '{"type":"text","content":"目标 / 干预 / 审批","fontSize":18,"fontWeight":700,"fontFamily":"Noto Sans SC","fill":[{"type":"solid","color":"#e8e1d2"}]}'
insert_quiet "$CMD_LABEL" '{"type":"text","content":"state: waiting approval","fontSize":15,"fontFamily":"Noto Sans Mono CJK SC","fill":[{"type":"solid","color":"#d8a657"}]}'

CMD_INPUT=$(insert "$COMMAND" '{"type":"rectangle","name":"Stateful Command Input","width":"fill_container","height":82,"layout":"vertical","gap":8,"padding":12,"cornerRadius":14,"fill":[{"type":"solid","color":"#262a23"}],"stroke":{"thickness":1,"fill":[{"type":"solid","color":"#535a4d"}]}}')
insert_quiet "$CMD_INPUT" '{"type":"text","content":"等待确认：接受 overview 方向后，进入 App.css token layer。你也可以要求调整信息密度、色彩或布局。","fontSize":15,"fontFamily":"Noto Sans SC","lineHeight":1.45,"textGrowth":"fixed-width","width":"fill_container","fill":[{"type":"solid","color":"#c9bfae"}]}'
insert_quiet "$CMD_INPUT" '{"type":"text","content":"Enter: send · Shift+Enter: newline · Cmd+K: command palette","fontSize":15,"fontFamily":"Noto Sans Mono CJK SC","fill":[{"type":"solid","color":"#6f675c"}]}'

CMD_ACTIONS=$(insert "$COMMAND" '{"type":"frame","name":"Command Actions","width":390,"height":"fill_container","layout":"horizontal","gap":10,"justifyContent":"end","alignItems":"center"}')
pill "$CMD_ACTIONS" "Approve Direction" 120 44 "批准方向" "#d79921" "#d79921" "#151714" "Noto Sans SC" 14
pill "$CMD_ACTIONS" "Revise Direction" 116 44 "调整设计" "#262a23" "#535a4d" "#e8e1d2" "Noto Sans SC" 14
pill "$CMD_ACTIONS" "Pause Run" 96 44 "暂停" "#3a1f1d" "#ea6962" "#ea6962" "Noto Sans SC" 14

op design:refine --root-id root-frame >/dev/null || true
op save design/openpencil/solo-ui-overview.op >/dev/null

echo "Saved design/openpencil/solo-ui-overview.op"
