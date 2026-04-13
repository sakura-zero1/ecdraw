import { useEffect, useState, useMemo } from 'react';
import { fetchAuditLogs, type AuditItem } from '../services/auditApi';

const TARGET_TYPES = [
  'ALL',
  'Diagram',
  'ReviewRequest',
  'Component',
  'DiagramInstance',
  'DiagramEdge',
  'DistrictData',
  'LineSegmentData',
  'GisData',
] as const;

const TYPE_LABELS: Record<string, string> = {
  ALL: '全部',
  Diagram: '图纸',
  ReviewRequest: '审核请求',
  Component: '元件',
  DiagramInstance: '图纸实例',
  DiagramEdge: '图纸边',
  DistrictData: '台区数据',
  LineSegmentData: '线路数据',
  GisData: '地理数据',
  User: '用户',
};

const COMMON_ACTIONS = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'PUBLISH',
  'UNPUBLISH',
  'APPROVE',
  'REJECT',
  'LOGIN',
  'LOGOUT',
  'DIAGRAM_CREATE',
  'DIAGRAM_UPDATE',
  'DIAGRAM_DELETE',
  'DIAGRAM_PUBLISH',
  'DIAGRAM_UNPUBLISH',
  'DIAGRAM_SUBMIT_REVIEW',
  'DISTRICT_CREATE',
  'DISTRICT_UPDATE',
  'DISTRICT_DELETE',
  'LINE_CREATE',
  'LINE_UPDATE',
  'LINE_DELETE',
  'GIS_CREATE',
  'GIS_UPDATE',
  'GIS_DELETE',
];

function parseApiError(error: unknown) {
  if (!(error instanceof Error)) return '请求失败';
  try {
    const payload = JSON.parse(error.message) as { message?: string };
    return payload.message || error.message;
  } catch {
    return error.message || '请求失败';
  }
}

export default function AuditPage() {
  const [items, setItems] = useState<AuditItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const [filters, setFilters] = useState({
    targetType: 'ALL',
    action: '',
    targetId: '',
    page: 1,
    pageSize: 20,
  });

  const { totalPages, total } = useMemo(() => {
    return {
      totalPages: Math.ceil(items.length / filters.pageSize),
      total: items.length,
    };
  }, [items.length, filters.pageSize]);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const { page, pageSize, targetType, action, targetId } = filters;
      const result = await fetchAuditLogs({
        targetType: targetType === 'ALL' ? undefined : targetType,
        action: action || undefined,
        targetId: targetId || undefined,
        page,
        pageSize,
      });
      setItems(result.items);
    } catch (e) {
      setError(parseApiError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [filters]);

  const handleFilterChange = (key: keyof typeof filters, value: string | number) => {
    setFilters((prev) => ({
      ...prev,
      [key]: value,
      page: 1,
    }));
  };

  const handleRefresh = () => {
    void load();
  };

  const handlePageChange = (newPage: number) => {
    setFilters((prev) => ({
      ...prev,
      page: newPage,
    }));
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const getUniqueActions = () => {
    const actions = new Set<string>();
    items.forEach(item => {
      if (item.action) actions.add(item.action);
    });
    return Array.from(actions).sort();
  };

  const { todayCount, weekCount, mostActiveUser } = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 7);

    let today = 0;
    let week = 0;
    const userCounts: Record<string, number> = {};

    for (const item of items) {
      const d = new Date(item.createdAt);
      if (d >= todayStart) today++;
      if (d >= weekStart) week++;
      const name = item.user.username;
      userCounts[name] = (userCounts[name] || 0) + 1;
    }

    let topUser = '-';
    let topCount = 0;
    for (const [name, count] of Object.entries(userCounts)) {
      if (count > topCount) {
        topUser = name;
        topCount = count;
      }
    }

    return { todayCount: today, weekCount: week, mostActiveUser: topUser };
  }, [items]);

  return (
    <div className="workspace-page">
      <div className="page-head">
        <h3>审计日志</h3>
        <div className="page-actions">
          <button className="btn" onClick={handleRefresh}>
            刷新
          </button>
        </div>
      </div>

      <div className="audit-summary">
        <div className="audit-summary-card">
          <div className="audit-summary-label">今日操作</div>
          <div className="audit-summary-value">{todayCount}</div>
        </div>
        <div className="audit-summary-card">
          <div className="audit-summary-label">本周操作</div>
          <div className="audit-summary-value">{weekCount}</div>
        </div>
        <div className="audit-summary-card">
          <div className="audit-summary-label">最活跃用户</div>
          <div className="audit-summary-value" style={{ fontSize: '16px' }}>{mostActiveUser}</div>
        </div>
      </div>

      <div className="card">
        <div className="form-row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 120 }}>
            <select
              value={filters.targetType}
              onChange={(e) => handleFilterChange('targetType', e.target.value)}
            >
              {TARGET_TYPES.map(type => (
                <option key={type} value={type}>
                  {TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </div>

          <div style={{ flex: 1, minWidth: 120 }}>
            <select
              value={filters.action}
              onChange={(e) => handleFilterChange('action', e.target.value)}
            >
              <option value="">全部</option>
              {COMMON_ACTIONS.map(action => (
                <option key={action} value={action}>
                  {action}
                </option>
              ))}
              {getUniqueActions().map(action => (
                <option key={action} value={action}>
                  {action}
                </option>
              ))}
            </select>
          </div>

          <div style={{ flex: 1, minWidth: 150 }}>
            <input
              placeholder="目标ID"
              value={filters.targetId}
              onChange={(e) => handleFilterChange('targetId', e.target.value)}
            />
          </div>

          <div className="review-pagination">
            <span>
              第 {filters.page}/{totalPages} 页，共 {total} 条
            </span>
            <div className="review-page-actions">
              <button
                className="btn btn-sm"
                disabled={filters.page === 1}
                onClick={() => handlePageChange(filters.page - 1)}
              >
                上一页
              </button>
              <button
                className="btn btn-sm"
                disabled={filters.page >= totalPages || totalPages === 0}
                onClick={() => handlePageChange(filters.page + 1)}
              >
                下一页
              </button>
            </div>
          </div>
        </div>
      </div>

      {error ? <div className="form-error">{error}</div> : null}

      <div className="card">
        <table className="matrix-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>用户</th>
              <th>动作</th>
              <th>目标类型</th>
              <th>目标ID</th>
              <th>详情</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <>
                <tr
                  key={item.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setExpandedRow(expandedRow === item.id ? null : item.id)}
                >
                  <td>{formatDate(item.createdAt)}</td>
                  <td>{item.user.username}</td>
                  <td>{item.action}</td>
                  <td>{TYPE_LABELS[item.targetType] || item.targetType}</td>
                  <td>{item.targetId}</td>
                  <td>
                    {expandedRow === item.id ? '收起' : '查看'}
                  </td>
                </tr>
                {expandedRow === item.id && (
                  <tr>
                    <td colSpan={6} style={{ padding: '12px' }}>
                      <div style={{ background: '#f8fbff', borderRadius: '8px', padding: '12px' }}>
                        <h4 style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: '600' }}>
                          详细信息
                        </h4>
                        <pre style={{ margin: 0, background: '#f4f8fc', border: '1px solid #dbe7f4', borderRadius: '6px', padding: '8px', fontSize: '11px', color: '#334155', overflow: 'auto', maxHeight: '200px' }}>
                          {JSON.stringify(item.payload, null, 2)}
                        </pre>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
        {!loading && items.length === 0 && !error && (
          <div className="empty-hint">暂无审计日志</div>
        )}
      </div>
    </div>
  );
}
