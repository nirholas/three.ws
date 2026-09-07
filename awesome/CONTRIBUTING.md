# Contributing to Awesome 3D Agents

The list is generated. `awesome/README.md` is an output file, so an edit made
there is overwritten by the next build. Entries live in
[`data/awesome.json`](../data/awesome.json).

## Add an entry

1. Open `data/awesome.json` and find the section it belongs in.
2. Add an object to that section's `items` array:

```json
{
  "name": "glTF-Transform",
  "url": "https://github.com/donmccurdy/glTF-Transform",
  "description": "Read, edit, optimise, and validate glTF from Node or the CLI.",
  "tags": ["oss", "js", "cli"]
}
```

3. Regenerate and check:

```bash
npm run build:awesome    # rewrites awesome/README.md and public/awesome.json
npm run awesome:links    # fetches every url and reports anything unreachable
```

4. Commit `data/awesome.json` together with both generated files.

## What gets in

The bar is "a working engineer would be glad someone showed them this".

- **It has to be usable now.** A repo with no release, no docs, and no commits
  in two years is a bookmark, not a recommendation.
- **It has to earn its section.** Fifteen text-to-3D models that do the same
  thing help nobody. If a new entry beats an existing one on the same job, say
  so in the description, or replace the old one.
- **One sentence, under 260 characters.** Say what it does and why you would
  reach for it over the alternative. The build fails on longer descriptions.
- **No em-dash (U+2014) or en-dash (U+2013).** House rule across this repository.
  Use a period, a comma, a colon, or parentheses. A plain hyphen is fine. The
  build fails on either dash.
- **No marketing copy.** "Blazing fast next-generation platform" tells a reader
  nothing. "Single image to 3D in under a second on one GPU" does.
- **Working links only.** `npm run awesome:links` classifies each url as ok,
  moved, blocked (a bot filter on a live site, verify it by hand), or broken.
  A broken url fails the run.

## Tags

Tags drive the filter chips on [three.ws/awesome](https://three.ws/awesome).
Reuse an existing tag when one fits rather than inventing a synonym; a tag used
only once stays searchable but is not offered as a chip. Common ones:

`oss`, `service`, `free`, `spec`, `dataset`, `research`, `foundational`,
`python`, `js`, `cpp`, `rust`, `threejs`, `gltf`, `fast`, `edge`.

## Sections

A new section is a bigger change than a new entry. Propose it in an issue
first, with the three or more entries that would fill it. Sections are ordered
along the pipeline: generate, capture, embody, rig, animate, speak, render,
ship, connect.
