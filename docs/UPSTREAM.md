# Upstream Sync

`origin` is the OSIRIS fork and `upstream` is `https://github.com/simplifaisoul/osiris`.

```sh
git fetch upstream
git checkout master
git merge --ff-only upstream/master
git push origin master
```

Keep fork changes on feature branches and merge them normally. If the fast-forward fails, resolve a regular merge or rebase on a feature branch; do not force-push the published baseline.
