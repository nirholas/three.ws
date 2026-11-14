-- PKCE becomes optional for one class of OAuth client: a confidential client an
-- operator registered by hand (oauth_clients.dynamically_registered = false,
-- created with scripts/oauth-register-client.mjs). Microsoft's MCP
-- certification service connects that way and supports neither PKCE nor
-- Dynamic Client Registration. Every self-registered client still has to send
-- a code_challenge (api/oauth/[action].js, pkceOptional), so a code row without
-- one can only belong to a client that proves its secret at /oauth/token.

alter table oauth_auth_codes alter column code_challenge drop not null;
alter table oauth_auth_codes alter column code_challenge_method drop not null;
