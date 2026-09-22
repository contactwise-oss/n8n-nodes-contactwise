#!/bin/sh
# Runs n8n 2.40.5 in Docker with this package installed where `npm install` would put it, so the
# node type is @contactwise/n8n-nodes-contactwise.contactWiseSms and the examples/ workflows import.
# n8n's data (owner account, credentials, workflows) lives in the n8n-contactwise-dev volume and
# survives restarts. `n8n-node build` deletes and recreates dist/, which breaks a live bind mount,
# so every run recreates the container. Run it with `npm run dev:docker`, which builds first.
set -eu

NAME=n8n-contactwise-dev
IMAGE=n8nio/n8n:2.40.5
PKG=/home/node/.n8n/nodes/node_modules/@contactwise/n8n-nodes-contactwise

docker rm -f "$NAME" >/dev/null 2>&1 || true

# Docker would create the mount points' parent folders as root, and n8n then fails at startup
# with EACCES writing ~/.n8n/nodes/package.json. Create them first, owned by the image's node user.
docker run --rm --user root --entrypoint sh -v "$NAME:/home/node/.n8n" "$IMAGE" \
	-c "mkdir -p '$PKG' && chown -R node:node /home/node/.n8n"

# Bind to loopback only: this instance keeps running in the background and holds a real
# ContactWise API key, so it must not be reachable from the local network.
docker run -d --name "$NAME" -p 127.0.0.1:5678:5678 \
	-v "$NAME:/home/node/.n8n" \
	-v "$(pwd)/package.json:$PKG/package.json:ro" \
	-v "$(pwd)/dist:$PKG/dist:ro" \
	"$IMAGE" >/dev/null

echo "n8n is starting on http://localhost:5678"
echo "Logs: npm run dev:docker:logs    Stop: npm run dev:docker:stop"
