## Release

To release a new version:

1. Run `EXPORT VERSION="x.z.z"`
2. Update `version` in `package.json` and `package-lock.json`.
3. Commit changes.
4. Run `git tag "v${VERSION}" && git push --tags`
5. Run `npm publish`.
6. Build and push docker image:
```
EXPORT VERSION="x.z.z"
docker build -t "widdix/widdix:v${VERSION}" .
docker tag "widdix/widdix:v${VERSION}" widdix/widdix:latest
docker push "widdix/widdix:v${VERSION}"
docker push widdix/widdix:latest
```
