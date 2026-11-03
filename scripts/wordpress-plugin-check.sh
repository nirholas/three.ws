#!/usr/bin/env bash
# Runs the official WordPress Plugin Check plugin against
# integrations/wordpress/three-ws-agent/ in a disposable local WordPress,
# entirely in Docker. No account, no network access from WordPress itself
# beyond installing Plugin Check from wordpress.org. After Plugin Check it
# publishes one page with the block and one with the shortcode, fetches both
# over HTTP, and fails unless each serves a real <agent-3d> element plus the
# loader script pinned to the release and SRI hash in includes/pinned-release.php.
#
#   scripts/wordpress-plugin-check.sh
#   WP_PORT=8090 scripts/wordpress-plugin-check.sh   # host port for the page fetch (default 8089)
#   WP_KEEP=1 scripts/wordpress-plugin-check.sh      # leave WordPress running to open in a browser
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_DIR="$ROOT/integrations/wordpress/three-ws-agent"
NET="three-ws-plugin-check"
DB="three-ws-plugin-check-db"
WP="three-ws-plugin-check-wp"
WP_PORT="${WP_PORT:-8089}"
WP_URL="http://localhost:$WP_PORT"

cleanup() {
	docker rm -f "$WP" "$DB" >/dev/null 2>&1 || true
	docker network rm "$NET" >/dev/null 2>&1 || true
}
if [ "${WP_KEEP:-}" = "1" ]; then
	trap 'echo "[plugin-check] WP_KEEP=1: WordPress left running at $WP_URL (admin/admin). Remove with: docker rm -f $WP $DB && docker network rm $NET"' EXIT
else
	trap cleanup EXIT
fi

cleanup
docker network create "$NET" >/dev/null

docker run -d --name "$DB" --network "$NET" \
	-e MYSQL_ROOT_PASSWORD=root \
	-e MYSQL_DATABASE=wordpress \
	-e MYSQL_USER=wordpress \
	-e MYSQL_PASSWORD=wordpress \
	mysql:8 >/dev/null

docker run -d --name "$WP" --network "$NET" \
	-e WORDPRESS_DB_HOST="$DB" \
	-e WORDPRESS_DB_USER=wordpress \
	-e WORDPRESS_DB_PASSWORD=wordpress \
	-e WORDPRESS_DB_NAME=wordpress \
	-p "$WP_PORT:80" \
	-v "$PLUGIN_DIR:/var/www/html/wp-content/plugins/three-ws-agent" \
	wordpress:php8.2-apache >/dev/null

echo "[plugin-check] waiting for MySQL..."
for _ in $(seq 1 30); do
	if docker exec "$DB" mysqladmin ping -h 127.0.0.1 -uroot -proot --silent >/dev/null 2>&1; then break; fi
	sleep 2
done

echo "[plugin-check] waiting for WordPress..."
for _ in $(seq 1 30); do
	if docker exec "$WP" curl -sf -o /dev/null http://localhost/wp-admin/install.php; then break; fi
	sleep 2
done

wpcli() {
	docker run --rm --network "$NET" \
		--volumes-from "$WP" \
		-e WORDPRESS_DB_HOST="$DB" \
		-e WORDPRESS_DB_USER=wordpress \
		-e WORDPRESS_DB_PASSWORD=wordpress \
		-e WORDPRESS_DB_NAME=wordpress \
		--workdir /var/www/html \
		wordpress:cli-php8.2 wp --allow-root "$@"
}

echo "[plugin-check] fixing wp-content permissions (the apache and cli images run as different uids)..."
docker exec "$WP" chmod -R 0777 /var/www/html/wp-content

echo "[plugin-check] installing WordPress core..."
wpcli core install \
	--url="$WP_URL" \
	--title="three.ws Plugin Check" \
	--admin_user=admin \
	--admin_password=admin \
	--admin_email=admin@example.com \
	--skip-email

echo "[plugin-check] WordPress version: $(wpcli core version)"

echo "[plugin-check] activating three-ws-agent..."
wpcli plugin activate three-ws-agent

echo "[plugin-check] installing the official Plugin Check plugin from wordpress.org..."
wpcli plugin install plugin-check --activate

echo "[plugin-check] running wp plugin check three-ws-agent..."
wpcli plugin check three-ws-agent --format=table

PIN_FILE="$PLUGIN_DIR/includes/pinned-release.php"
PIN_URL="$(sed -n "s/^define('THREE_WS_AGENT3D_JS_URL', '\(.*\)');$/\1/p" "$PIN_FILE")"
PIN_SRI="$(sed -n "s/^define('THREE_WS_AGENT3D_JS_INTEGRITY', '\(.*\)');$/\1/p" "$PIN_FILE")"
MODEL="https://three.ws/avatars/default.glb"

echo "[plugin-check] publishing a block page and a shortcode page..."
BLOCK_ID="$(wpcli post create --post_type=page --post_status=publish --post_title='Block render' \
	--post_content="<!-- wp:three-ws/agent-3d {\"modelUrl\":\"$MODEL\",\"background\":\"dark\"} /-->" --porcelain)"
SHORT_ID="$(wpcli post create --post_type=page --post_status=publish --post_title='Shortcode render' \
	--post_content="[three_ws_agent model=\"$MODEL\" framing=\"portrait\"]" --porcelain)"

assert_render() {
	local label="$1" id="$2" expect="$3" html
	html="$(curl -sfL "$WP_URL/?page_id=$id")"
	if ! grep -qF "$expect" <<<"$html"; then
		echo "[plugin-check] FAIL: $label page $id has no '$expect'" >&2
		exit 1
	fi
	if ! grep -q "<script type=\"module\" src=\"${PIN_URL}[^\"]*\" integrity=\"${PIN_SRI}\" crossorigin=\"anonymous\">" <<<"$html"; then
		echo "[plugin-check] FAIL: $label page $id is missing the pinned loader $PIN_URL with integrity $PIN_SRI" >&2
		exit 1
	fi
	echo "[plugin-check] $label renders: $(grep -oE '<agent-3d [^>]*>' <<<"$html" | head -1)"
}

assert_render block "$BLOCK_ID" "<agent-3d body=\"$MODEL\" background=\"dark\" framing=\"full\""
assert_render shortcode "$SHORT_ID" "<agent-3d body=\"$MODEL\" background=\"transparent\" framing=\"portrait\""
echo "[plugin-check] pinned loader on both pages: $PIN_URL ($PIN_SRI)"
echo "[plugin-check] block page: $WP_URL/?page_id=$BLOCK_ID  shortcode page: $WP_URL/?page_id=$SHORT_ID"
