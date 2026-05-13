#!/usr/bin/env python3
"""Make the agent greet the room as soon as the Realtime data channel opens."""
p = "/home/agent/ai-agents-x-space/public/agent1.html"
s = open(p).read()

GREETING = (
    "Greet the room warmly in one or two sentences. "
    "Mention you're here with @doi to talk about three.ws and invite people to jump in."
)

old = 'dc.onopen = () => log("Data channel open", "success")'
new = (
    'dc.onopen = () => {\n'
    '          log("Data channel open", "success")\n'
    '          setTimeout(() => {\n'
    '            try {\n'
    '              dc.send(JSON.stringify({\n'
    '                type: "response.create",\n'
    f'                response: {{ instructions: "{GREETING}" }}\n'
    '              }))\n'
    '              log("Sent greet trigger", "success")\n'
    '            } catch (e) { log("greet trigger failed: " + e.message, "error") }\n'
    '          }, 1500)\n'
    '        }'
)
if old in s:
    s = s.replace(old, new)
    open(p, "w").write(s)
    print("[ok] greet trigger added to agent1.html")
elif "Sent greet trigger" in s:
    print("[skip] already patched")
else:
    print("[WARN] anchor not found; agent1.html may have changed")
