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

pill() {
  local parent="$1"
  local name="$2"
  local width="$3"
  local height="$4"
  local content="$5"
  local bg="$6"
  local stroke="$7"
  local color="$8"
  local node
  node=$(insert "$parent" "{\"type\":\"rectangle\",\"name\":\"$name\",\"width\":$width,\"height\":$height,\"layout\":\"horizontal\",\"justifyContent\":\"center\",\"alignItems\":\"center\",\"cornerRadius\":9,\"fill\":[{\"type\":\"solid\",\"color\":\"$bg\"}],\"stroke\":{\"thickness\":1,\"fill\":[{\"type\":\"solid\",\"color\":\"$stroke\"}]}}")
  insert_quiet "$node" "{\"type\":\"text\",\"content\":\"$content\",\"fontSize\":13,\"fontWeight\":700,\"fontFamily\":\"Noto Sans SC\",\"fill\":[{\"type\":\"solid\",\"color\":\"$color\"}]}"
}

metric_chip() {
  local parent="$1"
  local label="$2"
  local value="$3"
  local bg="$4"
  local color="$5"
  local width="${6:-142}"
  local card
  card=$(insert "$parent" "{\"type\":\"rectangle\",\"name\":\"Status · $label\",\"width\":$width,\"height\":38,\"layout\":\"horizontal\",\"gap\":8,\"justifyContent\":\"center\",\"alignItems\":\"center\",\"padding\":[0,10],\"cornerRadius\":10,\"fill\":[{\"type\":\"solid\",\"color\":\"$bg\"}],\"stroke\":{\"thickness\":1,\"fill\":[{\"type\":\"solid\",\"color\":\"#535a4d\"}]}}")
  insert_quiet "$card" "{\"type\":\"text\",\"content\":\"$label\",\"fontSize\":11,\"fontWeight\":700,\"fontFamily\":\"Noto Sans Mono CJK SC\",\"letterSpacing\":1.0,\"fill\":[{\"type\":\"solid\",\"color\":\"#8e8576\"}]}"
  insert_quiet "$card" "{\"type\":\"text\",\"content\":\"$value\",\"fontSize\":15,\"fontWeight\":700,\"fontFamily\":\"Noto Sans SC\",\"fill\":[{\"type\":\"solid\",\"color\":\"$color\"}]}"
}

event_row() {
  local parent="$1"
  local time="$2"
  local title="$3"
  local state="$4"
  local dot="$5"
  local row
  row=$(insert "$parent" "{\"type\":\"rectangle\",\"name\":\"Event · $title\",\"width\":\"fill_container\",\"height\":54,\"layout\":\"horizontal\",\"gap\":10,\"alignItems\":\"center\",\"padding\":[8,10],\"cornerRadius\":10,\"fill\":[{\"type\":\"solid\",\"color\":\"#1e211c\"}],\"stroke\":{\"thickness\":1,\"fill\":[{\"type\":\"solid\",\"color\":\"#3a3f35\"}]}}")
  insert_quiet "$row" "{\"type\":\"rectangle\",\"name\":\"Event Dot\",\"width\":8,\"height\":8,\"cornerRadius\":99,\"fill\":[{\"type\":\"solid\",\"color\":\"$dot\"}]}"
  insert_quiet "$row" "{\"type\":\"text\",\"content\":\"$time\",\"fontSize\":12,\"fontFamily\":\"Noto Sans Mono CJK SC\",\"fill\":[{\"type\":\"solid\",\"color\":\"#6f675c\"}]}"
  local copy
  copy=$(insert "$row" '{"type":"frame","name":"Event Copy","width":"fill_container","height":"fit_content","layout":"horizontal","gap":8,"alignItems":"center"}')
  insert_quiet "$copy" "{\"type\":\"text\",\"content\":\"$title\",\"fontSize\":14,\"fontWeight\":700,\"fontFamily\":\"Noto Sans SC\",\"fill\":[{\"type\":\"solid\",\"color\":\"#e8e1d2\"}]}"
  insert_quiet "$copy" "{\"type\":\"text\",\"content\":\"$state\",\"fontSize\":12,\"fontFamily\":\"Noto Sans Mono CJK SC\",\"fill\":[{\"type\":\"solid\",\"color\":\"#8e8576\"}]}"
}

output_tile() {
  local parent="$1"
  local title="$2"
  local kind="$3"
  local color="$4"
  local tile
  tile=$(insert "$parent" "{\"type\":\"rectangle\",\"name\":\"Output · $title\",\"width\":230,\"height\":\"fill_container\",\"layout\":\"vertical\",\"gap\":4,\"padding\":11,\"cornerRadius\":12,\"fill\":[{\"type\":\"solid\",\"color\":\"#1e211c\"}],\"stroke\":{\"thickness\":1,\"fill\":[{\"type\":\"solid\",\"color\":\"$color\"}]}}")
  insert_quiet "$tile" "{\"type\":\"text\",\"content\":\"$title\",\"fontSize\":14,\"fontWeight\":700,\"fontFamily\":\"Noto Sans SC\",\"fill\":[{\"type\":\"solid\",\"color\":\"#e8e1d2\"}]}"
  insert_quiet "$tile" "{\"type\":\"text\",\"content\":\"$kind\",\"fontSize\":12,\"fontFamily\":\"Noto Sans Mono CJK SC\",\"fill\":[{\"type\":\"solid\",\"color\":\"#8e8576\"}]}"
}

clear_root

op update root-frame '{"name":"Solo UI Overview v2 · Runtime UI","width":1920,"height":1080,"layout":"vertical","padding":[20,24],"gap":12,"fill":[{"type":"solid","color":"#151714"}]}' >/dev/null

TOPBAR=$(insert root-frame '{"type":"rectangle","name":"TopStatusBar","width":"fill_container","height":62,"layout":"horizontal","gap":12,"justifyContent":"space_between","alignItems":"center","padding":[9,14],"cornerRadius":16,"fill":[{"type":"solid","color":"#1e211c"}],"stroke":{"thickness":1,"fill":[{"type":"solid","color":"#3a3f35"}]}}')

BRAND=$(insert "$TOPBAR" '{"type":"frame","name":"Workspace Identity","width":560,"height":"fill_container","layout":"horizontal","gap":12,"alignItems":"center"}')
insert_quiet "$BRAND" '{"type":"rectangle","name":"Solo Mark","width":40,"height":40,"cornerRadius":12,"fill":[{"type":"solid","color":"#3a2f19"}],"stroke":{"thickness":1,"fill":[{"type":"solid","color":"#d79921"}]}}'
BRAND_COPY=$(insert "$BRAND" '{"type":"frame","name":"Workspace Copy","width":"fill_container","height":"fit_content","layout":"vertical","gap":2}')
insert_quiet "$BRAND_COPY" '{"type":"text","content":"solo / control plane","fontSize":15,"fontWeight":700,"fontFamily":"Noto Sans SC","fill":[{"type":"solid","color":"#e8e1d2"}]}'
insert_quiet "$BRAND_COPY" '{"type":"text","content":"~/workspace/solo · ui-ddd","fontSize":12,"fontFamily":"Noto Sans Mono CJK SC","fill":[{"type":"solid","color":"#8e8576"}]}'

CONTROL=$(insert "$TOPBAR" '{"type":"frame","name":"Control Boundary","width":430,"height":"fill_container","layout":"horizontal","gap":8,"justifyContent":"end","alignItems":"center"}')
pill "$CONTROL" "Codex Auth" 110 34 "Codex Login" "#262a23" "#535a4d" "#e8e1d2"
pill "$CONTROL" "Managed" 106 34 "managed" "#29311d" "#a9b665" "#a9b665"
pill "$CONTROL" "Observe Only" 124 34 "observe-only" "#1f3130" "#7daea3" "#7daea3"

BODY=$(insert root-frame '{"type":"frame","name":"AppShell Body","width":"fill_container","height":850,"layout":"horizontal","gap":12,"alignItems":"stretch"}')

LEFT=$(insert "$BODY" '{"type":"rectangle","name":"WorkstreamRail","width":300,"height":"fill_container","layout":"vertical","gap":12,"padding":12,"cornerRadius":18,"fill":[{"type":"solid","color":"#1e211c"}],"stroke":{"thickness":1,"fill":[{"type":"solid","color":"#3a3f35"}]}}')
RAIL_HEAD=$(insert "$LEFT" '{"type":"frame","name":"Rail Header","width":"fill_container","height":"fit_content","layout":"horizontal","justifyContent":"space_between","alignItems":"end"}')
insert_quiet "$RAIL_HEAD" '{"type":"text","content":"Workstreams","fontSize":20,"fontWeight":700,"fontFamily":"Noto Sans SC","fill":[{"type":"solid","color":"#e8e1d2"}]}'
insert_quiet "$RAIL_HEAD" '{"type":"text","content":"3","fontSize":13,"fontWeight":700,"fontFamily":"Noto Sans Mono CJK SC","fill":[{"type":"solid","color":"#8e8576"}]}'

workstream_card() {
  local parent="$1"
  local title="$2"
  local state="$3"
  local meta="$4"
  local color="$5"
  local card
  card=$(insert "$parent" "{\"type\":\"rectangle\",\"name\":\"Workstream · $title\",\"width\":\"fill_container\",\"height\":94,\"layout\":\"horizontal\",\"gap\":10,\"padding\":10,\"cornerRadius\":13,\"fill\":[{\"type\":\"solid\",\"color\":\"#262a23\"}],\"stroke\":{\"thickness\":1,\"fill\":[{\"type\":\"solid\",\"color\":\"$color\"}]}}")
  insert_quiet "$card" "{\"type\":\"rectangle\",\"name\":\"State Bar\",\"width\":4,\"height\":\"fill_container\",\"cornerRadius\":99,\"fill\":[{\"type\":\"solid\",\"color\":\"$color\"}]}"
  local copy
  copy=$(insert "$card" '{"type":"frame","name":"Workstream Copy","width":"fill_container","height":"fill_container","layout":"vertical","gap":5}')
  insert_quiet "$copy" "{\"type\":\"text\",\"content\":\"$title\",\"fontSize\":14,\"fontWeight\":700,\"fontFamily\":\"Noto Sans SC\",\"fill\":[{\"type\":\"solid\",\"color\":\"#e8e1d2\"}]}"
  insert_quiet "$copy" "{\"type\":\"text\",\"content\":\"$state\",\"fontSize\":12,\"fontWeight\":700,\"fontFamily\":\"Noto Sans Mono CJK SC\",\"fill\":[{\"type\":\"solid\",\"color\":\"$color\"}]}"
  insert_quiet "$copy" "{\"type\":\"text\",\"content\":\"$meta\",\"fontSize\":12,\"fontFamily\":\"Noto Sans Mono CJK SC\",\"fill\":[{\"type\":\"solid\",\"color\":\"#8e8576\"}]}"
}

workstream_card "$LEFT" "Solo UI redesign" "managed · Checkpoint 02" "active" "#a9b665"
workstream_card "$LEFT" "cocoa build supervision" "observe-only" "external run" "#7daea3"
workstream_card "$LEFT" "agent config cleanup" "waiting review" "1 blocked task" "#d8a657"

EXC_TITLE=$(insert "$LEFT" '{"type":"frame","name":"Exception Header","width":"fill_container","height":"fit_content","layout":"horizontal","justifyContent":"space_between","alignItems":"end"}')
insert_quiet "$EXC_TITLE" '{"type":"text","content":"Exceptions","fontSize":16,"fontWeight":700,"fontFamily":"Noto Sans SC","fill":[{"type":"solid","color":"#e8e1d2"}]}'
insert_quiet "$EXC_TITLE" '{"type":"text","content":"1","fontSize":12,"fontWeight":700,"fontFamily":"Noto Sans Mono CJK SC","fill":[{"type":"solid","color":"#ea6962"}]}'
EXC=$(insert "$LEFT" '{"type":"rectangle","name":"Exception Compact","width":"fill_container","height":76,"layout":"vertical","gap":4,"padding":10,"cornerRadius":13,"fill":[{"type":"solid","color":"#3a1f1d"}],"stroke":{"thickness":1,"fill":[{"type":"solid","color":"#ea6962"}]}}')
insert_quiet "$EXC" '{"type":"text","content":"BLOCKED · OpenPencil export","fontSize":12,"fontWeight":700,"fontFamily":"Noto Sans Mono CJK SC","fill":[{"type":"solid","color":"#ea6962"}]}'
insert_quiet "$EXC" '{"type":"text","content":"code export paused","fontSize":13,"fontFamily":"Noto Sans SC","fill":[{"type":"solid","color":"#e8e1d2"}]}'

RES_TITLE=$(insert "$LEFT" '{"type":"frame","name":"Resources Header","width":"fill_container","height":"fit_content","layout":"horizontal","justifyContent":"space_between","alignItems":"end"}')
insert_quiet "$RES_TITLE" '{"type":"text","content":"Resources","fontSize":16,"fontWeight":700,"fontFamily":"Noto Sans SC","fill":[{"type":"solid","color":"#e8e1d2"}]}'
insert_quiet "$RES_TITLE" '{"type":"text","content":"4","fontSize":12,"fontWeight":700,"fontFamily":"Noto Sans Mono CJK SC","fill":[{"type":"solid","color":"#89b482"}]}'
RES=$(insert "$LEFT" '{"type":"rectangle","name":"Resource Compact","width":"fill_container","height":124,"layout":"vertical","gap":8,"padding":10,"cornerRadius":13,"fill":[{"type":"solid","color":"#203322"}],"stroke":{"thickness":1,"fill":[{"type":"solid","color":"#89b482"}]}}')
insert_quiet "$RES" '{"type":"text","content":"workspace solo · managed","fontSize":12,"fontWeight":700,"fontFamily":"Noto Sans Mono CJK SC","fill":[{"type":"solid","color":"#89b482"}]}'
insert_quiet "$RES" '{"type":"text","content":"external codex · observe-only","fontSize":12,"fontWeight":700,"fontFamily":"Noto Sans Mono CJK SC","fill":[{"type":"solid","color":"#7daea3"}]}'
insert_quiet "$RES" '{"type":"text","content":"+2 more","fontSize":12,"fontFamily":"Noto Sans Mono CJK SC","fill":[{"type":"solid","color":"#8e8576"}]}'

CENTER=$(insert "$BODY" '{"type":"rectangle","name":"WorkstreamCockpit","width":1118,"height":"fill_container","layout":"vertical","gap":12,"padding":14,"cornerRadius":18,"fill":[{"type":"solid","color":"#1e211c"}],"stroke":{"thickness":1,"fill":[{"type":"solid","color":"#3a3f35"}]}}')

TASK=$(insert "$CENTER" '{"type":"rectangle","name":"CurrentTask","width":"fill_container","height":122,"layout":"horizontal","gap":16,"alignItems":"center","padding":16,"cornerRadius":16,"fill":[{"type":"solid","color":"#262a23"}],"stroke":{"thickness":1,"fill":[{"type":"solid","color":"#535a4d"}]}}')
TASK_COPY=$(insert "$TASK" '{"type":"frame","name":"Current Task Copy","width":610,"height":"fit_content","layout":"vertical","gap":5}')
insert_quiet "$TASK_COPY" '{"type":"text","content":"Current Task","fontSize":12,"fontWeight":700,"fontFamily":"Noto Sans Mono CJK SC","letterSpacing":1.2,"fill":[{"type":"solid","color":"#d79921"}]}'
insert_quiet "$TASK_COPY" '{"type":"text","content":"OpenPencil overview v2","fontSize":26,"fontWeight":700,"fontFamily":"Noto Sans SC","fill":[{"type":"solid","color":"#e8e1d2"}]}'
insert_quiet "$TASK_COPY" '{"type":"text","content":"Workstream: Solo UI redesign · waiting approval","fontSize":13,"fontFamily":"Noto Sans Mono CJK SC","fill":[{"type":"solid","color":"#8e8576"}]}'
TASK_STATUS=$(insert "$TASK" '{"type":"frame","name":"StatusStrip","width":"fill_container","height":"fit_content","layout":"horizontal","gap":8,"justifyContent":"end","alignItems":"center"}')
metric_chip "$TASK_STATUS" "RUN" "active" "#29311d" "#a9b665" 126
metric_chip "$TASK_STATUS" "NEXT" "approve" "#3a2b18" "#d8a657" 132
metric_chip "$TASK_STATUS" "OUTPUTS" "3 +1" "#203322" "#89b482" 126

RUN=$(insert "$CENTER" '{"type":"rectangle","name":"RunTimeline","width":"fill_container","height":544,"layout":"vertical","gap":10,"padding":14,"cornerRadius":16,"fill":[{"type":"solid","color":"#262a23"}],"stroke":{"thickness":1,"fill":[{"type":"solid","color":"#3a3f35"}]}}')
RUN_HEAD=$(insert "$RUN" '{"type":"frame","name":"Run Header","width":"fill_container","height":"fit_content","layout":"horizontal","justifyContent":"space_between","alignItems":"center"}')
insert_quiet "$RUN_HEAD" '{"type":"text","content":"Active Run","fontSize":18,"fontWeight":700,"fontFamily":"Noto Sans SC","fill":[{"type":"solid","color":"#e8e1d2"}]}'
pill "$RUN_HEAD" "Run Mode" 104 30 "managed" "#29311d" "#a9b665" "#a9b665"

RUN_SUMMARY=$(insert "$RUN" '{"type":"rectangle","name":"Run Summary","width":"fill_container","height":86,"layout":"horizontal","gap":12,"alignItems":"center","padding":12,"cornerRadius":12,"fill":[{"type":"solid","color":"#29311d"}],"stroke":{"thickness":1,"fill":[{"type":"solid","color":"#a9b665"}]}}')
insert_quiet "$RUN_SUMMARY" '{"type":"rectangle","name":"Run State Bar","width":4,"height":"fill_container","cornerRadius":99,"fill":[{"type":"solid","color":"#a9b665"}]}'
RUN_SUMMARY_COPY=$(insert "$RUN_SUMMARY" '{"type":"frame","name":"Run Summary Copy","width":"fill_container","height":"fit_content","layout":"vertical","gap":4}')
insert_quiet "$RUN_SUMMARY_COPY" '{"type":"text","content":"Generating editable overview artifact","fontSize":16,"fontWeight":700,"fontFamily":"Noto Sans SC","fill":[{"type":"solid","color":"#e8e1d2"}]}'
insert_quiet "$RUN_SUMMARY_COPY" '{"type":"text","content":"next: approve direction","fontSize":13,"fontFamily":"Noto Sans Mono CJK SC","fill":[{"type":"solid","color":"#c9bfae"}]}'

event_row "$RUN" "15:40" "DDD decisions consolidated" "summary" "#89b482"
event_row "$RUN" "15:42" "Overview canvas generated" "OUTPUTS" "#a9b665"
event_row "$RUN" "15:44" "Checkpoint 02 · direction approval" "waiting" "#d8a657"
event_row "$RUN" "15:45" "External Codex observed" "observe-only" "#7daea3"
event_row "$RUN" "15:46" "Export blocked" "Exceptions" "#ea6962"

OUTPUTS=$(insert "$CENTER" '{"type":"rectangle","name":"OutputTray","width":"fill_container","height":132,"layout":"vertical","gap":10,"padding":14,"cornerRadius":16,"fill":[{"type":"solid","color":"#262a23"}],"stroke":{"thickness":1,"fill":[{"type":"solid","color":"#3a3f35"}]}}')
OUT_HEAD=$(insert "$OUTPUTS" '{"type":"frame","name":"Output Header","width":"fill_container","height":"fit_content","layout":"horizontal","justifyContent":"space_between","alignItems":"center"}')
insert_quiet "$OUT_HEAD" '{"type":"text","content":"OUTPUTS","fontSize":16,"fontWeight":700,"fontFamily":"Noto Sans SC","fill":[{"type":"solid","color":"#e8e1d2"}]}'
insert_quiet "$OUT_HEAD" '{"type":"text","content":"3 visible · +1","fontSize":12,"fontFamily":"Noto Sans Mono CJK SC","fill":[{"type":"solid","color":"#8e8576"}]}'
OUT_ROW=$(insert "$OUTPUTS" '{"type":"frame","name":"Output Row","width":"fill_container","height":"fill_container","layout":"horizontal","gap":10,"alignItems":"stretch"}')
output_tile "$OUT_ROW" "OpenPencil overview" "latest · .op" "#7daea3"
output_tile "$OUT_ROW" "DDD document" "doc" "#89b482"
output_tile "$OUT_ROW" "Token map" "ops-dark" "#d79921"
pill "$OUT_ROW" "More Outputs" 86 66 "+1" "#262a23" "#535a4d" "#8e8576"

INSPECTOR=$(insert "$BODY" '{"type":"rectangle","name":"InspectorPanel","width":430,"height":"fill_container","layout":"vertical","gap":12,"padding":14,"cornerRadius":18,"fill":[{"type":"solid","color":"#1e211c"}],"stroke":{"thickness":1,"fill":[{"type":"solid","color":"#3a3f35"}]}}')
INSPECT_HEAD=$(insert "$INSPECTOR" '{"type":"frame","name":"Inspector Header","width":"fill_container","height":"fit_content","layout":"vertical","gap":4}')
insert_quiet "$INSPECT_HEAD" '{"type":"text","content":"Inspecting","fontSize":12,"fontWeight":700,"fontFamily":"Noto Sans Mono CJK SC","letterSpacing":1.2,"fill":[{"type":"solid","color":"#8e8576"}]}'
insert_quiet "$INSPECT_HEAD" '{"type":"text","content":"Checkpoint 02 · direction approval","fontSize":18,"fontWeight":700,"fontFamily":"Noto Sans SC","fill":[{"type":"solid","color":"#e8e1d2"}]}'

DECISION=$(insert "$INSPECTOR" '{"type":"rectangle","name":"DecisionCard","width":"fill_container","height":176,"layout":"vertical","gap":9,"padding":14,"cornerRadius":14,"fill":[{"type":"solid","color":"#3a2b18"}],"stroke":{"thickness":1,"fill":[{"type":"solid","color":"#d8a657"}]}}')
insert_quiet "$DECISION" '{"type":"text","content":"Needs approval","fontSize":12,"fontWeight":700,"fontFamily":"Noto Sans Mono CJK SC","letterSpacing":1.1,"fill":[{"type":"solid","color":"#d8a657"}]}'
insert_quiet "$DECISION" '{"type":"text","content":"Accept Workstream Cockpit v2?","fontSize":17,"fontWeight":700,"fontFamily":"Noto Sans SC","fill":[{"type":"solid","color":"#e8e1d2"}]}'
insert_quiet "$DECISION" '{"type":"text","content":"Impact: App.css token phase","fontSize":13,"fontFamily":"Noto Sans Mono CJK SC","fill":[{"type":"solid","color":"#c9bfae"}]}'
DECISION_BTNS=$(insert "$DECISION" '{"type":"frame","name":"Decision Actions","width":"fill_container","height":38,"layout":"horizontal","gap":8}')
pill "$DECISION_BTNS" "Approve" 92 36 "Approve" "#d79921" "#d79921" "#151714"
pill "$DECISION_BTNS" "Revise" 88 36 "Revise" "#262a23" "#535a4d" "#e8e1d2"
pill "$DECISION_BTNS" "Evidence" 98 36 "Evidence" "#262a23" "#535a4d" "#c9bfae"

EVIDENCE=$(insert "$INSPECTOR" '{"type":"rectangle","name":"EvidenceList","width":"fill_container","height":148,"layout":"vertical","gap":10,"padding":12,"cornerRadius":14,"fill":[{"type":"solid","color":"#262a23"}],"stroke":{"thickness":1,"fill":[{"type":"solid","color":"#3a3f35"}]}}')
insert_quiet "$EVIDENCE" '{"type":"text","content":"Evidence","fontSize":15,"fontWeight":700,"fontFamily":"Noto Sans SC","fill":[{"type":"solid","color":"#e8e1d2"}]}'
insert_quiet "$EVIDENCE" '{"type":"text","content":"IA: current task first","fontSize":13,"fontFamily":"Noto Sans Mono CJK SC","fill":[{"type":"solid","color":"#c9bfae"}]}'
insert_quiet "$EVIDENCE" '{"type":"text","content":"Visual: fewer text prompts","fontSize":13,"fontFamily":"Noto Sans Mono CJK SC","fill":[{"type":"solid","color":"#c9bfae"}]}'
insert_quiet "$EVIDENCE" '{"type":"text","content":"Risk: runtime unchanged","fontSize":13,"fontFamily":"Noto Sans Mono CJK SC","fill":[{"type":"solid","color":"#c9bfae"}]}'

RESOURCE_COLLAPSED=$(insert "$INSPECTOR" '{"type":"rectangle","name":"Collapsed External Resource","width":"fill_container","height":58,"layout":"horizontal","gap":10,"alignItems":"center","padding":[8,10],"cornerRadius":12,"fill":[{"type":"solid","color":"#1f3130"}],"stroke":{"thickness":1,"fill":[{"type":"solid","color":"#3a4f4c"}]}}')
insert_quiet "$RESOURCE_COLLAPSED" '{"type":"rectangle","name":"External Dot","width":8,"height":8,"cornerRadius":99,"fill":[{"type":"solid","color":"#7daea3"}]}'
insert_quiet "$RESOURCE_COLLAPSED" '{"type":"text","content":"External Codex · running · observe-only","fontSize":13,"fontWeight":700,"fontFamily":"Noto Sans SC","fill":[{"type":"solid","color":"#7daea3"}]}'

COMMAND=$(insert root-frame '{"type":"rectangle","name":"CommandBar","width":"fill_container","height":104,"layout":"horizontal","gap":14,"alignItems":"center","padding":14,"cornerRadius":18,"fill":[{"type":"solid","color":"#1e211c"}],"stroke":{"thickness":1,"fill":[{"type":"solid","color":"#3a3f35"}]}}')
CMD_STATE=$(insert "$COMMAND" '{"type":"frame","name":"Command State","width":220,"height":"fill_container","layout":"vertical","gap":4,"justifyContent":"center"}')
insert_quiet "$CMD_STATE" '{"type":"text","content":"Waiting approval","fontSize":18,"fontWeight":700,"fontFamily":"Noto Sans SC","fill":[{"type":"solid","color":"#e8e1d2"}]}'
insert_quiet "$CMD_STATE" '{"type":"text","content":"Checkpoint 02 · direction","fontSize":13,"fontFamily":"Noto Sans Mono CJK SC","fill":[{"type":"solid","color":"#d8a657"}]}'
CMD_INPUT=$(insert "$COMMAND" '{"type":"rectangle","name":"Command Input","width":"fill_container","height":58,"layout":"horizontal","alignItems":"center","padding":[0,14],"cornerRadius":14,"fill":[{"type":"solid","color":"#262a23"}],"stroke":{"thickness":1,"fill":[{"type":"solid","color":"#535a4d"}]}}')
insert_quiet "$CMD_INPUT" '{"type":"text","content":"Add direction, approve, or ask for detail...","fontSize":14,"fontFamily":"Noto Sans SC","fill":[{"type":"solid","color":"#8e8576"}]}'
CMD_ACTIONS=$(insert "$COMMAND" '{"type":"frame","name":"Command Actions","width":316,"height":"fill_container","layout":"horizontal","gap":10,"justifyContent":"end","alignItems":"center"}')
pill "$CMD_ACTIONS" "Primary Approve" 108 44 "Approve" "#d79921" "#d79921" "#151714"
pill "$CMD_ACTIONS" "More Actions" 82 44 "More" "#262a23" "#535a4d" "#e8e1d2"
pill "$CMD_ACTIONS" "Pause" 78 44 "Pause" "#3a1f1d" "#ea6962" "#ea6962"

op design:refine --root-id root-frame >/dev/null || true
op save design/openpencil/solo-ui-overview-v2.op >/dev/null

echo "Saved design/openpencil/solo-ui-overview-v2.op"
