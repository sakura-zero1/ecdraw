import { useEffect, useState } from 'react';
import { fetchDashboard, type DashboardData } from '../services/adminApi';

const STATUS_LABELS: Record<string, string> = {
  DRAFT: '草稿',
  PENDING_REVIEW: '待审核',
  PUBLISHED: '已发布',
  REJECTED: '已驳回',
};

const STATUS_CLASS: Record<string, string> = {
  DRAFT: 'draft',
  PENDING_REVIEW: 'pending',
  PUBLISHED: 'published',
  REJECTED: 'rejected',
};

function parseApiError(error: unknown) {
  if (!(error instanceof Error)) return '请求失败';
  try {
    const payload = JSON.parse(error.message) as { message?: string };
    return payload.message || error.message;
  } catch {
    return error.message || '请求失败';
  }
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await fetchDashboard();
      setData(result);
    } catch (e) {
      setError(parseApiError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (loading && !data) {
    return (
      <div className="workspace-page">
        <div className="page-head">
          <h3>数据统计概览</h3>
        </div>
        <div className="empty-hint">加载中...</div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="workspace-page">
        <div className="page-head">
          <h3>数据统计概览</h3>
          <button className="btn btn-sm" onClick={() => void load()}>
            重试
          </button>
        </div>
        <div className="form-error">{error}</div>
      </div>
    );
  }

  if (!data) return null;

  const statCards = [
    { label: '用户数', value: data.userCount },
    { label: '元件数', value: data.componentCount },
    { label: '图纸数', value: data.diagramCount },
    { label: '已发布', value: data.publishedCount },
    { label: '待审核', value: data.pendingReviewCount },
    { label: '实例数', value: data.instanceCount },
    { label: '连线数', value: data.edgeCount },
    { label: '台区数据', value: data.districtDataCount },
    { label: '线路数据', value: data.lineDataCount },
    { label: '地理数据', value: data.gisDataCount },
  ];

  // Compute bar chart max for scaling
  const maxCount = Math.max(
    ...data.diagramsByStatus.map((d) => d.count),
    1,
  );

  return (
    <div className="workspace-page">
      <div className="page-head">
        <h3>数据统计概览</h3>
        <div className="page-actions">
          <button className="btn btn-sm" onClick={() => void load()} disabled={loading}>
            刷新
          </button>
        </div>
      </div>

      {error ? <div className="form-error">{error}</div> : null}

      <div className="dashboard-stats">
        {statCards.map((card) => (
          <div key={card.label} className="stat-card">
            <div className="stat-card-label">{card.label}</div>
            <div className="stat-card-value">{card.value.toLocaleString()}</div>
          </div>
        ))}
      </div>

      <div className="dashboard-section">
        <div className="dashboard-status-chart">
          <h4 style={{ margin: '0 0 12px', fontSize: '14px' }}>图纸状态分布</h4>
          {['DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'REJECTED'].map((status) => {
            const entry = data.diagramsByStatus.find((d) => d.status === status);
            const count = entry?.count ?? 0;
            const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
            return (
              <div key={status} className="status-bar">
                <span className="status-bar-label">{STATUS_LABELS[status] || status}</span>
                <div className="status-bar-track">
                  <div
                    className={`status-bar-fill ${STATUS_CLASS[status] || ''}`}
                    style={{ width: `${Math.max(pct, count > 0 ? 8 : 0)}%` }}
                  >
                    {count > 0 ? count : ''}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="dashboard-recent">
          <h4>最近操作</h4>
          {data.recentAudits.length === 0 ? (
            <div style={{ color: '#94a3b8', fontSize: '12px' }}>暂无操作记录</div>
          ) : (
            data.recentAudits.map((audit) => (
              <div key={audit.id} className="dashboard-recent-item">
                <span className="dashboard-recent-time">
                  {new Date(audit.createdAt).toLocaleString('zh-CN', {
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
                <span className="dashboard-recent-user">{audit.user.username}</span>
                <span className="dashboard-recent-action">{audit.action}</span>
                <span style={{ color: '#94a3b8' }}>{audit.targetType}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
