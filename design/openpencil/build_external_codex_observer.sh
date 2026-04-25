#!/usr/bin/env bash
set -euo pipefail

id() {
  python3 -c 'import json,sys; print(json.load(sys.stdin)["nodeId"])'
}

op update root-frame '{"name":"External Codex Observer · Directions","width":1760,"height":980,"layout":"vertical","padding":[40,44],"gap":28,"fill":[{"type":"solid","color":"#1f1b16"}]}'

HEADER=$(op insert --parent root-frame '{"type":"frame","name":"Header","width":"fill_container","height":"fit_content","layout":"horizontal","justifyContent":"space_between","alignItems":"center"}' | id)
TITLE=$(op insert --parent "$HEADER" '{"type":"frame","name":"Title Block","layout":"vertical","gap":8,"width":920,"height":"fit_content"}' | id)
op insert --parent "$TITLE" '{"type":"text","content":"External Codex Observer","fontSize":34,"fontWeight":700,"fontFamily":"Maple Mono NF CN","lineHeight":1.12,"fill":[{"type":"solid","color":"#ebdbb2"}]}'
op insert --parent "$TITLE" '{"type":"text","content":"Surface external Codex processes as observe-only resource occupancy, not new chat sessions.","fontSize":15,"fontFamily":"Noto Sans SC","lineHeight":1.5,"textGrowth":"fixed-width","width":860,"fill":[{"type":"solid","color":"#c2ad8a"}]}'

BADGE=$(op insert --parent "$HEADER" '{"type":"rectangle","name":"Recommendation Badge","role":"badge","layout":"horizontal","gap":10,"alignItems":"center","padding":[10,16],"cornerRadius":999,"fill":[{"type":"solid","color":"#333026"}],"stroke":{"thickness":1,"fill":[{"type":"solid","color":"#7c734d"}]}}' | id)
op insert --parent "$BADGE" '{"type":"text","content":"Recommended","fontSize":12,"fontWeight":700,"fontFamily":"Maple Mono NF CN","fill":[{"type":"solid","color":"#a9b665"}]}'
op insert --parent "$BADGE" '{"type":"text","content":"Direction B","fontSize":12,"fontFamily":"Maple Mono NF CN","fill":[{"type":"solid","color":"#ebdbb2"}]}'

GRID=$(op insert --parent root-frame '{"type":"frame","name":"Directions Grid","width":"fill_container","height":"fill_container","layout":"horizontal","gap":22,"alignItems":"start"}' | id)

make_panel() {
  local name="$1"
  local eyebrow="$2"
  local title="$3"
  local summary="$4"
  local accent="$5"
  local panel
  panel=$(op insert --parent "$GRID" "{\"type\":\"rectangle\",\"name\":\"$name\",\"role\":\"card\",\"width\":\"fill_container\",\"height\":790,\"layout\":\"vertical\",\"gap\":16,\"padding\":24,\"cornerRadius\":18,\"fill\":[{\"type\":\"solid\",\"color\":\"#2b251f\"}],\"stroke\":{\"thickness\":1,\"fill\":[{\"type\":\"solid\",\"color\":\"#5d513d\"}]}}" | id)
  op insert --parent "$panel" "{\"type\":\"text\",\"content\":\"$eyebrow\",\"fontSize\":11,\"fontWeight\":700,\"fontFamily\":\"Maple Mono NF CN\",\"letterSpacing\":1.6,\"fill\":[{\"type\":\"solid\",\"color\":\"$accent\"}]}"
  op insert --parent "$panel" "{\"type\":\"text\",\"content\":\"$title\",\"fontSize\":23,\"fontWeight\":700,\"fontFamily\":\"Noto Sans SC\",\"lineHeight\":1.18,\"textGrowth\":\"fixed-width\",\"width\":\"fill_container\",\"fill\":[{\"type\":\"solid\",\"color\":\"#ebdbb2\"}]}"
  op insert --parent "$panel" "{\"type\":\"text\",\"content\":\"$summary\",\"fontSize\":14,\"fontFamily\":\"Noto Sans SC\",\"lineHeight\":1.58,\"textGrowth\":\"fixed-width\",\"width\":\"fill_container\",\"fill\":[{\"type\":\"solid\",\"color\":\"#c2ad8a\"}]}"
  echo "$panel"
}

A=$(make_panel "A · Right Dock Radar" "A / TRANSITIONAL" "右下运行雷达" "适合功能验证和调试。它让外部 Codex 立即可见，但不应该长期作为主信息架构。" "#d8a657")

SCREEN_A=$(op insert --parent "$A" '{"type":"rectangle","name":"A Screen Mock","width":"fill_container","height":430,"layout":"vertical","padding":18,"gap":14,"cornerRadius":14,"fill":[{"type":"solid","color":"#1d1914"}],"stroke":{"thickness":1,"fill":[{"type":"solid","color":"#453b2e"}]}}' | id)
op insert --parent "$SCREEN_A" '{"type":"frame","name":"A Topbar","width":"fill_container","height":38,"layout":"horizontal","justifyContent":"space_between","alignItems":"center","fill":[{"type":"solid","color":"#262018"}]}' >/dev/null
op insert --parent "$SCREEN_A" '{"type":"rectangle","name":"A Workspace Body","width":"fill_container","height":230,"cornerRadius":12,"fill":[{"type":"solid","color":"#241f19"}],"stroke":{"thickness":1,"fill":[{"type":"solid","color":"#3f3528"}]}}' >/dev/null
DOCK=$(op insert --parent "$SCREEN_A" '{"type":"rectangle","name":"Floating Radar Dock","width":"fill_container","height":132,"layout":"vertical","gap":8,"padding":12,"cornerRadius":12,"fill":[{"type":"solid","color":"#332b24"}],"stroke":{"thickness":1,"fill":[{"type":"solid","color":"#8f7f58"}]}}' | id)
op insert --parent "$DOCK" '{"type":"text","content":"External Codex · 1 agent","fontSize":12,"fontWeight":700,"fontFamily":"Maple Mono NF CN","fill":[{"type":"solid","color":"#ebdbb2"}]}'
op insert --parent "$DOCK" '{"type":"text","content":"cocoa  ·  pid 3160  ·  running","fontSize":12,"fontFamily":"Maple Mono NF CN","fill":[{"type":"solid","color":"#a9b665"}]}'
op insert --parent "$DOCK" '{"type":"text","content":"observe-only  ·  ~/workspace/cocoa","fontSize":11,"fontFamily":"Maple Mono NF CN","textGrowth":"fixed-width","width":"fill_container","fill":[{"type":"solid","color":"#c2ad8a"}]}'
op insert --parent "$A" '{"type":"text","content":"Risk: overlay competes with task surface and does not scale to many agents.","fontSize":13,"fontFamily":"Noto Sans SC","lineHeight":1.45,"textGrowth":"fixed-width","width":"fill_container","fill":[{"type":"solid","color":"#d3869b"}]}'

B=$(make_panel "B · Resource Rail Integration" "B / RECOMMENDED" "资源栏占用态" "把外部 Codex 看成 workspace resource occupancy。它符合 Solo 的 run/resource/event 模型，不遮挡主内容。" "#a9b665")

SCREEN_B=$(op insert --parent "$B" '{"type":"rectangle","name":"B Screen Mock","width":"fill_container","height":520,"layout":"horizontal","gap":16,"padding":18,"cornerRadius":14,"fill":[{"type":"solid","color":"#1d1914"}],"stroke":{"thickness":1,"fill":[{"type":"solid","color":"#453b2e"}]}}' | id)
RAIL=$(op insert --parent "$SCREEN_B" '{"type":"rectangle","name":"Resource Rail","width":170,"height":"fill_container","layout":"vertical","gap":10,"padding":12,"cornerRadius":12,"fill":[{"type":"solid","color":"#2c251e"}],"stroke":{"thickness":1,"fill":[{"type":"solid","color":"#5d513d"}]}}' | id)
op insert --parent "$RAIL" '{"type":"text","content":"RESOURCES","fontSize":11,"fontWeight":700,"fontFamily":"Maple Mono NF CN","letterSpacing":1.4,"fill":[{"type":"solid","color":"#c2ad8a"}]}'
op insert --parent "$RAIL" '{"type":"text","content":"附加资源  2","fontSize":20,"fontWeight":700,"fontFamily":"Noto Sans SC","fill":[{"type":"solid","color":"#ebdbb2"}]}'
SOLO=$(op insert --parent "$RAIL" '{"type":"rectangle","name":"Resource Solo","width":"fill_container","height":88,"layout":"vertical","gap":5,"padding":10,"cornerRadius":10,"fill":[{"type":"solid","color":"#332b24"}],"stroke":{"thickness":1,"fill":[{"type":"solid","color":"#4f4535"}]}}' | id)
op insert --parent "$SOLO" '{"type":"text","content":"solo","fontSize":14,"fontWeight":700,"fontFamily":"Maple Mono NF CN","fill":[{"type":"solid","color":"#ebdbb2"}]}'
op insert --parent "$SOLO" '{"type":"text","content":"local workspace","fontSize":11,"fontFamily":"Maple Mono NF CN","fill":[{"type":"solid","color":"#c2ad8a"}]}'
op insert --parent "$SOLO" '{"type":"text","content":"0 external runs","fontSize":11,"fontFamily":"Maple Mono NF CN","fill":[{"type":"solid","color":"#928374"}]}'
COCOA=$(op insert --parent "$RAIL" '{"type":"rectangle","name":"Resource Cocoa Occupied","width":"fill_container","height":132,"layout":"vertical","gap":6,"padding":10,"cornerRadius":10,"fill":[{"type":"solid","color":"#333026"}],"stroke":{"thickness":2,"fill":[{"type":"solid","color":"#8fb08b"}]}}' | id)
op insert --parent "$COCOA" '{"type":"text","content":"cocoa","fontSize":14,"fontWeight":700,"fontFamily":"Maple Mono NF CN","fill":[{"type":"solid","color":"#ebdbb2"}]}'
op insert --parent "$COCOA" '{"type":"text","content":"external codex","fontSize":11,"fontFamily":"Maple Mono NF CN","fill":[{"type":"solid","color":"#a9b665"}]}'
op insert --parent "$COCOA" '{"type":"text","content":"pid 3160 · running","fontSize":11,"fontFamily":"Maple Mono NF CN","fill":[{"type":"solid","color":"#a9b665"}]}'
op insert --parent "$COCOA" '{"type":"text","content":"observe-only","fontSize":11,"fontWeight":700,"fontFamily":"Maple Mono NF CN","fill":[{"type":"solid","color":"#d8a657"}]}'
MAIN_B=$(op insert --parent "$SCREEN_B" '{"type":"rectangle","name":"B Main Area","width":"fill_container","height":"fill_container","layout":"vertical","gap":14,"padding":18,"cornerRadius":12,"fill":[{"type":"solid","color":"#241f19"}],"stroke":{"thickness":1,"fill":[{"type":"solid","color":"#3f3528"}]}}' | id)
op insert --parent "$MAIN_B" '{"type":"text","content":"Workstream: solo 项目还有哪些待办项？","fontSize":16,"fontWeight":700,"fontFamily":"Noto Sans SC","fill":[{"type":"solid","color":"#ebdbb2"}]}'
op insert --parent "$MAIN_B" '{"type":"text","content":"Resource occupancy is visible in the rail. The main task surface stays calm.","fontSize":13,"fontFamily":"Noto Sans SC","lineHeight":1.45,"textGrowth":"fixed-width","width":"fill_container","fill":[{"type":"solid","color":"#c2ad8a"}]}'
op insert --parent "$B" '{"type":"text","content":"Best long-term fit: resource state lives with resources, not in chat or floating chrome.","fontSize":13,"fontFamily":"Noto Sans SC","lineHeight":1.45,"textGrowth":"fixed-width","width":"fill_container","fill":[{"type":"solid","color":"#a9b665"}]}'

C=$(make_panel "C · Top Status Expansion" "C / LATER" "顶栏状态展开" "将外部 agent 计数放进全局 status card，点击后展开详情。适合多 agent 汇总，但可发现性较弱。" "#8fb08b")

SCREEN_C=$(op insert --parent "$C" '{"type":"rectangle","name":"C Screen Mock","width":"fill_container","height":430,"layout":"vertical","gap":16,"padding":18,"cornerRadius":14,"fill":[{"type":"solid","color":"#1d1914"}],"stroke":{"thickness":1,"fill":[{"type":"solid","color":"#453b2e"}]}}' | id)
TOP_C=$(op insert --parent "$SCREEN_C" '{"type":"frame","name":"C Topbar","width":"fill_container","height":56,"layout":"horizontal","gap":10,"justifyContent":"end","alignItems":"center"}' | id)
STATUS=$(op insert --parent "$TOP_C" '{"type":"rectangle","name":"Resources Status Card","width":176,"height":46,"layout":"vertical","gap":2,"padding":[7,10],"cornerRadius":8,"fill":[{"type":"solid","color":"#332b24"}],"stroke":{"thickness":1,"fill":[{"type":"solid","color":"#6f6346"}]}}' | id)
op insert --parent "$STATUS" '{"type":"text","content":"RESOURCES","fontSize":10,"fontWeight":700,"fontFamily":"Maple Mono NF CN","letterSpacing":1.2,"fill":[{"type":"solid","color":"#c2ad8a"}]}'
op insert --parent "$STATUS" '{"type":"text","content":"1 external / 0 attached","fontSize":12,"fontWeight":700,"fontFamily":"Maple Mono NF CN","fill":[{"type":"solid","color":"#ebdbb2"}]}'
POPOVER=$(op insert --parent "$SCREEN_C" '{"type":"rectangle","name":"Expanded Agent Monitor","width":"fill_container","height":188,"layout":"vertical","gap":10,"padding":14,"cornerRadius":12,"fill":[{"type":"solid","color":"#2f2921"}],"stroke":{"thickness":1,"fill":[{"type":"solid","color":"#8f7f58"}]}}' | id)
op insert --parent "$POPOVER" '{"type":"text","content":"External Codex","fontSize":14,"fontWeight":700,"fontFamily":"Maple Mono NF CN","fill":[{"type":"solid","color":"#ebdbb2"}]}'
op insert --parent "$POPOVER" '{"type":"text","content":"cocoa        running        observe-only","fontSize":12,"fontFamily":"Maple Mono NF CN","fill":[{"type":"solid","color":"#a9b665"}]}'
op insert --parent "$POPOVER" '{"type":"text","content":"~/workspace/cocoa · pid 3160 · last seen 15:08","fontSize":11,"fontFamily":"Maple Mono NF CN","textGrowth":"fixed-width","width":"fill_container","fill":[{"type":"solid","color":"#c2ad8a"}]}'
op insert --parent "$C" '{"type":"text","content":"Useful later for global summary. Needs a clear affordance so users discover details.","fontSize":13,"fontFamily":"Noto Sans SC","lineHeight":1.45,"textGrowth":"fixed-width","width":"fill_container","fill":[{"type":"solid","color":"#c2ad8a"}]}'

op design:refine --root-id root-frame >/dev/null || true
op save design/openpencil/external-codex-observer.op >/dev/null

echo "Saved design/openpencil/external-codex-observer.op"
