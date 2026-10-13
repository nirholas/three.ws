#!/usr/bin/env bash
# Runs the official WordPress Plugin Check plugin against
# integrations/wordpress/three-ws-agent/ in a disposable local WordPress,
# entirely in Docker. No account, no network access from WordPress itself
# beyond installing Plugin Check from wordpress.org.
#
#   scripts/wordpress-plugin-check.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_DIR="$ROOT/integrations/wordpress/three-ws-agent"
NET="three-ws-plugin-check"
DB="three-ws-plugin-check-db"
WP="three-ws-plugin-check-wp"

cleanup() {
	docker rm -f "$WP" "$DB" >/dev/null 2>&1 || true
	docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT

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
	--url="http://localhost" \
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
