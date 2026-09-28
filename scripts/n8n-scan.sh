#!/bin/sh
# Runs n8n's community package scan on a published version and fails on any finding.
# The scanner exits 0 even when it reports "❌ … has failed security checks" (found on
# TIN-59), so the result is read from its output, not only from the exit code.
# Usage: sh scripts/n8n-scan.sh @contactwise/n8n-nodes-contactwise@0.3.1
# Needs Node 24: on Node 26 the scanner exits silently.
set -u

PACKAGE=${1:?usage: n8n-scan.sh <package@version>}
VERSION=${PACKAGE##*@}

# npm can take several minutes to serve a new version. Scanning before then fails the
# provenance check with the same "failed security checks" as a real finding (0.3.1).
for wait in $(seq 1 40); do
	[ "$(npm view "$PACKAGE" version 2>/dev/null)" = "$VERSION" ] && break
	echo "Waiting for $PACKAGE on npm ($wait/40)"
	sleep 15
done

for attempt in 1 2 3 4 5; do
	output=$(npx -y @n8n/scan-community-package "$PACKAGE" 2>&1)
	status=$?
	printf '%s\n' "$output" | grep -v '^npm \(notice\|warn\)'

	# A finding is final: retrying won't change it.
	if printf '%s\n' "$output" | grep -q 'failed security checks'; then
		echo "n8n scan failed for $PACKAGE"
		exit 1
	fi
	if [ "$status" -eq 0 ] && ! printf '%s\n' "$output" | grep -q '❌' &&
		printf '%s\n' "$output" | grep -q '✅ Analyzed'; then
		echo "n8n scan passed for $PACKAGE"
		exit 0
	fi

	# Anything else (a registry hiccup) is retried.
	echo "Scan attempt $attempt didn't finish; retrying in 30s"
	sleep 30
done
exit 1
