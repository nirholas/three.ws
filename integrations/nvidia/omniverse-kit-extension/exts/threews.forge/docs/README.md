# three.ws Forge for Omniverse Kit

Generate a textured 3D model from a text prompt or a reference image with
[three.ws Forge](https://three.ws/forge) and drop it into the open stage,
upright and to scale. Browse the models saved in your three.ws account and
import any of them with one click.

## Open the panel

Enable `threews.forge` in the Extension Manager, then choose
**Window > three.ws Forge**.

## Generate

1. Pick **Text prompt** and describe one subject ("a brass ship lantern"), or
   pick **Reference image** and choose a PNG, JPEG or WebP file, or paste a
   public `https://` image URL.
2. Pick a quality lane (every lane needs a three.ws API key, from a free account):
   - **Draft**: fast, low poly. Free.
   - **Standard**: textured. Free.
   - **High**: dense mesh with PBR materials. Spends account credits.
3. Pick where it lands: the world origin, the selected prim, or in front of the
   active camera.
4. Press **Generate**. Progress shows the real job state from the server.
   **Cancel** stops waiting at once; Kit stays responsive the whole time.

The GLB is converted with the Kit asset converter and referenced under
`/World/threews/<name>`. A glTF file is
Y-up in meters; the import reads the stage's `upAxis` and `metersPerUnit` and
authors the rotation and scale on the wrapper prim, so a 1 m model is 1 m in a
Z-up centimeter stage too.

Models saved by three.ws are often web-optimized (meshopt compression,
quantized attributes, WebP textures), which the Kit converter cannot read. The
extension decodes those locally into a plain GLB first, so every saved model
imports.

## API key

Draft and Standard work without one. For High, the model library and saving to
your account, create a key at
[three.ws/dashboard/api](https://three.ws/dashboard/api) and paste it into the
**Account** section. It is stored in Kit's persistent settings
(`/persistent/exts/threews.forge/apiKey`), shown masked, and never written to
the log. A render farm or test node can set `THREEWS_API_KEY` instead.

Every failure says what happened and what to do: a missing, mistyped, expired or
revoked key, a key without the needed scope, an account that cannot run the
High lane, rate limiting, or the network being down (network errors are retried
with backoff before anything is shown).

## My models

The **My models** section lists the models in your account, with **Load more**
for long libraries. **Import** brings one into the stage with the same placement
and unit handling as a fresh generation; a model three.ws also stores as USDZ is
referenced directly, with no conversion.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `/persistent/exts/threews.forge/baseUrl` | `https://three.ws` | API origin |
| `/persistent/exts/threews.forge/lane` | `standard` | Last quality lane |
| `/persistent/exts/threews.forge/placement` | `origin` | `origin`, `selection` or `camera` |
| `/persistent/exts/threews.forge/saveToAccount` | `false` | Also save each generation to your three.ws models |

## Support

Source, issues and the full developer guide:
<https://github.com/nirholas/three.ws/tree/main/integrations/nvidia/omniverse-kit-extension>
