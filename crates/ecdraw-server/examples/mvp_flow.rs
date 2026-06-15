// ECDraw MVP 流程自动化验证
//
// 跑法：
//   1. 先在另一个终端启动 server：cargo run -p ecdraw-server
//   2. 在第二个终端跑此 example：cargo run -p ecdraw-server --example mvp_flow
//
// 行为：
//   - 用 admin 账户登录
//   - 列出元件库，挑一个有 pin 的元件
//   - 新建一张测试图纸（名字带 __mvp_test_ 前缀，便于识别）
//   - 拖入 5 个实例
//   - 加 3 条边（如挑到的元件没有可用 pin 则跳过）
//   - save 保存草稿
//   - 重新 GET editor，校验实例/边数量、坐标、连接关系
//   - 最后清理：删除测试图纸
//
// 退出码：0=全部通过，1=有失败项

use anyhow::{anyhow, bail, Context, Result};
use reqwest::Client;
use serde_json::{json, Value};
use std::env;
use std::time::Instant;

const DEFAULT_BASE: &str = "http://127.0.0.1:3001";
const DEFAULT_USER: &str = "admin";
const DEFAULT_PASS: &str = "Admin123456";
const TEST_DIAGRAM_PREFIX: &str = "__mvp_test_";

struct Ctx {
    client: Client,
    base: String,
    token: String,
}

impl Ctx {
    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base, path)
    }
}

#[derive(Default)]
struct Report {
    passed: Vec<String>,
    failed: Vec<String>,
    skipped: Vec<String>,
}

impl Report {
    fn pass(&mut self, name: &str) {
        println!("  ✓ {}", name);
        self.passed.push(name.into());
    }
    fn fail(&mut self, name: &str, why: &str) {
        println!("  ✗ {} —— {}", name, why);
        self.failed.push(format!("{}: {}", name, why));
    }
    fn skip(&mut self, name: &str, why: &str) {
        println!("  ⊘ {} (skipped: {})", name, why);
        self.skipped.push(format!("{}: {}", name, why));
    }
    fn summary(&self) {
        println!();
        println!("========== MVP 验收报告 ==========");
        println!("  通过: {}", self.passed.len());
        println!("  失败: {}", self.failed.len());
        println!("  跳过: {}", self.skipped.len());
        if !self.failed.is_empty() {
            println!();
            println!("失败项:");
            for f in &self.failed {
                println!("  - {}", f);
            }
        }
        if !self.skipped.is_empty() {
            println!();
            println!("跳过项:");
            for s in &self.skipped {
                println!("  - {}", s);
            }
        }
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let base = env::var("ECDRAW_BASE").unwrap_or_else(|_| DEFAULT_BASE.into());
    let user = env::var("ECDRAW_USER").unwrap_or_else(|_| DEFAULT_USER.into());
    let pass = env::var("ECDRAW_PASS").unwrap_or_else(|_| DEFAULT_PASS.into());

    println!("=== ECDraw MVP 流程自动化验证 ===");
    println!("Server: {}", base);
    println!("User:   {}", user);
    println!();

    let started = Instant::now();
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()?;

    let mut report = Report::default();

    // ---------- 1. 登录 ----------
    println!("[1] 登录");
    let token = match login(&client, &base, &user, &pass).await {
        Ok(t) => {
            report.pass("登录成功，拿到 access_token");
            t
        }
        Err(e) => {
            report.fail("登录", &format!("{:#}", e));
            report.summary();
            std::process::exit(1);
        }
    };

    let ctx = Ctx { client, base, token };

    // ---------- 2. 列出元件 ----------
    println!("\n[2] 元件库");
    let components = match list_components(&ctx).await {
        Ok(c) => {
            report.pass(&format!("list_components 成功，共 {} 个元件", c.len()));
            c
        }
        Err(e) => {
            report.fail("list_components", &format!("{:#}", e));
            cleanup_and_exit(&ctx, None, report).await;
            return Ok(());
        }
    };

    if components.is_empty() {
        report.fail("元件库", "为空 —— MVP 无法进行（请先在元件库新建至少一个元件）");
        cleanup_and_exit(&ctx, None, report).await;
        return Ok(());
    }

    // 选一个有 pin 的元件用于连线测试
    let (comp_id, pins): (String, Vec<String>) = pick_component_with_pins(&components)
        .map(|(id, pins)| (id, pins))
        .unwrap_or_else(|| {
            // 没有带 pin 的，用第一个
            let id = components[0].get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            (id, vec![])
        });

    println!("  选用元件: {}", comp_id);
    println!("  可用 pin 数: {}", pins.len());

    // ---------- 3. 创建测试图纸 ----------
    println!("\n[3] 创建测试图纸");
    let diagram_name = format!("{}{}", TEST_DIAGRAM_PREFIX, chrono_like_stamp());
    let diagram_id = match create_diagram(&ctx, &diagram_name).await {
        Ok(id) => {
            report.pass(&format!("创建图纸 {}", diagram_name));
            id
        }
        Err(e) => {
            report.fail("create_diagram", &format!("{:#}", e));
            cleanup_and_exit(&ctx, None, report).await;
            return Ok(());
        }
    };

    // ---------- 4. 拖入 5 个实例 ----------
    println!("\n[4] 拖入 5 个实例");
    let mut instance_ids: Vec<String> = Vec::new();
    let positions = [
        (100.0, 100.0),
        (300.0, 100.0),
        (500.0, 100.0),
        (200.0, 300.0),
        (400.0, 300.0),
    ];
    for (i, (x, y)) in positions.iter().enumerate() {
        match create_instance(&ctx, &diagram_id, &comp_id, *x, *y).await {
            Ok(iid) => {
                report.pass(&format!("instance #{} 创建于 ({}, {})", i + 1, x, y));
                instance_ids.push(iid);
            }
            Err(e) => {
                report.fail(&format!("create_instance #{}", i + 1), &format!("{:#}", e));
            }
        }
    }

    if instance_ids.len() < 2 {
        report.fail("实例创建", "成功创建少于 2 个，无法继续测连线");
        cleanup_and_exit(&ctx, Some(&diagram_id), report).await;
        return Ok(());
    }

    // ---------- 5. 加 3 条边 ----------
    println!("\n[5] 加 3 条边");
    let mut edge_ids: Vec<String> = Vec::new();
    if pins.len() < 2 {
        report.skip("create_edge", "选用元件 pin 数 < 2，无法测连线");
    } else {
        let edge_specs = [
            (0_usize, 1, &pins[0], &pins[1]),
            (1, 2, &pins[0], &pins[1]),
            (3, 4, &pins[0], &pins[1]),
        ];
        for (src_i, tgt_i, src_pin, tgt_pin) in edge_specs.iter() {
            if *src_i >= instance_ids.len() || *tgt_i >= instance_ids.len() {
                continue;
            }
            match create_edge(
                &ctx,
                &diagram_id,
                &instance_ids[*src_i],
                &instance_ids[*tgt_i],
                src_pin,
                tgt_pin,
            )
            .await
            {
                Ok(eid) => {
                    report.pass(&format!("edge: instance#{} -> instance#{}", src_i + 1, tgt_i + 1));
                    edge_ids.push(eid);
                }
                Err(e) => {
                    report.fail(
                        &format!("create_edge #{}->#{}", src_i + 1, tgt_i + 1),
                        &format!("{:#}", e),
                    );
                }
            }
        }
    }

    // ---------- 6. 保存草稿 ----------
    println!("\n[6] 保存草稿");
    let snapshot = json!({
        "schemaVersion": 1,
        "instances": [],
        "connections": [],
        "viewport": { "zoom": 0.5, "panX": 0, "panY": 0 }
    });
    match save_diagram(&ctx, &diagram_id, snapshot).await {
        Ok(_) => report.pass("save_diagram 成功"),
        Err(e) => report.fail("save_diagram", &format!("{:#}", e)),
    }

    // ---------- 7. 重新加载验证 ----------
    println!("\n[7] 重新加载验证（模拟关闭重开）");
    match get_editor(&ctx, &diagram_id).await {
        Ok(editor) => {
            let loaded_instances = editor
                .get("instances")
                .and_then(|v| v.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            let loaded_edges = editor
                .get("edges")
                .and_then(|v| v.as_array())
                .map(|a| a.len())
                .unwrap_or(0);

            if loaded_instances == instance_ids.len() {
                report.pass(&format!("实例数一致 ({})", loaded_instances));
            } else {
                report.fail(
                    "实例数",
                    &format!("期望 {}, 实际 {}", instance_ids.len(), loaded_instances),
                );
            }

            if loaded_edges == edge_ids.len() {
                report.pass(&format!("边数一致 ({})", loaded_edges));
            } else {
                report.fail(
                    "边数",
                    &format!("期望 {}, 实际 {}", edge_ids.len(), loaded_edges),
                );
            }

            // 校验坐标
            if let Some(arr) = editor.get("instances").and_then(|v| v.as_array()) {
                let mut coord_ok = true;
                for (i, inst) in arr.iter().enumerate() {
                    if let Some(id) = inst.get("id").and_then(|v| v.as_str()) {
                        if let Some(orig_idx) = instance_ids.iter().position(|x| x == id) {
                            let (ex, ey) = positions[orig_idx];
                            let ax = inst.get("positionX").and_then(|v| v.as_f64()).unwrap_or(-1.0);
                            let ay = inst.get("positionY").and_then(|v| v.as_f64()).unwrap_or(-1.0);
                            if (ax - ex).abs() > 0.5 || (ay - ey).abs() > 0.5 {
                                report.fail(
                                    &format!("instance#{} 坐标", i + 1),
                                    &format!("期望 ({}, {}), 实际 ({}, {})", ex, ey, ax, ay),
                                );
                                coord_ok = false;
                            }
                        }
                    }
                }
                if coord_ok {
                    report.pass("所有实例坐标一致");
                }
            }
        }
        Err(e) => report.fail("get_editor 重新加载", &format!("{:#}", e)),
    }

    // ---------- 8. 清理 ----------
    println!("\n[8] 清理测试数据");
    cleanup_and_exit(&ctx, Some(&diagram_id), report).await;

    println!("\n耗时: {:.2}s", started.elapsed().as_secs_f64());
    Ok(())
}

async fn cleanup_and_exit(ctx: &Ctx, diagram_id: Option<&str>, mut report: Report) {
    if let Some(id) = diagram_id {
        match delete_diagram(ctx, id).await {
            Ok(_) => report.pass("删除测试图纸"),
            Err(e) => report.fail("delete_diagram", &format!("{:#}", e)),
        }
    }
    report.summary();
    if !report.failed.is_empty() {
        std::process::exit(1);
    }
}

// ---------- HTTP helpers ----------

async fn login(client: &Client, base: &str, user: &str, pass: &str) -> Result<String> {
    let resp = client
        .post(format!("{}/api/auth/login", base))
        .json(&json!({ "username": user, "password": pass }))
        .send()
        .await
        .context("发送登录请求失败 (server 是否在 {base} 上运行？)")?;
    let status = resp.status();
    let body: Value = resp.json().await.context("登录响应不是 JSON")?;
    if !status.is_success() {
        bail!("登录失败 ({}): {}", status, body);
    }
    let token = body
        .get("access_token")
        .or_else(|| body.get("accessToken"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("登录响应缺少 access_token: {}", body))?;
    Ok(token.to_string())
}

async fn list_components(ctx: &Ctx) -> Result<Vec<Value>> {
    let resp = ctx
        .client
        .get(ctx.url("/api/components"))
        .bearer_auth(&ctx.token)
        .send()
        .await?;
    let status = resp.status();
    let body: Value = resp.json().await?;
    if !status.is_success() {
        bail!("list_components 失败 ({}): {}", status, body);
    }
    Ok(body.as_array().cloned().unwrap_or_default())
}

fn pick_component_with_pins(components: &[Value]) -> Option<(String, Vec<String>)> {
    for c in components {
        let id = c.get("id").and_then(|v| v.as_str()).unwrap_or("");
        if id.is_empty() {
            continue;
        }
        // pins 可能在 latestVersion.snapshot.pins
        let pins = c
            .get("latestVersion")
            .and_then(|v| v.get("snapshot"))
            .and_then(|v| v.get("pins"))
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|p| p.get("id").and_then(|v| v.as_str()).map(String::from))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        if pins.len() >= 2 {
            return Some((id.to_string(), pins));
        }
    }
    None
}

async fn create_diagram(ctx: &Ctx, name: &str) -> Result<String> {
    let resp = ctx
        .client
        .post(ctx.url("/api/diagrams"))
        .bearer_auth(&ctx.token)
        .json(&json!({ "name": name }))
        .send()
        .await?;
    let status = resp.status();
    let body: Value = resp.json().await?;
    if !status.is_success() {
        bail!("create_diagram 失败 ({}): {}", status, body);
    }
    body.get("id")
        .and_then(|v| v.as_str())
        .map(String::from)
        .ok_or_else(|| anyhow!("create_diagram 响应缺少 id: {}", body))
}

async fn create_instance(ctx: &Ctx, diagram_id: &str, comp_id: &str, x: f64, y: f64) -> Result<String> {
    let resp = ctx
        .client
        .post(ctx.url(&format!("/api/diagrams/{}/instances", diagram_id)))
        .bearer_auth(&ctx.token)
        .json(&json!({
            "componentId": comp_id,
            "positionX": x,
            "positionY": y,
        }))
        .send()
        .await?;
    let status = resp.status();
    let body: Value = resp.json().await?;
    if !status.is_success() {
        bail!("create_instance 失败 ({}): {}", status, body);
    }
    body.get("id")
        .and_then(|v| v.as_str())
        .map(String::from)
        .ok_or_else(|| anyhow!("create_instance 响应缺少 id: {}", body))
}

async fn create_edge(
    ctx: &Ctx,
    diagram_id: &str,
    src_inst: &str,
    tgt_inst: &str,
    src_pin: &str,
    tgt_pin: &str,
) -> Result<String> {
    let resp = ctx
        .client
        .post(ctx.url(&format!("/api/diagrams/{}/edges", diagram_id)))
        .bearer_auth(&ctx.token)
        .json(&json!({
            "sourceInstanceId": src_inst,
            "targetInstanceId": tgt_inst,
            "sourcePinId": src_pin,
            "targetPinId": tgt_pin,
        }))
        .send()
        .await?;
    let status = resp.status();
    let body: Value = resp.json().await?;
    if !status.is_success() {
        bail!("create_edge 失败 ({}): {}", status, body);
    }
    body.get("id")
        .and_then(|v| v.as_str())
        .map(String::from)
        .ok_or_else(|| anyhow!("create_edge 响应缺少 id: {}", body))
}

async fn save_diagram(ctx: &Ctx, diagram_id: &str, snapshot: Value) -> Result<()> {
    let resp = ctx
        .client
        .post(ctx.url(&format!("/api/diagrams/{}/save", diagram_id)))
        .bearer_auth(&ctx.token)
        .json(&json!({ "snapshot": snapshot }))
        .send()
        .await?;
    let status = resp.status();
    if !status.is_success() {
        let body: Value = resp.json().await.unwrap_or(Value::Null);
        bail!("save_diagram 失败 ({}): {}", status, body);
    }
    Ok(())
}

async fn get_editor(ctx: &Ctx, diagram_id: &str) -> Result<Value> {
    let resp = ctx
        .client
        .get(ctx.url(&format!("/api/diagrams/{}/editor", diagram_id)))
        .bearer_auth(&ctx.token)
        .send()
        .await?;
    let status = resp.status();
    let body: Value = resp.json().await?;
    if !status.is_success() {
        bail!("get_editor 失败 ({}): {}", status, body);
    }
    Ok(body)
}

async fn delete_diagram(ctx: &Ctx, diagram_id: &str) -> Result<()> {
    let resp = ctx
        .client
        .delete(ctx.url(&format!("/api/diagrams/{}", diagram_id)))
        .bearer_auth(&ctx.token)
        .send()
        .await?;
    let status = resp.status();
    if !status.is_success() {
        let body: Value = resp.json().await.unwrap_or(Value::Null);
        bail!("delete_diagram 失败 ({}): {}", status, body);
    }
    Ok(())
}

fn chrono_like_stamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{}", secs)
}
