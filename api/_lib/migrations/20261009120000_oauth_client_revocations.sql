-- Immediate revocation for OAuth connected apps.
--
-- Access tokens are stateless JWTs that live an hour, so deleting an app's
-- refresh tokens alone left a revoked cloud connector working until its current
-- access token expired. One row per (user, client) records the moment the person
-- revoked it; authenticateBearer rejects any access token issued at or before
-- that moment. A token minted after the person re-authorizes the app is newer
-- than the row and works again.
CREATE TABLE IF NOT EXISTS oauth_client_revocations (
    user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id  text        NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
    revoked_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, client_id)
);
