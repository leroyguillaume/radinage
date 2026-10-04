#!/usr/bin/env bash
# Cuts a release: bumps the committed version, regenerates what derives from
# it, commits, tags, and asks before pushing.
set -euo pipefail

usage() {
	cat <<'EOF'
Usage: scripts/release.sh [--dry-run] VERSION
       scripts/release.sh [--dry-run] --chart [--app-version VERSION] VERSION

Application release (tag vVERSION): bumps the Cargo workspace and the webapp.
Chart release (tag chart-VERSION): bumps helm/radinage/Chart.yaml. appVersion
defaults to the latest v* tag; --app-version pins another released one.

Options:
  --chart              release the Helm chart instead of the application
  --app-version V      appVersion to pin in the chart (must be a v* tag)
  --dry-run            print what would change, change nothing
  -h, --help           show this help

Examples:
  scripts/release.sh 0.2.0
  scripts/release.sh 0.2.0-rc1
  scripts/release.sh --chart 0.2.0
  scripts/release.sh --chart --app-version 0.1.0 0.1.1
EOF
}

die() {
	echo "error: $*" >&2
	exit 1
}

chart=false
dry_run=false
app_version=""
version=""

while [ $# -gt 0 ]; do
	case "$1" in
	--chart) chart=true ;;
	--app-version)
		[ $# -ge 2 ] || die "--app-version needs a value"
		app_version="$2"
		shift
		;;
	--dry-run) dry_run=true ;;
	-h | --help)
		usage
		exit 0
		;;
	-*) die "unknown option: $1 (see --help)" ;;
	*)
		[ -z "$version" ] || die "only one VERSION is accepted"
		version="$1"
		;;
	esac
	shift
done

semver='^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'
[ -n "$version" ] || die "VERSION is required (see --help)"
[[ "$version" =~ $semver ]] || die "VERSION must be semver, got '$version'"
[ -z "$app_version" ] || $chart || die "--app-version only applies with --chart"

cd "$(git rev-parse --show-toplevel)"

chart_dir=helm/radinage
default_branch="$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||')"
default_branch="${default_branch:-main}"
branch="$(git rev-parse --abbrev-ref HEAD)"

[ -z "$(git status --porcelain)" ] || die "working tree is not clean"
[ "$branch" = "$default_branch" ] || die "releases are cut from $default_branch, not $branch"
git fetch --quiet --tags origin "$default_branch"
[ "$(git rev-list --count "HEAD..origin/$default_branch")" -eq 0 ] ||
	die "$branch is behind origin/$default_branch: pull first"

if $chart; then
	tag="chart-$version"
	if [ -z "$app_version" ]; then
		app_version="$(git tag --list 'v*' | sort -V | tail -n 1)"
		app_version="${app_version#v}"
		[ -n "$app_version" ] || die "no v* tag to pin as appVersion: pass --app-version"
	fi
	git rev-parse --quiet --verify "refs/tags/v$app_version" >/dev/null ||
		die "appVersion $app_version is not a released tag (v$app_version)"
	current="$(sed -n 's/^version: //p' "$chart_dir/Chart.yaml")"
	subject="chart: release $version"
else
	tag="v$version"
	current="$(cargo metadata --no-deps --format-version 1 | jq -r '.packages[0].version')"
	subject="release $version"
fi

! git rev-parse --quiet --verify "refs/tags/$tag" >/dev/null || die "tag $tag already exists"

if $dry_run; then
	echo "current version: $current"
	echo "target version:  $version"
	! $chart || echo "appVersion:      $app_version"
	echo "commit subject:  $subject"
	echo "tag:             $tag"
	exit 0
fi

if $chart; then
	sed -i.bak -E "s/^version: .*/version: $version/; s/^appVersion: .*/appVersion: \"$app_version\"/" \
		"$chart_dir/Chart.yaml"
	rm "$chart_dir/Chart.yaml.bak"
	helm-docs --chart-search-root "$chart_dir"
	# An rc must not become what the README tells people to install.
	if [ "${version#*-}" = "$version" ]; then
		sed -i.bak -E "s/(helm install .*--version )[^ ]+/\1$version/" README.md
		rm README.md.bak
	fi
	git add "$chart_dir/Chart.yaml" "$chart_dir/README.md" README.md
else
	cargo set-version --workspace "$version"
	(cd radinage-webapp && npm version "$version" --no-git-tag-version >/dev/null)
	git add Cargo.toml Cargo.lock radinage-webapp/package.json radinage-webapp/package-lock.json
fi

git commit --quiet --message "$subject"
git tag --annotate "$tag" --message "$subject"
echo "committed and tagged $tag"

push_cmd="git push --atomic origin $branch $tag"
if [ -t 0 ]; then
	printf 'push %s and %s to origin? this publishes the release. [y/N] ' "$branch" "$tag"
	read -r reply
	case "$reply" in
	y | Y | yes)
		$push_cmd
		exit 0
		;;
	esac
fi
echo "not pushed. publish later with: $push_cmd"
