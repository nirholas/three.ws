# distributions/

Packaging and listing sources for third-party distribution channels. Each subdirectory is the source of truth for what we publish to that channel.

| Directory | Channel |
|---|---|
| [hermes/](hermes) | Hermes agent overlay: three.ws plugin plus install scripts for Linux/macOS and Windows. |
| [nvidia-brev/](nvidia-brev/README.md) | NVIDIA Brev launchable (Dockerfile, license notes). |
| [pay-skills/](pay-skills/README.md) | Pay-skills provider catalog (PAY.md plus OpenAPI per service). |
| [sync/](sync) | Cloud Build job and scripts that run one scheduled pass over every externally hosted distribution (Hermes merge and overlay refresh, extension publish). |
| [winget/](winget/README.md) | Windows Package Manager manifests and schemas. |
