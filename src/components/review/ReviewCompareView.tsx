import { useCallback, useEffect, useState } from 'react';
import ViewerCanvas from '../diagram/ViewerCanvas';
import {
  fetchDiagramVersions,
  fetchDiagramVersionTopology,
  type TopologyResponse,
} from '../../services/diagramApi';
import {
  approveReviewByApi,
  rejectReviewByApi,
  type ReviewQueueItem,
} from '../../services/reviewApi';
import { diffTopology, type ChangeEntry, type DiffResult } from '../../utils/diffTopology';
import { parseError } from '../../utils/parseError';

interface Props {
  review: ReviewQueueItem;
  onBack: () => void;
  onActionDone: () => void;
}

export default function ReviewCompareView({ review, onBack, onActionDone }: Props) {
  const [before, setBefore] = useState<TopologyResponse | null>(null);
  const [after, setAfter] = useState<TopologyResponse | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [isNewDiagram, setIsNewDiagram] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [comment, setComment] = useState('');
  const [acting, setActing] = useState(false);

  // 两侧画布视口（独立）
  const [beforeZoom, setBeforeZoom] = useState(0.6);
  const [beforePan, setBeforePan] = useState({ x: 0, y: 0 });
  const [afterZoom, setAfterZoom] = useState(0.6);
  const [afterPan, setAfterPan] = useState({ x: 0, y: 0 });
  const [focusId, setFocusId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const afterTopo = await fetchDiagramVersionTopology(review.diagramId, review.diagramVersionId);
        const versions = await fetchDiagramVersions(review.diagramId);
        const online = versions.find((v) => v.status === 'ONLINE');
        const beforeTopo = online
          ? await fetchDiagramVersionTopology(review.diagramId, online.id)
          : null;
        if (!alive) return;
        setAfter(afterTopo);
        setBefore(beforeTopo);
        setIsNewDiagram(!online);
        setDiff(diffTopology(beforeTopo, afterTopo));
      } catch (e) {
        if (alive) setError(parseError(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [review.diagramId, review.diagramVersionId]);

  const handleAction = async (action: 'approve' | 'reject') => {
    setActing(true);
    setError('');
    try {
      const c = comment.trim() || undefined;
      if (action === 'approve') await approveReviewByApi(review.id, c);
      else await rejectReviewByApi(review.id, c);
      onActionDone();
    } catch (e) {
      setError(parseError(e));
      setActing(false);
    }
  };

  const handleLocate = useCallback((entry: ChangeEntry) => {
    // 复用 ViewerCanvas 的 highlightedInstanceId 做脉冲+居中定位
    setFocusId(null);
    setTimeout(() => setFocusId(entry.focusInstanceId), 0);
  }, []);

  const badge = (kind: ChangeEntry['kind']) => (kind === 'added' ? '+' : kind === 'removed' ? '−' : '~');

  return (
    <div className="review-compare">
      <div className="review-compare-head">
        <button className="btn btn-sm" onClick={onBack}>← 返回列表</button>
        <strong>图纸 #{review.diagramId.slice(0, 8)}</strong>
        <span>提交人 {review.submitterId.slice(0, 8)}</span>
        <span>提交于 {new Date(review.submittedAt).toLocaleString()}</span>
      </div>
      {error ? <div className="form-error">{error}</div> : null}
      {loading ? (
        <div className="review-compare-loading">加载对比数据...</div>
      ) : (
        <>
          <div className="review-compare-panes">
            <div className="review-compare-pane">
              <div className="review-compare-pane-title">改动前</div>
              {isNewDiagram ? (
                <div className="review-compare-empty">🆕 新建图纸，无历史版本可对比</div>
              ) : before ? (
                <div className="review-compare-canvas">
                  <ViewerCanvas
                    instances={before.instances}
                    edges={before.edges}
                    viewMode="complete"
                    zoom={beforeZoom}
                    panX={beforePan.x}
                    panY={beforePan.y}
                    onSetZoom={setBeforeZoom}
                    onSetPan={(x, y) => setBeforePan({ x, y })}
                    selectedInstanceId={null}
                    onSelectInstance={() => {}}
                    diffHighlights={diff ? { instances: diff.beforeInstances, edges: diff.beforeEdges } : null}
                    highlightedInstanceId={focusId}
                  />
                </div>
              ) : (
                <div className="review-compare-empty">无法加载改动前数据</div>
              )}
            </div>
            <div className="review-compare-pane">
              <div className="review-compare-pane-title">改动后</div>
              {after ? (
                <div className="review-compare-canvas">
                  <ViewerCanvas
                    instances={after.instances}
                    edges={after.edges}
                    viewMode="complete"
                    zoom={afterZoom}
                    panX={afterPan.x}
                    panY={afterPan.y}
                    onSetZoom={setAfterZoom}
                    onSetPan={(x, y) => setAfterPan({ x, y })}
                    selectedInstanceId={null}
                    onSelectInstance={() => {}}
                    diffHighlights={diff ? { instances: diff.afterInstances, edges: diff.afterEdges } : null}
                    highlightedInstanceId={focusId}
                  />
                </div>
              ) : (
                <div className="review-compare-empty">无法加载改动后数据</div>
              )}
            </div>
          </div>

          <div className="review-compare-changes">
            <div className="review-compare-changes-title">变更清单（{diff?.changes.length ?? 0}）</div>
            {diff && diff.changes.length > 0 ? (
              <ul>
                {diff.changes.map((c) => (
                  <li
                    key={`${c.target}-${c.id}`}
                    className={`change-${c.kind}`}
                    onClick={() => handleLocate(c)}
                  >
                    <span className="change-badge">{badge(c.kind)}</span>
                    {c.label}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="review-compare-empty-sm">无拓扑变更</div>
            )}
          </div>

          {review.status === 'PENDING' && (
            <div className="review-compare-actions">
              <input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="审核意见（可选）"
              />
              <button className="btn btn-primary" disabled={acting} onClick={() => void handleAction('approve')}>
                通过
              </button>
              <button className="btn btn-danger" disabled={acting} onClick={() => void handleAction('reject')}>
                驳回
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
