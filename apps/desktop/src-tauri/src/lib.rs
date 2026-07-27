use std::{
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};

use serde::Serialize;
use tauri::{Manager, State};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};
use uuid::Uuid;

const GATEWAY_DISCOVERY_FILENAME: &str = "agent-gateway.json";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackendInfo {
    origin: String,
    desktop: bool,
    desktop_copy_token: String,
    discovery_file: String,
    agent_command: String,
    agent_command_ready: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentGatewayManifest {
    schema_version: u8,
    service: &'static str,
    transport: &'static str,
    origin: String,
    pid: u32,
    started_at: String,
}

struct BackendState {
    info: BackendInfo,
    child: Mutex<Option<CommandChild>>,
    discovery_file: PathBuf,
    discovery_content: String,
}

#[tauri::command]
fn backend_info(state: State<'_, BackendState>) -> BackendInfo {
    state.info.clone()
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![backend_info])
        .setup(|app| {
            let port = reserve_loopback_port()?;
            let resource_root = resource_root(app)?;
            let data_root = data_root(app, &resource_root)?;
            std::fs::create_dir_all(&data_root)?;

            let origin = format!("http://127.0.0.1:{port}");
            let desktop_copy_token =
                format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
            let sidecar = app
                .shell()
                .sidecar("token-plan-media-server")?
                .args([
                    "--port",
                    &port.to_string(),
                    "--resource-root",
                    &path_argument(&resource_root),
                    "--data-root",
                    &path_argument(&data_root),
                    "--parent-pid",
                    &std::process::id().to_string(),
                ])
                .env("TP_MEDIA_DESKTOP_COPY_TOKEN", &desktop_copy_token);
            let (mut events, child) = sidecar.spawn()?;

            tauri::async_runtime::spawn(async move {
                while let Some(event) = events.recv().await {
                    match event {
                        CommandEvent::Stdout(bytes) => {
                            println!("[media-server] {}", String::from_utf8_lossy(&bytes));
                        }
                        CommandEvent::Stderr(bytes) => {
                            eprintln!("[media-server] {}", String::from_utf8_lossy(&bytes));
                        }
                        CommandEvent::Error(message) => {
                            eprintln!("[media-server] {message}");
                        }
                        CommandEvent::Terminated(payload) => {
                            eprintln!("[media-server] exited: {:?}", payload.code);
                        }
                        _ => {}
                    }
                }
            });

            if let Err(error) = wait_for_backend(port, Duration::from_secs(12)) {
                let _ = child.kill();
                return Err(error);
            }
            let (discovery_file, discovery_content) = publish_gateway_discovery(app, &origin)?;
            let agent_command = agent_mcp_path()?;
            let agent_command_ready = agent_command.is_file();
            app.manage(BackendState {
                info: BackendInfo {
                    origin,
                    desktop: true,
                    desktop_copy_token,
                    discovery_file: path_argument(&discovery_file),
                    agent_command: path_argument(&agent_command),
                    agent_command_ready,
                },
                child: Mutex::new(Some(child)),
                discovery_file,
                discovery_content,
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build Token Plan Media Hub desktop app");

    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            if let Some(state) = app_handle.try_state::<BackendState>() {
                if let Ok(mut child) = state.child.lock() {
                    if let Some(process) = child.take() {
                        let _ = process.kill();
                    }
                }
                remove_owned_discovery_file(&state.discovery_file, &state.discovery_content);
            }
        }
    });
}

fn reserve_loopback_port() -> Result<u16, Box<dyn std::error::Error>> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

fn wait_for_backend(port: u16, timeout: Duration) -> Result<(), Box<dyn std::error::Error>> {
    let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port);
    let started = Instant::now();
    while started.elapsed() < timeout {
        if TcpStream::connect_timeout(&address, Duration::from_millis(250)).is_ok() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Err(format!("local media server did not start on {address}").into())
}

fn resource_root(app: &tauri::App) -> Result<PathBuf, Box<dyn std::error::Error>> {
    if cfg!(debug_assertions) {
        return Ok(Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../..")
            .canonicalize()?);
    }
    Ok(app.path().resource_dir()?)
}

fn data_root(
    app: &tauri::App,
    resource_root: &Path,
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    if cfg!(debug_assertions) {
        return Ok(resource_root.join("runtime"));
    }
    Ok(app.path().app_local_data_dir()?)
}

fn publish_gateway_discovery(
    app: &tauri::App,
    origin: &str,
) -> Result<(PathBuf, String), Box<dyn std::error::Error>> {
    let directory = app.path().app_local_data_dir()?;
    std::fs::create_dir_all(&directory)?;
    let discovery_file = directory.join(GATEWAY_DISCOVERY_FILENAME);
    let temporary_file = directory.join(format!(
        ".{GATEWAY_DISCOVERY_FILENAME}.{}.tmp",
        std::process::id()
    ));
    let content = format!(
        "{}\n",
        serde_json::to_string_pretty(&AgentGatewayManifest {
            schema_version: 1,
            service: "token-plan-media-hub",
            transport: "loopback-http",
            origin: origin.to_owned(),
            pid: std::process::id(),
            started_at: OffsetDateTime::now_utc().format(&Rfc3339)?,
        })?
    );

    std::fs::write(&temporary_file, &content)?;
    if discovery_file.exists() {
        std::fs::remove_file(&discovery_file)?;
    }
    std::fs::rename(&temporary_file, &discovery_file)?;
    Ok((discovery_file, content))
}

fn remove_owned_discovery_file(path: &Path, expected_content: &str) {
    if std::fs::read_to_string(path).is_ok_and(|content| content == expected_content) {
        let _ = std::fs::remove_file(path);
    }
}

fn agent_mcp_path() -> Result<PathBuf, Box<dyn std::error::Error>> {
    let executable = std::env::current_exe()?;
    let directory = executable
        .parent()
        .ok_or("desktop executable has no parent directory")?;
    let extension = if cfg!(windows) { ".exe" } else { "" };
    Ok(directory.join(format!("token-plan-media-mcp{extension}")))
}

fn path_argument(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}
