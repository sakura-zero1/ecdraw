use crate::error::AppError;
use crate::middleware;
use crate::AppState;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{HashMap, VecDeque};
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize)]
pub struct OutageSimulateInput {
    pub token: String,
    pub diagram_id: String,
    pub disconnect_instance_id: String,
}

/// POST /api/analysis/outage-simulate
#[tauri::command]
pub async fn outage_simulate(
    state: State<'_, AppState>,
    input: OutageSimulateInput,
) -> Result<serde_json::Value, AppError> {
    let claims = middleware::verify_auth(&input.token, &state.jwt_access_secret)?;
    middleware::require_role(&claims, &["ADMIN", "DIAGRAM_EDITOR", "VIEWER"])?;
    let did: Uuid = input.diagram_id.parse().map_err(|_| AppError::BadRequest("无效的图纸ID".into()))?;
    let dc_id: Uuid = input.disconnect_instance_id.parse().map_err(|_| AppError::BadRequest("无效的实例ID".into()))?;

    // Fetch instances with component category
    struct InstanceInfo {
        id: Uuid,
        label: String,
        component_category: String,
        has_district: bool,
        district: Option<(Option<f64>, Option<String>, Option<String>, Option<i32>)>,
    }

    let rows = sqlx::query_as::<_, (Uuid, String, String)>(
        r#"SELECT di.id, di.label, c.category
           FROM diagram_instances di
           JOIN components c ON di.component_id = c.id
           WHERE di.diagram_id = $1"#
    )
    .bind(did)
    .fetch_all(&state.pool)
    .await?;

    let mut instances: HashMap<Uuid, InstanceInfo> = HashMap::new();
    for (id, label, cat) in rows {
        // Fetch district data
        let dd = sqlx::query_as::<_, (Option<f64>, Option<String>, Option<String>, Option<i32>)>(
            "SELECT transformer_capacity, supply_range, supply_area, household_count FROM district_data WHERE diagram_instance_id = $1"
        )
        .bind(id).fetch_optional(&state.pool).await?;

        instances.insert(id, InstanceInfo {
            id, label, component_category: cat,
            has_district: dd.is_some(),
            district: dd,
        });
    }

    // Verify disconnect instance
    let dc = instances.get(&dc_id).ok_or_else(|| AppError::NotFound("断开实例不存在".into()))?;
    if dc.component_category != "switchPoint" {
        return Err(AppError::BadRequest("断开点必须是开关类元件".into()));
    }

    // Fetch edges
    let edge_rows = sqlx::query_as::<_, (Uuid, Uuid)>(
        "SELECT source_instance_id, target_instance_id FROM diagram_edges WHERE diagram_id = $1"
    )
    .bind(did)
    .fetch_all(&state.pool)
    .await?;

    // Build adjacency list, excluding edges connected to disconnect instance
    let mut adj: HashMap<Uuid, Vec<Uuid>> = HashMap::new();
    for (from, to) in &edge_rows {
        if from == &dc_id || to == &dc_id { continue; }
        if instances.contains_key(from) && instances.contains_key(to) {
            adj.entry(*from).or_default().push(*to);
            adj.entry(*to).or_default().push(*from);
        }
    }
    // Remove disconnect instance from adjacency
    adj.remove(&dc_id);

    // Find all power sources
    let power_sources: Vec<Uuid> = instances.iter()
        .filter(|(_, v)| v.component_category == "powerPoint")
        .map(|(k, _)| *k)
        .collect();

    // BFS from power sources
    let mut reachable: HashMap<Uuid, bool> = HashMap::new();
    let mut queue = VecDeque::new();
    for ps in &power_sources {
        if instances.contains_key(ps) {
            reachable.insert(*ps, true);
            queue.push_back(*ps);
        }
    }
    while let Some(current) = queue.pop_front() {
        if let Some(neighbors) = adj.get(&current) {
            for n in neighbors {
                if !reachable.contains_key(n) {
                    reachable.insert(*n, true);
                    queue.push_back(*n);
                }
            }
        }
    }

    // Categorize instances (excluding the disconnect one)
    let (reachable_ids, unreachable_ids): (Vec<Uuid>, Vec<Uuid>) = instances.keys()
        .filter(|id| *id != &dc_id)
        .partition(|id| reachable.contains_key(id));

    let mut affected_districts = Vec::new();
    let mut affected_household_count: i64 = 0;
    for uid in &unreachable_ids {
        if let Some(info) = instances.get(uid) {
            if let Some((tc, sr, sa, hc)) = &info.district {
                affected_districts.push(json!({
                    "instanceId": uid,
                    "label": info.label,
                    "transformerCapacity": tc,
                    "supplyRange": sr,
                    "supplyArea": sa,
                    "householdCount": hc,
                }));
                affected_household_count += hc.unwrap_or(0) as i64;
            }
        }
    }

    Ok(json!({
        "reachableInstanceIds": reachable_ids,
        "unreachableInstanceIds": unreachable_ids,
        "statistics": {
            "affectedDistrictCount": affected_districts.len(),
            "affectedHouseholdCount": affected_household_count,
            "affectedDistricts": affected_districts,
        }
    }))
}

/// POST /api/analysis/power-flow (stub)
#[tauri::command]
pub async fn power_flow(
    _state: State<'_, AppState>,
    token: String,
) -> Result<(), AppError> {
    let _claims = middleware::verify_auth(&token, &_state.jwt_access_secret)?;
    middleware::require_role(&_claims, &["ADMIN", "DIAGRAM_EDITOR", "VIEWER"])?;
    Err(AppError::BadRequest("潮流计算功能暂未实现".into()))
}

/// POST /api/analysis/fault-analysis (stub)
#[tauri::command]
pub async fn fault_analysis(
    _state: State<'_, AppState>,
    token: String,
) -> Result<(), AppError> {
    let _claims = middleware::verify_auth(&token, &_state.jwt_access_secret)?;
    middleware::require_role(&_claims, &["ADMIN", "DIAGRAM_EDITOR"])?;
    Err(AppError::BadRequest("故障分析功能暂未实现".into()))
}
