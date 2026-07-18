import { useMemo, useState } from 'react';
import type { ElectricalComponent } from '../../types';

export type ComposeMode = 'bay' | 'cabinet';

export interface ComposeWizardInput {
  mode: ComposeMode;
  name: string;
  category: string;
  /** 有序组合项（自上而下 / 自左而右） */
  items: { componentId: string; count: number }[];
}

interface CategoryOption {
  name: string;
  label: string;
}

interface ComposeWizardDialogProps {
  components: ElectricalComponent[];
  categories: CategoryOption[];
  categoryLabelMap: Record<string, string>;
  onClose: () => void;
  onCompose: (input: ComposeWizardInput) => void;
}

interface Row {
  key: number;
  componentId: string;
  count: number;
}

let rowKeySeq = 1;

/**
 * 组合元件向导：
 *  - 间隔组合：设备自上而下纵向串联 → 开关间隔元件
 *  - 柜体组合：间隔自左而右横排挂母线 → 环网柜/高配室元件
 */
export default function ComposeWizardDialog({
  components,
  categories,
  categoryLabelMap,
  onClose,
  onCompose,
}: ComposeWizardDialogProps) {
  const [mode, setMode] = useState<ComposeMode>('bay');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('switchPoint');
  const [rows, setRows] = useState<Row[]>([]);

  // 按分类排序的元件选项
  const options = useMemo(
    () => [...components].sort((a, b) =>
      a.category === b.category ? a.name.localeCompare(b.name) : a.category.localeCompare(b.category)),
    [components],
  );

  const addRow = () => {
    setRows((rs) => [...rs, { key: rowKeySeq++, componentId: options[0]?.id ?? '', count: 1 }]);
  };
  const removeRow = (key: number) => setRows((rs) => rs.filter((r) => r.key !== key));
  const moveRow = (key: number, dir: -1 | 1) => {
    setRows((rs) => {
      const idx = rs.findIndex((r) => r.key === key);
      const to = idx + dir;
      if (idx < 0 || to < 0 || to >= rs.length) return rs;
      const next = [...rs];
      [next[idx], next[to]] = [next[to], next[idx]];
      return next;
    });
  };
  const patchRow = (key: number, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const totalUnits = rows.reduce((s, r) => s + Math.max(1, Math.floor(r.count)), 0);
  const canConfirm = name.trim().length > 0 && rows.length > 0 && rows.every((r) => r.componentId);

  const handleConfirm = () => {
    if (!canConfirm) return;
    onCompose({
      mode,
      name: name.trim(),
      category,
      items: rows.map((r) => ({ componentId: r.componentId, count: Math.max(1, Math.floor(r.count)) })),
    });
  };

  const isBay = mode === 'bay';

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ minWidth: 460 }}>
        <h3>组合生成元件</h3>

        {/* 模式切换 */}
        <div style={{ display: 'flex', gap: 6, margin: '10px 0' }}>
          <button
            className={`btn btn-sm ${isBay ? 'btn-primary' : ''}`}
            onClick={() => setMode('bay')}
          >
            间隔组合（设备↓串联）
          </button>
          <button
            className={`btn btn-sm ${!isBay ? 'btn-primary' : ''}`}
            onClick={() => setMode('cabinet')}
          >
            柜体组合（间隔→横排）
          </button>
        </div>

        <label>
          {isBay ? '间隔名称' : '柜名'}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={isBay ? '如：出线间隔（负荷开关）' : '如：10kV景城二线恒大#1环网柜'}
          />
        </label>
        <label>
          元件类别
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => (
              <option key={c.name} value={c.name}>{c.label}</option>
            ))}
          </select>
        </label>

        {/* 组合项列表 */}
        <div style={{ margin: '10px 0 4px', fontSize: 13, color: '#475569' }}>
          {isBay ? '设备（自上而下）' : '间隔（自左而右）'}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
          {rows.map((row, idx) => (
            <div key={row.key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 18, fontSize: 12, color: '#94a3b8', textAlign: 'right' }}>{idx + 1}</span>
              <select
                value={row.componentId}
                onChange={(e) => patchRow(row.key, { componentId: e.target.value })}
                style={{ flex: 1, padding: '3px 4px', fontSize: 13 }}
              >
                {options.map((c) => (
                  <option key={c.id} value={c.id}>
                    [{categoryLabelMap[c.category] ?? c.category}] {c.name}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                max={24}
                value={row.count}
                onChange={(e) => patchRow(row.key, { count: Number(e.target.value) || 1 })}
                title="数量（连续重复）"
                style={{ width: 52, padding: '3px 4px', fontSize: 13 }}
              />
              <button className="btn btn-sm" onClick={() => moveRow(row.key, -1)} disabled={idx === 0} title="上移">↑</button>
              <button className="btn btn-sm" onClick={() => moveRow(row.key, 1)} disabled={idx === rows.length - 1} title="下移">↓</button>
              <button className="btn btn-sm" onClick={() => removeRow(row.key)} title="删除">✕</button>
            </div>
          ))}
          <button className="btn btn-sm" onClick={addRow} disabled={options.length === 0} style={{ alignSelf: 'flex-start' }}>
            + 添加{isBay ? '设备' : '间隔'}
          </button>
        </div>

        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 10, lineHeight: 1.6 }}>
          {isBay ? (
            <>约定：贯穿式设备（开关/CT等）需有上、下两个引脚，向导按引脚自动串接导通；
              终端设备（PT等）只画一个上引脚，串联链在它处终止。共 {totalUnits} 台设备。</>
          ) : (
            <>生成：柜名 + 顶部母线 + {totalUnits} 个间隔（各间隔可独立分/合），对外引脚为各间隔底部端子。
              设备编号（#160/#16 等）在图纸编辑器中按各图纸单独命名。</>
          )}
          生成后可在元件编辑器继续手工微调。
        </div>

        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn btn-primary" disabled={!canConfirm} onClick={handleConfirm}>生成</button>
        </div>
      </div>
    </div>
  );
}
