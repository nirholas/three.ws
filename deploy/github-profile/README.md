# deploy/github-profile

Keeps the [github.com/nirholas](https://github.com/nirholas) profile repository current on its own. Once a day, Cloud Scheduler sends [build.json](build.json) to the Cloud Build API. The build clones the public `scripts/` directory of this repo and runs [scripts/build-github-profile.mjs](../../scripts/build-github-profile.mjs) `--publish`. That rebuilds the catalog, charts, `repos.json` and llms files from the live GitHub listing and pushes them to `nirholas/nirholas`.

| Piece | Value |
| --- | --- |
| Scheduler job | `github-profile-refresh`, `us-central1`, daily at 09:17 UTC |
| Build identity | `three-ws-build@` (needs `actAs` on itself to start the build) |
| GitHub token | Secret Manager `github-profile-token`, push access on `nirholas/nirholas` |
| Build tag | `github-profile-refresh` |

The build runs the script as committed on `main` of `nirholas/three.ws`, so a generator change takes effect on the first run after it is pushed. A rebuild where nothing changed except the "Pulled from the GitHub API on" date is not committed.

## Operate

```bash
node scripts/schedule-github-profile.mjs            # create or update the job from build.json
node scripts/schedule-github-profile.mjs --run-now  # and trigger one run now
gcloud builds list --filter="tags=github-profile-refresh" --limit=5 --project=aerial-vehicle-466722-p5
```

Do not edit the profile README on github.com. The next run overwrites it. Change the generator instead; see [docs/github-growth.md](../../docs/github-growth.md).

To rotate the token, add a new version to `github-profile-token`. Builds read `latest`.
