use schemars::JsonSchema;
use serde::Deserialize;
use std::env;
use zed_extension_api::{
    self as zed, serde_json, settings::ContextServerSettings, Command, ContextServerConfiguration,
    ContextServerId, Project, Result,
};

const PACKAGE_NAME: &str = "@three-ws/mcp-server";
const SERVER_PATH: &str = "node_modules/@three-ws/mcp-server/src/index.js";

#[derive(Debug, Deserialize, JsonSchema)]
struct ThreeWsSettings {
    /// Base URL of the three.ws API the tools call. Leave empty for https://three.ws.
    #[serde(default)]
    base_url: Option<String>,
    /// Solana USDC address that receives payment when you operate the server for others. Optional.
    #[serde(default)]
    payment_address: Option<String>,
}

struct ThreeWsExtension;

impl zed::Extension for ThreeWsExtension {
    fn new() -> Self {
        Self
    }

    fn context_server_command(
        &mut self,
        _context_server_id: &ContextServerId,
        project: &Project,
    ) -> Result<Command> {
        let latest_version = zed::npm_package_latest_version(PACKAGE_NAME)?;
        let installed = zed::npm_package_installed_version(PACKAGE_NAME)?;
        if installed.as_deref() != Some(latest_version.as_str()) {
            zed::npm_install_package(PACKAGE_NAME, &latest_version)?;
        }

        let settings = ContextServerSettings::for_project("three-ws", project)?;
        let parsed: ThreeWsSettings = match settings.settings {
            Some(value) => serde_json::from_value(value).map_err(|e| e.to_string())?,
            None => ThreeWsSettings { base_url: None, payment_address: None },
        };

        let mut server_env = Vec::new();
        if let Some(base) = parsed.base_url.filter(|v| !v.trim().is_empty()) {
            server_env.push(("THREEWS_BASE_URL".to_string(), base));
        }
        if let Some(addr) = parsed.payment_address.filter(|v| !v.trim().is_empty()) {
            server_env.push(("MCP_SVM_PAYMENT_ADDRESS".to_string(), addr));
        }

        let server_path = env::current_dir()
            .map_err(|e| e.to_string())?
            .join(SERVER_PATH)
            .to_string_lossy()
            .to_string();

        Ok(Command {
            command: zed::node_binary_path()?,
            args: vec![server_path],
            env: server_env,
        })
    }

    fn context_server_configuration(
        &mut self,
        _context_server_id: &ContextServerId,
        _project: &Project,
    ) -> Result<Option<ContextServerConfiguration>> {
        let installation_instructions =
            include_str!("../configuration/installation_instructions.md").to_string();
        let default_settings = include_str!("../configuration/default_settings.jsonc").to_string();
        let settings_schema = serde_json::to_string(&schemars::schema_for!(ThreeWsSettings))
            .map_err(|e| e.to_string())?;

        Ok(Some(ContextServerConfiguration {
            installation_instructions,
            default_settings,
            settings_schema,
        }))
    }
}

zed::register_extension!(ThreeWsExtension);
