import { useCallback, useEffect, useRef, useState } from 'react';
import ViewerCanvas, { type ViewMode, type TopologyInstance, type TopologyEdge } from '../components/diagram/ViewerCanvas';
import VersionTimeline from '../components/diagram/VersionTimeline';
import {
  fetchDiagrams,
  fetchDiagramTopology,
  fetchDiagramVersions,
  fetchDiagramVersionTopology,
  type DiagramListItem,
  type TopologyResponse,
  type VersionSummary,
} from '../services/diagramApi';
import { runOutageSimulation, type OutageSimulationResult } from '../services/analysisApi';
import { useAuth } from '../contexts/useAuth';
import { hasRole } from '../services/unifiedClient';
import { parseError } from '../utils/parseError';

const NODE_WIDTH = 140;
const NODE_HEIGHT = 56;

function parseApiError(error: unknown) {
  return parseError(error);
}

export default function DiagramViewerPage() {
  const { user } = useAuth();

  const [diagrams, setDiagrams] = useState<DiagramListItem[]>([]);
  const [selectedDiagramId, setSelectedDiagramId] = useState('');
  const [topologyData, setTopologyData] = useState<TopologyResponse | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('complete');
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [simMode, setSimMode] = useState(false);
  const [simResult, setSimResult] = useState<OutageSimulationResult | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Version timeline state
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);

  const canvasContainerRef = useRef<HTMLDivElement>(null);

  const canSeeAll = user && (hasRole(user, 'ADMIN') || hasRole(user, 'DIAGRAM_EDITOR') || hasRole(user, 'REVIEWER'));
  const currentOnlineVersionId = versions.find((v) => v.status === 'ONLINE')?.id ?? null;

  // ---- Load diagram list ----
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    void (async () => {
      try {
        const list = await fetchDiagrams();
        if (cancelled) return;
        setDiagrams(list);
        setSelectedDiagramId((prev) => prev || list[0]?.id || '');
      } catch (e) {
        if (!cancelled) setError(parseApiError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ---- Load versions + topology on diagram selection ----
  useEffect(() => {
    if (!selectedDiagramId) {
      setTopologyData(null);
      setVersions([]);
      setSelectedVersionId(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    setSimResult(null);
    setSimMode(false);
    setSelectedInstanceId(null);
    setVersions([]);
    setSelectedVersionId(null);
    void (async () => {
      try {
        // Load version list
        const verList = await fetchDiagramVersions(selectedDiagramId);
        if (cancelled) return;
        setVersions(verList);

        // Default: load latest version's topology
        const latest = verList[0];
        if (!latest) {
          setTopologyData(null);
          setLoading(false);
          return;
        }
        setSelectedVersionId(latest.id);

        // If latest is the current online version, use the live topology endpoint
        // Otherwise use version-specific endpoint
        let data: TopologyResponse;
        if (latest.status === 'ONLINE') {
          data = await fetchDiagramTopology(selectedDiagramId);
        } else {
          data = await fetchDiagramVersionTopology(selectedDiagramId, latest.id);
        }
        if (cancelled) return;
        setTopologyData(data);
      } catch (e) {
        if (!cancelled) setError(parseApiError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedDiagramId]);

  // ---- Load topology when version selection changes ----
  const handleSelectVersion = useCallback(async (versionId: string) => {
    if (versionId === selectedVersionId) return;
    setSelectedVersionId(versionId);
    setLoading(true);
    setError('');
    try {
      const data = await fetchDiagramVersionTopology(selectedDiagramId, versionId);
      setTopologyData(data);
    } catch (e) {
      setError(parseApiError(e));
    } finally {
      setLoading(false);
    }
  }, [selectedDiagramId, selectedVersionId]);

  // ---- Instances/edges for canvas ----
  const instances: TopologyInstance[] = topologyData?.instances ?? [];
  const edges: TopologyEdge[] = topologyData?.edges ?? [];

  // ---- Find selected instance label ----
  const selectedInstance = instances.find((i) => i.id === selectedInstanceId);

  // ---- Fit canvas to content ----
  const handleFitCanvas = useCallback(() => {
    if (instances.length === 0 || !canvasContainerRef.current) return;

    const container = canvasContainerRef.current;
    const displayW = container.clientWidth;
    const displayH = container.clientHeight;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const inst of instances) {
      minX = Math.min(minX, inst.positionX);
      minY = Math.min(minY, inst.positionY);
      maxX = Math.max(maxX, inst.positionX + NODE_WIDTH);
      maxY = Math.max(maxY, inst.positionY + NODE_HEIGHT);
    }

    const contentW = maxX - minX;
    const contentH = maxY - minY;
    if (contentW <= 0 || contentH <= 0) return;

    const padding = 60;
    const scaleX = (displayW - padding * 2) / contentW;
    const scaleY = (displayH - padding * 2) / contentH;
    const newZoom = Math.max(0.1, Math.min(2, Math.min(scaleX, scaleY)));

    const centerX = minX + contentW / 2;
    const centerY = minY + contentH / 2;

    setZoom(newZoom);
    setPanX(displayW / 2 - centerX * newZoom);
    setPanY(displayH / 2 - centerY * newZoom);
  }, [instances]);

  // ---- Run outage simulation ----
  const handleRunSimulation = useCallback(async () => {
    if (!selectedDiagramId || !selectedInstanceId) return;
    setSimLoading(true);
    setError('');
    try {
      const result = await runOutageSimulation(selectedDiagramId, selectedInstanceId);
      setSimResult(result);
    } catch (e) {
      setError(parseApiError(e));
    } finally {
      setSimLoading(false);
    }
  }, [selectedDiagramId, selectedInstanceId]);

  // ---- Exit simulation mode ----
  const handleExitSimulation = useCallback(() => {
    setSimMode(false);
    setSimResult(null);
    setSelectedInstanceId(null);
  }, []);

  // ---- Zoom buttons ----
  const handleZoomIn = useCallback(() => {
    setZoom((z) => Math.min(5, z * 1.2));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((z) => Math.max(0.1, z / 1.2));
  }, []);

  // ---- Current version label for toolbar ----
  const selectedVersion = versions.find((v) => v.id === selectedVersionId);
  const toolbarVersionLabel = selectedVersion ? `v${selectedVersion.versionNo}` : '';

  return (
    <div className="workspace-page diagram-viewer-page">
      <div className="page-head">
        <h3>查询浏览</h3>
      </div>
      {error ? <div className="form-error">{error}</div> : null}
      <div className="viewer-layout">
        {/* Left sidebar: diagram list */}
        <aside className="viewer-sidebar">
          <div className="viewer-sidebar-title">图纸列表</div>
          {diagrams.map((item) => {
            const isDecommissioned = !canSeeAll && item.status !== 'PUBLISHED';
            return (
              <button
                key={item.id}
                className={`viewer-diagram-item ${selectedDiagramId === item.id ? 'active' : ''}${isDecommissioned ? ' decommissioned' : ''}`}
                onClick={() => setSelectedDiagramId(item.id)}
              >
                <strong>{item.name}</strong>
                <span>{new Date(item.updatedAt).toLocaleString()}</span>
              </button>
            );
          })}
          {!loading && diagrams.length === 0 ? (
            <div className="viewer-empty-hint">暂无图纸</div>
          ) : null}
        </aside>

        {/* Version timeline */}
        {selectedDiagramId && versions.length > 0 ? (
          <VersionTimeline
            versions={versions}
            selectedVersionId={selectedVersionId}
            onSelectVersion={handleSelectVersion}
            currentOnlineVersionId={currentOnlineVersionId}
          />
        ) : null}

        {/* Main area */}
        <div className="viewer-main">
          {/* Toolbar */}
          <div className="viewer-toolbar">
            {!simMode ? (
              <>
                <div className="viewer-mode-tabs">
                  {(['simplified', 'complete', 'geographic'] as const).map((mode) => {
                    const labels: Record<ViewMode, string> = {
                      simplified: '精简视图',
                      complete: '完整视图',
                      geographic: '地理视图',
                    };
                    return (
                      <button
                        key={mode}
                        className={`viewer-toolbar-btn ${viewMode === mode ? 'active' : ''}`}
                        onClick={() => setViewMode(mode)}
                      >
                        {labels[mode]}
                      </button>
                    );
                  })}
                </div>
                <div className="viewer-toolbar-sep" />
                <button className="viewer-toolbar-btn" onClick={handleZoomIn} title="放大">
                  {'🔍'}+
                </button>
                <button className="viewer-toolbar-btn" onClick={handleZoomOut} title="缩小">
                  {'🔍'}-
                </button>
                <button className="viewer-toolbar-btn" onClick={handleFitCanvas} title="适应画布">
                  适应画布
                </button>
                <div className="viewer-toolbar-sep" />
                {toolbarVersionLabel ? (
                  <span style={{ fontSize: 12, color: 'var(--gray-500)', fontWeight: 600 }}>
                    {toolbarVersionLabel}
                  </span>
                ) : null}
                <div className="viewer-toolbar-sep" />
                <button
                  className={`viewer-toolbar-btn ${simMode ? 'sim-active' : ''}`}
                  onClick={() => setSimMode(true)}
                  disabled={!selectedDiagramId}
                  title="停电模拟"
                >
                  {'⚡'} 停电模拟
                </button>
              </>
            ) : (
              <>
                <span className="sim-active">{'⚡'} 模拟中</span>
                <span className="sim-selected-label">
                  选中: {selectedInstance?.label || '请点击分合点'}
                </span>
                <button
                  className="viewer-toolbar-btn viewer-toolbar-btn-primary"
                  onClick={handleRunSimulation}
                  disabled={!selectedInstanceId || simLoading}
                >
                  {simLoading ? '模拟中...' : '▶ 执行模拟'}
                </button>
                <button className="viewer-toolbar-btn" onClick={handleExitSimulation}>
                  {'✕'} 退出
                </button>
              </>
            )}
          </div>

          {/* Canvas area */}
          <div className="viewer-canvas-area" ref={canvasContainerRef}>
            {topologyData ? (
              <ViewerCanvas
                instances={instances}
                edges={edges}
                viewMode={viewMode}
                zoom={zoom}
                panX={panX}
                panY={panY}
                onSetZoom={setZoom}
                onSetPan={(x, y) => { setPanX(x); setPanY(y); }}
                selectedInstanceId={selectedInstanceId}
                onSelectInstance={setSelectedInstanceId}
                outageResult={simResult}
                highlightedInstanceId={simMode ? selectedInstanceId : undefined}
              />
            ) : (
              <div className="viewer-empty-hint">
                {loading ? '加载中...' : '请选择图纸'}
              </div>
            )}
          </div>
        </div>

        {/* Right panel: simulation statistics */}
        {simResult ? (
          <aside className="viewer-stats">
            <h4>停电模拟结果</h4>
            <div className="viewer-stats-row">
              <span className="viewer-stats-label">停电台区数</span>
              <span className="viewer-stats-value viewer-stats-value-danger">
                {simResult.statistics.affectedDistrictCount}
              </span>
            </div>
            <div className="viewer-stats-row">
              <span className="viewer-stats-label">停电户数</span>
              <span className="viewer-stats-value viewer-stats-value-danger">
                {simResult.statistics.affectedHouseholdCount}
              </span>
            </div>
            <div className="viewer-stats-section">
              <h5>受影响区域</h5>
              {simResult.statistics.affectedDistricts.length === 0 ? (
                <div className="viewer-stats-empty">无受影响区域</div>
              ) : (
                <ul className="viewer-stats-districts">
                  {simResult.statistics.affectedDistricts.map((d) => (
                    <li key={d.instanceId}>
                      <strong>{d.label}</strong>
                      {d.householdCount != null ? (
                        <span>{d.householdCount} 户</span>
                      ) : null}
                      {d.supplyArea ? <span>{d.supplyArea}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="viewer-stats-section">
              <h5>连通节点 ({simResult.reachableInstanceIds.length})</h5>
              <div className="viewer-stats-tag-list">
                {simResult.reachableInstanceIds.map((id) => {
                  const inst = instances.find((i) => i.id === id);
                  return (
                    <span key={id} className="viewer-stats-tag viewer-stats-tag-ok">
                      {inst?.label || id.slice(0, 8)}
                    </span>
                  );
                })}
              </div>
            </div>
            <div className="viewer-stats-section">
              <h5>断电节点 ({simResult.unreachableInstanceIds.length})</h5>
              <div className="viewer-stats-tag-list">
                {simResult.unreachableInstanceIds.map((id) => {
                  const inst = instances.find((i) => i.id === id);
                  return (
                    <span key={id} className="viewer-stats-tag viewer-stats-tag-danger">
                      {inst?.label || id.slice(0, 8)}
                    </span>
                  );
                })}
              </div>
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
