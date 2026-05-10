use crate::error::AppError;
use serde_json::json;
use sqlx::PgPool;
use std::collections::{HashMap, VecDeque};
use uuid::Uuid;

pub async fn outage_simulate(
    pool: &PgPool,
    diagram_id: Uuid,
    disconnect_instance_id: Uuid,
) -> Result<serde_json::Value, AppError> {
    struct InstanceInfo {
        id: Uuid,
        label: String,
        component_category: String,
        district: Option<(Option<f64>, Option<String>, Option<String>, Option<i32>)>,
    }

    let rows = sqlx::query_as::<_, (Uuid, String, String)>(
        r#"SELECT di.id, di.label, c.category
           FROM diagram_instances di
           JOIN components c ON di.component_id = c.id
           WHERE di.diagram_id = $1"#
    )
    .bind(diagram_id)
    .fetch_all(pool)
    .await?;

    let mut instances: HashMap<Uuid, InstanceInfo> = HashMap::new();
    for (id, label, cat) in rows {
        let dd = sqlx::query_as::<_, (Option<f64>, Option<String>, Option<String>, Option<i32>)>(
            "SELECT transformer_capacity, supply_range, supply_area, household_count FROM district_data WHERE diagram_instance_id = $1"
        )
        .bind(id).fetch_optional(pool).await?;

        instances.insert(id, InstanceInfo {
            id, label, component_category: cat,
            district: dd,
        });
    }

    let dc = instances.get(&disconnect_instance_id).ok_or_else(|| AppError::NotFound("断开实例不存在".into()))?;
    if dc.component_category != "switchPoint" {
        return Err(AppError::BadRequest("断开点必须是开关类元件".into()));
    }

    let edge_rows = sqlx::query_as::<_, (Uuid, Uuid)>(
        "SELECT source_instance_id, target_instance_id FROM diagram_edges WHERE diagram_id = $1"
    )
    .bind(diagram_id)
    .fetch_all(pool)
    .await?;

    let mut adj: HashMap<Uuid, Vec<Uuid>> = HashMap::new();
    for (from, to) in &edge_rows {
        if from == &disconnect_instance_id || to == &disconnect_instance_id { continue; }
        if instances.contains_key(from) && instances.contains_key(to) {
            adj.entry(*from).or_default().push(*to);
            adj.entry(*to).or_default().push(*from);
        }
    }
    adj.remove(&disconnect_instance_id);

    let power_sources: Vec<Uuid> = instances.iter()
        .filter(|(_, v)| v.component_category == "powerPoint")
        .map(|(k, _)| *k)
        .collect();

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

    let (reachable_ids, unreachable_ids): (Vec<Uuid>, Vec<Uuid>) = instances.keys()
        .filter(|id| *id != &disconnect_instance_id)
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

pub async fn power_flow() -> Result<(), AppError> {
    Err(AppError::BadRequest("潮流计算功能暂未实现".into()))
}

pub async fn fault_analysis() -> Result<(), AppError> {
    Err(AppError::BadRequest("故障分析功能暂未实现".into()))
}
