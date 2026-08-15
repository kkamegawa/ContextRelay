# Release & Versioning

The extension version in `package.json` is derived from the git tag that
triggers a release. You do not need to edit the `version` field by hand for a
release.

## Tag format

- Tags must use a lowercase `v` prefix followed by a strict
  [SemVer](https://semver.org/) version, for example `v1.2.3`.
- Pre-release tags are supported, for example `v1.2.3-beta.1`.
- An uppercase `V` prefix (e.g. `V1.2.3`) or a missing prefix (e.g. `1.2.3`) is
  rejected.
- The leading `v` is stripped to produce the `package.json` version
  (`v1.2.3` → `1.2.3`).

## Source of truth

The git tag is the source of truth for a release build. During the release
workflow the version is applied to `package.json` (and `package-lock.json`)
before anything is built or packaged, then verified against the produced VSIX
manifest. A mismatch fails the build.

## Cutting a release

1. Make sure the commit you want to release is on `main`.
2. Create and push a version tag:

   ```sh
   git tag v1.2.3
   git push origin v1.2.3
   ```

3. The `Release VSIX` workflow (triggered by `v*.*.*` tags) will:
   - sync `package.json` to the tag version,
   - build and package the extension into a VSIX,
   - verify the VSIX manifest version matches the tag,
   - upload the VSIX as a build artifact, and
   - create a draft GitHub Release with generated notes and the VSIX attached.

4. After the workflow completes, open the draft GitHub Release and review the
   generated notes, tag, version, and attached VSIX. When the release is ready,
   select **Publish release** manually. The workflow does not publish the
   release automatically.

## Local / CI tag-based builds

The default `npm run package` does **not** change the version, so day-to-day
development is unaffected.

To reproduce a tag-based build locally, sync the version from the latest version
tag reachable from your current commit, then package:

```sh
npm run version:from-tag   # applies the latest reachable v* tag to package.json
npm run package
npm run vsce:package
```

- `npm run version:resolve` prints the resolved version without changing files.
- `npm run version:from-tag` applies it via
  `npm version --no-git-tag-version --allow-same-version --ignore-scripts`.
- If no reachable version tag exists, both commands fail with a clear error.

"Latest tag" means the newest `v*` tag reachable from the current commit history
(discovered with `git tag --list 'v*' --sort=-v:refname --merged HEAD`), not the
globally newest tag in the repository.

## Implementation

The shared logic lives in [`scripts/tag-version.cjs`](../scripts/tag-version.cjs)
and is covered by unit tests in
[`src/test/suite/tagVersion.test.ts`](../src/test/suite/tagVersion.test.ts).
