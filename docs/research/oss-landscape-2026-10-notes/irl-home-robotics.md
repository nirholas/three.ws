# Open-source competitors to three.ws physical-world surfaces (smart home, voice hardware, glasses, car, robotics, sign language), October 2026

All star counts, licenses and push dates were read from the GitHub REST API (authenticated `gh api`) on 2026-10-09 unless noted. A repo's license URL is `https://github.com/<owner>/<repo>/blob/<default-branch>/LICENSE`, and the SPDX value comes from `https://api.github.com/repos/<owner>/<repo>`. Context: three.ws already ships `home-assistant-integration/` (HACS custom component, LAN house dials out to the cloud relay), `services/home-relay`, `@three-ws/home-mcp`, `@three-ws/home-bridge`, `/smart-home`, `/voice/home`, `/drive`, `@three-ws/irl`, `docs/home-satellite.md`, `docs/glasses.md`, and `@three-ws/sign-language` (local docs: docs/smart-home.md, home-voice.md, home-satellite.md, glasses.md, irl.md, sign-language.md).

## 1. Smart home and voice stack: which repos beat three.ws, and integrate or rebuild?

### Takeaway
Do not rebuild any of the smart-home stack. Home Assistant (Apache-2.0, ~91k stars) is the device and voice layer; three.ws should stay an integration on top of its open APIs (Assist/conversation, MCP server, WebSocket/REST, Wyoming) and keep its differentiator, the 3D embodied agent. Verdicts: Home Assistant = "already covered" via integration, deepen it; ha-mcp = "adopt design, rebuild" (87-tool surface is a benchmark for `@three-ws/home-mcp`); Wyoming/openWakeWord/linux-voice-assistant = "adopt code" (all permissive) for the satellite; Frigate = integrate via its HA integration, MIT; Matter SDK = do not rebuild, go through HA; openHAB = EPL-2.0, integrate only if demanded.

### Cited Findings
- Home Assistant core: 91,335 stars (2026-10-09), Apache-2.0, pushed 2026-10-09. Same license as three.ws, so code can be copied with attribution. — [repo](https://github.com/home-assistant/core), [license](https://github.com/home-assistant/core/blob/dev/LICENSE.md)
- Core ships first-party LLM/agent integrations as components: `anthropic`, `openai_conversation`, `ollama`, `conversation`, `assist_pipeline`, `assist_satellite`, `mcp` (HA as MCP client) and `mcp_server` (HA as MCP server, depends on `conversation`, mcp==1.28.1, quality scale silver, local_push). — [components dir](https://github.com/home-assistant/core/tree/dev/homeassistant/components), [mcp_server manifest](https://github.com/home-assistant/core/blob/dev/homeassistant/components/mcp_server/manifest.json), [docs](https://www.home-assistant.io/integrations/mcp_server)
- The official MCP server only reaches Assist-exposed entities, has ~10 intent-based tools, and cannot create or edit automations, scripts or dashboards (third-party comparison, not the official docs; verify). — [raspberry.tips guide](https://raspberry.tips/en/smart-home/home-assistant-mcp-server-ai-setup)
- Home Assistant 2026.2 renamed "Add-ons" to "Apps" in the UI (secondary source). — [raspberry.tips](https://raspberry.tips/en/smart-home/home-assistant-mcp-server-ai-setup)
- ha-mcp (homeassistant-ai/ha-mcp): 4,997 stars (2026-10-09), MIT, pushed 2026-10-09, README badge advertises 87 tools, installs via HACS custom component with in-process server, an admin HA-MCP sidebar panel, backups/restore of helper edits, opt-in file and YAML editing flags. Far broader than the official server (automation/script/dashboard/helper authoring). — [repo](https://github.com/homeassistant-ai/ha-mcp), [license](https://github.com/homeassistant-ai/ha-mcp/blob/main/LICENSE.md)
- Other HA MCP server: voska/hass-mcp 343 stars, MIT. — [repo](https://github.com/voska/hass-mcp)
- Wyoming protocol now lives at OHF-Voice/wyoming: 401 stars, MIT (rhasspy/wyoming URL redirects here). — [repo](https://github.com/OHF-Voice/wyoming)
- rhasspy/wyoming-satellite: 1,241 stars, MIT, last push 2026-01-24 (maintenance mode; successor is below). — [repo](https://github.com/rhasspy/wyoming-satellite)
- OHF-Voice/linux-voice-assistant: 647 stars, Apache-2.0, pushed 2026-10-01. Linux ESPHome-protocol voice satellite (successor path for DIY satellites). — [repo](https://github.com/OHF-Voice/linux-voice-assistant)
- OHF-Voice/intents (Assist sentence/intents library, many languages): 628 stars, CC-BY-4.0 (data, attribution required). — [repo](https://github.com/OHF-Voice/intents)
- openWakeWord (dscripka): 2,828 stars, Apache-2.0, last push 2025-12-30; wyoming-openwakeword 205 stars, Apache-2.0. Pretrained models carry their own terms (check per model; the author notes CC BY-NC-SA on some training data derived models). — [repo](https://github.com/dscripka/openWakeWord), [wyoming wrapper](https://github.com/rhasspy/wyoming-openwakeword)
- microWakeWord (kahrendt): 24 stars, Apache-2.0; powers on-device wake words on Voice PE ("Okay Nabu", "Hey Jarvis", "Hey Mycroft"). — [repo](https://github.com/kahrendt/microWakeWord), [HA blog](https://home-assistant.io/blog/2024/12/19/voice-preview-edition-the-era-of-open-voice)
- Piper TTS: rhasspy/piper 11,297 stars, MIT, archived-era last push 2025-08-26; successor OHF-Voice/piper1-gpl 5,807 stars, GPL-3.0 (copyleft: do not link into an Apache-2.0 product; run as separate process/service only). — [piper](https://github.com/rhasspy/piper), [piper1-gpl](https://github.com/OHF-Voice/piper1-gpl)
- Home Assistant Voice Preview Edition (esphome/home-assistant-voice-pe): 766 stars, license reported as "Other"/NOASSERTION (mixed firmware and hardware files; read LICENSE before copying), ESP32-S3 + XMOS XU316 (echo cancel, noise suppression), on-device wake word, fully open software/firmware/hardware per vendor. — [repo](https://github.com/esphome/home-assistant-voice-pe), [LICENSE](https://github.com/esphome/home-assistant-voice-pe/blob/dev/LICENSE), [HA blog](https://home-assistant.io/blog/2024/12/19/voice-preview-edition-the-era-of-open-voice)
- ESPHome: 11,799 stars, SPDX NOASSERTION (mixed: GPLv3 for C++ runtime/firmware, MIT for Python tooling per its README; confirm before vendoring). — [repo](https://github.com/esphome/esphome), [license](https://github.com/esphome/esphome/blob/dev/LICENSE)
- Home Assistant Android companion app: 3,956 stars, Apache-2.0. — [repo](https://github.com/home-assistant/android)
- Frigate NVR: 36,447 stars, MIT, pushed 2026-10-09; local object detection, HA integration, GenAI event descriptions. — [repo](https://github.com/blakeblackshear/frigate), [license](https://github.com/blakeblackshear/frigate/blob/dev/LICENSE)
- Matter SDK (project-chip/connectedhomeip): 8,961 stars, Apache-2.0. — [repo](https://github.com/project-chip/connectedhomeip), [license](https://github.com/project-chip/connectedhomeip/blob/master/LICENSE)
- openHAB: openhab-core 1,148 stars and openhab-addons 2,063 stars, both EPL-2.0 (weak copyleft, file-level; fine to call over APIs, avoid copying files into Apache-2.0 code without keeping EPL on those files); openhab-android 652 stars EPL-2.0. — [core](https://github.com/openhab/openhab-core), [addons](https://github.com/openhab/openhab-addons)

### Inferences
- three.ws's unique edge versus all of these is the 3D embodied agent plus the dial-out relay (no port forwarding); no surveyed repo has a 3D avatar front end. Adopting the wider surface from HA is cheaper than rebuilding it.
- Concrete adoption list: (a) widen `@three-ws/home-mcp` toward ha-mcp's categories (automation/script/helper authoring with backup-before-edit) but only via HA's WebSocket/REST API, keeping MIT attribution if any code is copied; (b) speak Wyoming/ESPHome-voice to satellites so a Voice PE or linux-voice-assistant node can front the 3D agent (`docs/home-satellite.md` already exists, so audit it against Wyoming events); (c) expose Frigate events as agent cues through HA's Frigate integration rather than touching Frigate directly; (d) use HA `intents` data (CC-BY-4.0) for local intent matching with attribution.
- Piper (GPL) and ESPHome (mixed GPL) are process-boundary only for an Apache-2.0 platform.

### Gaps
- Could not read the official Home Assistant 2026.x release notes (search returned only third-party pages), so exact 2026 Assist/LLM features (e.g. Assist API changes, conversation agent tools) are unverified.
- Did not verify the Voice PE hardware-design license text or ESPHome's per-directory licenses; search showed no explicit hardware license.
- Did not find OHF-Voice/wyoming-satellite (the old rhasspy repo is the one that exists).

## 2. Wearables and smart glasses: which repos beat three.ws?

### Takeaway
MentraOS (Apache-2.0, 2.4k stars) is the clear open glasses OS and is directly adoptable: three.ws's "nearest-agent cue" should ship as a MentraOS MiniApp to reach Mentra Live, Even Realities G2 and others without hardware work. Omi (MIT, 13.7k stars) is the biggest open wearable-AI stack; adopt its design and possibly its protocol/SDK. Open Interpreter's 01 hardware repo is AGPL and stale; skip.

### Cited Findings
- MentraOS (Mentra-Community/MentraOS): 2,382 stars (2026-10-09), Apache-2.0, pushed 2026-10-09. README: "Write Once, Run on Any Smart Glasses", handles pairing/connection/streaming/hardware access, a MiniApp Store, developer console, supports Mentra Live and Even Realities G2 among others; "every component is open source under Apache 2.0". — [repo](https://github.com/Mentra-Community/MentraOS), [README](https://github.com/Mentra-Community/MentraOS/blob/main/README.md)
- Omi (BasedHardware/omi): 13,673 stars (2026-10-09), MIT, pushed 2026-10-09; open wearable AI (device firmware, mobile app, backend, app/plugin store). — [repo](https://github.com/BasedHardware/omi), [license](https://github.com/BasedHardware/omi/blob/main/LICENSE)
- Brilliant Labs Frame: frame-codebase 529 stars, SPDX NOASSERTION (check the file; likely mixed), last push 2025-10-05; frame-sdk-python 11 stars, MIT; frame_realtime_gemini_voicevision 81 stars, BSD-3-Clause (2026-02-09). — [codebase](https://github.com/brilliantlabsAR/frame-codebase), [sdk-python](https://github.com/brilliantlabsAR/frame-sdk-python), [gemini demo](https://github.com/brilliantlabsAR/frame_realtime_gemini_voicevision)
- xg-glass-sdk (hkust-spark): 46 stars, Apache-2.0, pushed 2026-10-05; cross-glasses SDK, a small rival to MentraOS. — [repo](https://github.com/hkust-spark/xg-glass-sdk)
- Open Interpreter 01 (OpenInterpreter/01): 5,159 stars, AGPL-3.0, last push 2024-11-01 (stale). 01-app 342 stars AGPL-3.0. The org's open-interpreter repo is 68,534 stars Apache-2.0 (code-executing agent, not hardware). — [01](https://github.com/OpenInterpreter/01), [open-interpreter](https://github.com/openinterpreter/openinterpreter)
- openglasses-fingerspelling-ctc on Hugging Face (Core ML fingerspelling model for glasses, Apache-2.0 weights) shows glasses + sign language is an emerging intersection. — [HF](https://huggingface.co/Skunk0/openglasses-fingerspelling-ctc)

### Inferences
- Verdict: MentraOS = "adopt code" (build a three.ws MiniApp; Apache-2.0 compatible; also lets glasses show the nearest-agent cue and AR avatar). Omi = "adopt design, rebuild" (always-on memory/conversation capture plus app store); AGPL 01 = do not touch.

### Gaps
- Did not read MentraOS SDK API details or Omi's backend license split (the repo root says MIT; subdirectories not checked). Brilliant Labs frame-codebase license not read.
- No 2026 Meta/Android XR open stack found; none searched.

## 3. In-car

### Takeaway
openpilot (MIT, 63.9k stars) is the only large open in-car project, but it is driving-assistance on comma hardware, not a conversational agent; it is a design reference at most. No open Android Auto assistant of note was found. /drive can be called "already covered" for the conversational side.

### Cited Findings
- openpilot: 63,851 stars (2026-10-09), MIT, pushed 2026-10-09; "operating system for robotics", upgrades driver assistance on 300+ supported cars. — [repo](https://github.com/commaai/openpilot), [license](https://github.com/commaai/openpilot/blob/master/LICENSE)

### Inferences
- openpilot's value to three.ws is limited to driver-monitoring and vehicle-signal ideas; it must not be presented as a safety system, and repo licensing says nothing about road legality.

### Gaps
- GitHub search for open Android Auto / CarPlay LLM assistants returned nothing relevant; absence is not proof none exist.

## 4. Robotics and embodiment

### Takeaway
LeRobot (Apache-2.0, 28k stars) is the hub: it bundles SO-101 teleop/training, Reachy 2, Unitree G1 and a model zoo (Pi0, Pi0.5, SmolVLA, GR00T N1.7, XVLA, etc.). three.ws should integrate (render a LeRobot robot's URDF/state as a 3D agent body, stream joint states) rather than rebuild; watch weight licenses, which vary.

### Cited Findings
- LeRobot (huggingface/lerobot): 28,035 stars (2026-10-09), Apache-2.0, pushed 2026-10-09. Supported hardware: SO100, LeKiwi, Koch, HopeJR, OMX, EarthRover, Reachy2, Unitree G1 and more; policies: Pi0, Pi0Fast, Pi0.5, GR00T N1.7, SmolVLA, XVLA, EO-1, MolmoAct2, WALL-OSS and others. — [repo](https://github.com/huggingface/lerobot), [license](https://github.com/huggingface/lerobot/blob/main/LICENSE)
- SO-ARM100/101 (TheRobotStudio): 7,706 stars, Apache-2.0 (hardware CAD and firmware repo). — [repo](https://github.com/TheRobotStudio/SO-ARM100)
- Reachy Mini (pollen-robotics): 1,540 stars, Apache-2.0; wireless (Raspberry Pi), Lite (USB) and MuJoCo simulation variants. Hugging Face launched a Reachy Mini app store (~200 apps) in May 2026, reported ~10,000 units sold; $299 Lite, $449 wireless at launch; no creator monetization yet. reachy_mini_conversation_app: 320 stars, Apache-2.0. — [repo](https://github.com/pollen-robotics/reachy_mini), [conversation app](https://github.com/pollen-robotics/reachy_mini_conversation_app), [Axios](https://axios.com/2026/05/06/hugging-face-consumer-robot-app-store), [Robot Report](https://www.therobotreport.com/hugging-face-launches-agentic-toolkit-for-reachy-mini/)
- openpi (pi0/pi0.5): 14,151 stars, code Apache-2.0, last push 2026-08-24; checkpoints (pi0.5 base, LIBERO, DROID) served from `gs://openpi-assets`. Weight license not stated in the README lines I read; pi0 derives from PaliGemma so Gemma terms may apply (unverified). — [repo](https://github.com/Physical-Intelligence/openpi), [LICENSE](https://github.com/Physical-Intelligence/openpi/blob/main/LICENSE)
- Isaac-GR00T: 8,179 stars, code Apache-2.0, model weights under the NVIDIA Open Model License (permits commercial use with conditions; not Apache). — [repo](https://github.com/NVIDIA/Isaac-GR00T), [NVIDIA OML](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/)
- OpenVLA: 7,127 stars, MIT code, last push 2025-03-23; weights derive from Llama 2 and are subject to the Llama Community License (not OSI open). openvla-oft 1,415 stars MIT. — [repo](https://github.com/openvla/openvla), [Llama license](https://ai.meta.com/llama/license/)
- ROS 2 core: ros2/ros2 6,141 stars; rclpy 484 stars Apache-2.0. GitHub search found no standout "ROS 2 LLM bridge" repo with real traction; chrismatthieu/openclaw-robotics (4 stars, MIT) is tiny. — [ros2](https://github.com/ros2/ros2), [rclpy](https://github.com/ros2/rclpy)

### Inferences
- three.ws's differentiator is the avatar/3D rig and browser rendering; a LeRobot bridge (joint states to a three.ws rig) and a Reachy Mini app (the agent as a Reachy app via the conversation-app pattern) are cheap integrations. Verdict: LeRobot "adopt code" as a dependency/bridge; Reachy Mini "adopt design" (app-store distribution model); VLAs "already out of scope", consume only via LeRobot with per-weight license checks.

### Gaps
- SmolVLA and pi0 weight license texts not read. No ROS 2 LLM bridge evaluated in depth.

## 5. Sign-language AI

### Takeaway
No open repo clearly beats three.ws's webcam ASL recognition on a published, comparable accuracy. The best leads are the Skunk0 Apache-2.0 fingerspelling CTC model (20.8% mean CER on a 300-sequence held-out set) and the OpenFS paper (93.7 letter accuracy on FSboard, 8.81M params; code/weights availability unverified). sign.mt is NC-licensed, so only design is adoptable.

### Cited Findings
- MediaPipe: 37,202 stars, Apache-2.0, pushed 2026-10-09; Holistic/Hand landmarks are the standard input for ASL models. — [repo](https://github.com/google-ai-edge/mediapipe), [license](https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE)
- sign/translate (sign.mt): 794 stars, license CC BY-NC-SA 4.0 (non-commercial, share-alike; cannot be reused in a commercial Apache-2.0 platform), last push 2026-08-11. Two-way spoken/signed translation, offline, photorealistic avatars. — [repo](https://github.com/sign/translate), [LICENSE](https://github.com/sign/translate/blob/master/LICENSE.md), [EMNLP 2024 paper](https://aclanthology.org/2024.emnlp-demo.19)
- sign-language-processing org: `pose` 114 stars MIT (2026-09-19); `spoken-to-signed-translation` 103 stars MIT (2026-10-02); `sign-language-processing.github.io` 147 stars CC-BY-4.0 (survey); `recognition` 1 star MIT (stale 2024). — [pose](https://github.com/sign-language-processing/pose), [spoken-to-signed](https://github.com/sign-language-processing/spoken-to-signed-translation)
- Skunk0/openglasses-fingerspelling-ctc (Hugging Face): Core ML CTC over MediaPipe Holistic landmarks, Apache-2.0 weights, 20.8% mean CER (median 10.8%) on 300-seq held-out, trained on Google ASL Fingerspelling (CC-BY 4.0). — [HF](https://huggingface.co/Skunk0/openglasses-fingerspelling-ctc)
- ColdSlim/ASL-TFLite-Edge: Apache-2.0 TFLite, 59 ASL classes from hand landmarks, no accuracy reported. — [HF](https://huggingface.co/ColdSlim/ASL-TFLite-Edge/blob/main/README.md)
- OpenFS (arXiv 2602.22949, Feb 2026): 93.7 letter accuracy, 59.4 top-1 on FSboard, 8.81M params vs 300M ByT5-based baseline. — [paper](https://arxiv.org/abs/2602.22949)
- Older: WLASL dataset repo 1,281 stars, no license on repo (dataset terms are restrictive, treat as research-only); AI4Bharat OpenHands 135 stars Apache-2.0, stale since 2023; sign-language-translator 376 stars Apache-2.0, stale 2024. — [WLASL](https://github.com/dxli94/WLASL), [OpenHands](https://github.com/AI4Bharat/OpenHands)

### Inferences
- three.ws's `@three-ws/pose` plus the camera-graded Sign Mirror are ahead of GitHub's hobby ASL repos (single-digit stars). Worth benchmarking its recognizer against the Skunk0 CTC model on the same held-out set. The Google ASL Fingerspelling corpus (CC-BY 4.0) is the best commercially usable training data; sign.mt avatar/translation ideas must be rebuilt, not copied.

### Gaps
- No verified 2026 open-weights ASL word-level (isolated or continuous) model with published accuracy found. OpenFS weights not confirmed. three.ws's own accuracy number was not compared (not measured here).

## Summary verdict table

| Repo | Stars (2026-10-09) | License | Verdict |
|---|---|---|---|
| home-assistant/core | 91,335 | Apache-2.0 | Integrate via open APIs (already covered, deepen) |
| homeassistant-ai/ha-mcp | 4,997 | MIT | Adopt design, rebuild; or recommend alongside |
| OHF-Voice/wyoming, linux-voice-assistant, openWakeWord | 401 / 647 / 2,828 | MIT / Apache-2.0 / Apache-2.0 | Adopt code |
| piper1-gpl | 5,807 | GPL-3.0 | Process boundary only |
| Frigate | 36,447 | MIT | Integrate via HA, do not rebuild |
| Matter SDK | 8,961 | Apache-2.0 | Via HA only |
| ESPHome / Voice PE | 11,799 / 766 | NOASSERTION / Other | Adopt design; check files |
| openHAB core/addons | 1,148 / 2,063 | EPL-2.0 | API integration only |
| MentraOS | 2,382 | Apache-2.0 | Adopt code (MiniApp) |
| Omi | 13,673 | MIT | Adopt design, rebuild |
| Open Interpreter 01 | 5,159 | AGPL-3.0 | Skip (stale) |
| openpilot | 63,851 | MIT | Design reference only |
| LeRobot / SO-ARM100 | 28,035 / 7,706 | Apache-2.0 | Adopt code (bridge) |
| Reachy Mini | 1,540 | Apache-2.0 | Adopt design (app distribution) |
| openpi / GR00T / OpenVLA | 14,151 / 8,179 / 7,127 | Apache / Apache+NVIDIA OML / MIT+Llama | Via LeRobot, check weight license |
| MediaPipe | 37,202 | Apache-2.0 | Already covered (in use) |
| sign.mt | 794 | CC BY-NC-SA 4.0 | Non-commercial; design only |
