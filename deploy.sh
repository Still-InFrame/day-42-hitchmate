#!/usr/bin/env bash
#
# deploy.sh — deploy THIS app to Vercel and attach its subdomain.
# Run from this folder once the app works:   ./deploy.sh
#
# Subdomain auto-provisions DNS + SSL because Vercel runs 100dayaichallenge.com's DNS.
# Safe to re-run: link/domain steps no-op if they already exist.

set -euo pipefail

SLUG="hitchmate"
DOMAIN="${SLUG}.100dayaichallenge.com"
# Vercel CLI 54.x refuses to auto-pick a team in non-interactive mode ("No default
# is applied") — without an explicit scope the link step HANGS with no output. Pass
# it once on `link`; that writes .vercel/project.json (orgId), and every later
# command inherits the scope from there. This is the "still-inframe" account's team.
SCOPE="still-inframes-projects"

# Run the Vercel CLI via npx (global installs fail on this machine; --cache dodges the
# corrupted npm cache). A function avoids zsh/bash word-splitting issues.
# NOTE: if a run ever hangs at 0 bytes, the npx cache is poisoned (usually from a
# killed run) — fix with:  rm -rf /tmp/npm-vercel-cache
vercel_cli() { npx --yes --cache /tmp/npm-vercel-cache vercel@latest "$@"; }

echo "Linking to Vercel (scope: ${SCOPE})..."
# Output is intentionally VISIBLE now — if the CLI blocks or errors, you see why.
vercel_cli link --yes --scope "$SCOPE"

echo "Deploying to production..."
vercel_cli --prod   # inherits scope from the link above

# The linked project's name (Vercel defaults it to the folder name). Needed because
# the CLI now requires a project to attach a SUBDOMAIN (apex domains don't).
PROJECT="$(basename "$PWD")"
if [ -f .vercel/project.json ]; then
  P="$(sed -n 's/.*"projectName":"\([^"]*\)".*/\1/p' .vercel/project.json)"
  [ -n "$P" ] && PROJECT="$P"
fi

echo "Attaching ${DOMAIN} to project ${PROJECT}..."
# Capture the result so the final message is HONEST. Re-runs report "already added";
# both that and a fresh "added" mean the domain is attached. `|| true` keeps set -e
# from aborting on the benign re-run case.
DOMAIN_OUT="$(vercel_cli domains add "$DOMAIN" "$PROJECT" 2>&1 || true)"
echo "$DOMAIN_OUT"
if echo "$DOMAIN_OUT" | grep -qiE 'added|already|assigned|success'; then
  DOMAIN_STATUS="Live at:  https://${DOMAIN}   (DNS + SSL settle in ~1 min)"
else
  DOMAIN_STATUS="SUBDOMAIN NOT ATTACHED — see output above. Retry:
            npx --yes --cache /tmp/npm-vercel-cache vercel@latest domains add ${DOMAIN} ${PROJECT} --scope ${SCOPE}"
fi

# ---------- Sync the live URL back to GitHub ----------
# Lands the live link in the repo automatically (Website field + README) so it's
# never a manual step. Idempotent + order-independent: works whether you ran
# publish/backup BEFORE or AFTER this deploy. (Daily apps deploy via the Vercel
# CLI, not a git connection, so this push does NOT trigger a redeploy.)
LIVE_URL="https://${DOMAIN}"
echo "Syncing live URL to the repo..."

# README: insert/replace a single "**Live:**" line just under the H1 title.
if [ -f README.md ]; then
  if grep -q '^\*\*Live:\*\*' README.md; then
    sed -i '' -e "s|^\*\*Live:\*\*.*|**Live:** ${LIVE_URL}|" README.md
  else
    awk -v url="$LIVE_URL" 'NR==1{print; print ""; print "**Live:** " url; next} {print}' \
      README.md > README.md.tmp && mv README.md.tmp README.md
  fi
fi

if git remote get-url origin >/dev/null 2>&1; then
  # Set the repo's Website field (the link at the top of the GitHub repo page).
  command -v gh >/dev/null 2>&1 && gh repo edit --homepage "$LIVE_URL" >/dev/null 2>&1 || true
  # Push the README change, if there is one.
  if [ -n "$(git status --porcelain README.md 2>/dev/null)" ]; then
    git add README.md
    git commit -q -m "docs: add live URL (${LIVE_URL})"
    git push -q origin main 2>/dev/null || true
  fi
  SYNCED="GitHub repo Website field set + README updated and pushed."
else
  SYNCED="README updated locally (no GitHub repo yet) — run ./publish.sh or ./backup.sh to push it."
fi

cat <<EOF

  Deployed.
  ${DOMAIN_STATUS}
  Also at:  the *.vercel.app URL printed above.
  GitHub:   ${SYNCED}

  Google-auth apps work automatically: the sandbox's *.100dayaichallenge.com
  wildcard already covers https://${DOMAIN}. Sign in via THIS subdomain
  (not the raw *.vercel.app URL).
  Log the app at https://100dayaichallenge.com

EOF
